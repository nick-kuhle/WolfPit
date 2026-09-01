// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function approve(address spender, uint256 amt) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @notice Minimal junior-tranche interface (Stake) the vault may slash.
interface IStake {
    function slash(uint256 amt) external returns (uint256);
}

/// @notice ETH/USD oracle. ethUsdc() returns the USDC price of 1e18 WETH,
///         6 decimals (e.g. 4_000e6). Must revert or return 0 when unhealthy —
///         the vault treats 0 as "no price" and fails closed.
interface IOracle {
    function ethUsdc() external view returns (uint256);
}

import {SafeERC20} from "./SafeERC20.sol";

/// @notice WolfPit dealer vault. Base-shaped (WETH + native USDC).
///         Single tranche. Inventory law: reservedETH ≤ α·ethBal,
///         reservedUSDC ≤ α·usdcBal with α = 40%.
///
///         Roles:
///           owner    — multisig. pause, insurance ops, oracle/router config.
///           operator — keeper hot key. Risk accounting (write/open/release)
///                      and `exec` swaps through owner-allowlisted routers.
///
///         No WPIT, no pool, no derivatives are required at launch: the vault
///         can run as a hedged spot desk (aggregator route) on day one.
contract DealerVault {
    using SafeERC20 for IERC20;

    uint256 public constant ALPHA_BPS = 4_000; // α = 40%
    uint256 public constant WAD = 1e18;
    uint256 public constant INSURANCE_NAV_MIN_BPS = 100; // < 1% insurance/NAV halts new short gamma
    /// @notice Minimum first deposit ($5k) so totalSupply cannot be captured cheaply.
    uint256 public constant MIN_FIRST_DEPOSIT_USDC = 5_000e6;
    /// @notice Virtual shares/NAV offset ($1) — bounds first-depositor share
    ///         inflation to ~$1 per round trip (ERC4626-style offset).
    uint256 public constant VIRTUAL_SHARES = 1e6;
    uint256 public constant VIRTUAL_NAV = 1e6;
    /// @notice Upper bound on the owner-set release timelock — a delay longer
    ///         than a day would let a hostile owner strand the keeper's book.
    uint256 public constant MAX_RELEASE_DELAY = 1 days;

    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IOracle public oracle;

    address public owner;
    address public pendingOwner;
    address public operator;
    /// @notice Trusted WPIT insurance feeder (the Farm, when it exists).
    address public wpitFeeder;
    /// @notice Junior-tranche WPIT stake contract (slashable on a vault hole).
    address public stake;

    uint256 public ethBal;
    uint256 public usdcBal;
    uint256 public reservedEth;
    uint256 public reservedUsdc;
    uint256 public shares;
    bool public paused;
    uint256 public insuranceUsdc;
    /// @notice Junior-tranche WPIT ledger (slashes + Farm's 1% harvest tax).
    ///         NOT counted by `haltShortGamma()` — WPIT is informational value
    ///         until the owner realizes it into USDC via
    ///         `convertWpitInsurance` (only converted USDC arms the halt).
    uint256 public insuranceWpit;

    /// @notice Operator release timelock (seconds). 0 at launch = releases are
    ///         immediate (keeper single-tx flow). Once the fail-closed watcher
    ///         runs, the owner sets a delay: the operator must then QUEUE a
    ///         release and wait it out, giving the watcher/owner a veto window
    ///         against a compromised keeper key unwinding the reserved book
    ///         (the vault has no on-chain position registry — see RISK.md).
    ///         The owner bypasses the queue: the multisig is the trust root.
    ///         Distinct from ADMIN_TIMELOCK (WP-05): that one gates the
    ///         owner's allowlist surface at a fixed 2 days; this one gates the
    ///         OPERATOR's release flow and is owner-tunable (risk ops cadence).
    uint256 public releaseDelay;
    uint256 public queuedReleaseEth;
    uint256 public queuedReleaseEthEta;
    uint256 public queuedReleaseUsdc;
    uint256 public queuedReleaseUsdcEta;

    mapping(address => uint256) public shareOf;
    /// @notice DEX aggregator routers `exec` may call (owner-set).
    mapping(address => bool) public allowedTarget;

    /// @notice WP-05 / #12: function selectors `exec` may forward. Without this
    ///         an allowlisted router could be called with ANY calldata, and any
    ///         router that exposes a token-moving function becomes a drain path.
    mapping(bytes4 => bool) public allowedSelector;

    /// @notice token => ceiling on any single allowance granted to a router.
    ///         Per-token because a single scalar cannot span decimals: 1e12 is
    ///         1,000,000 USDC (6 dp) but 0.000001 WETH (18 dp). A token with no
    ///         cap set has a cap of 0, so grants to it revert — fail closed.
    mapping(address => uint256) public allowanceCap;

    /// @notice id => epoch second at which the queued action becomes executable
    ///         (0 = not queued).
    mapping(bytes32 => uint256) public adminReadyAt;

    error NotOwner();
    error NotOperator();
    error Paused();
    error Zero();
    error NakedCall();
    error NakedPut();
    error UtilCap();
    error InsuranceHalt();
    error BadOracle();
    error BadTarget();
    error Reentrant();
    error FirstDepositTooSmall();
    error SwapSize();
    error Slippage();
    error UnreconciledLoss();
    error InsufficientShares();
    error InsuranceSpent();
    error CoverSpent();
    error NotQueued();
    error TimelockPending();
    error OwnerNotContract();
    error AllowanceTooLarge();
    error BadSelector();
    error BadCalldata();
    error ReleaseNotReady();
    error DelayTooLong();

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event OperatorSet(address indexed previous, address indexed next);
    event OracleSet(address indexed previous, address indexed next);
    event TargetAllowed(address indexed target, bool allowed);
    event AllowanceSet(address indexed token, address indexed spender, uint256 amount);
    event Deposit(address indexed who, uint256 ethAmt, uint256 usdcAmt, uint256 minted);
    event Withdraw(address indexed who, uint256 ethAmt, uint256 usdcAmt, uint256 burned);
    event PausedSet(bool v);
    event InsuranceCredited(uint256 usdcAmt, uint256 wpitAmt);
    event RiskOpened(bytes4 indexed sig, uint256 a, uint256 b);
    event RiskReleased(bytes4 indexed sig, uint256 a);
    event Executed(address indexed target, bytes data);
    event AdminQueued(bytes32 indexed id, uint256 readyAt);
    event AdminCancelled(bytes32 indexed id);
    event SelectorAllowed(bytes4 indexed selector, bool allowed);
    event AllowanceCapSet(address indexed token, uint256 previous, uint256 next);
    event ReleaseDelaySet(uint256 previous, uint256 next);
    event ReleaseQueued(bytes4 indexed sig, uint256 amt, uint256 eta);
    event ReleaseVetoed(uint256 ethAmt, uint256 usdcLock);
    event InsuranceWpitConverted(uint256 wpitSpent, uint256 usdcGained);

    uint256 private _lock = 1;

    modifier live() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @param enforceContractOwner_ Production deploys MUST pass true. The only
    ///        caller that passes false is `Deployer`, a launch-shape helper that
    ///        needs transient self-ownership to wire stake/feeder — and which is
    ///        not on the Base mainnet deploy path (`DeployBase.s.sol` passes
    ///        true). See WP-05 / #12.
    constructor(
        IERC20 usdc_,
        IERC20 weth_,
        IOracle oracle_,
        address owner_,
        address operator_,
        bool enforceContractOwner_
    ) {
        if (owner_ == address(0) || operator_ == address(0)) revert Zero();
        // WP-05 / #12: the owner key can allowlist a router and grant it an
        // allowance, so a single compromised EOA is a complete drain path.
        // Require a contract (multisig / timelock module) at construction so
        // the trust model the README advertises is the one that was deployed.
        if (enforceContractOwner_ && owner_.code.length == 0) revert OwnerNotContract();
        usdc = usdc_;
        weth = weth_;
        oracle = oracle_;
        owner = owner_;
        operator = operator_;
        // Bounded by default; raising a cap is itself a timelocked action.
        allowanceCap[address(usdc_)] = DEFAULT_USDC_CAP;
        allowanceCap[address(weth_)] = DEFAULT_WETH_CAP;
        emit OwnershipTransferred(address(0), owner_);
        emit OperatorSet(address(0), operator_);
    }

    // ------------------------------------------------------------------ admin

    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function setOperator(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        emit OperatorSet(operator, next);
        operator = next;
    }

    function setOracle(IOracle next) external onlyOwner {
        if (address(next) == address(0)) revert Zero();
        emit OracleSet(address(oracle), address(next));
        oracle = next;
    }

    /// @notice Pause / resume the pit. OWNER or OPERATOR — the fail-closed
    ///         watcher signs as the OPERATOR, so an on-chain halt must not
    ///         revert NotOwner; the operator's manual `Pause{v}` command can
    ///         also resume after review. A third party stays locked out.
    ///         Pausing stops new risk (the `live` gate); safe LP withdrawals
    ///         remain available while paused.
    function pause(bool v) external onlyOperator {
        paused = v;
        emit PausedSet(v);
    }

    /// @notice Fund the insurance ledger with REAL USDC. Pulls `usdcAmt` from
    ///         the caller so `insuranceUsdc` is 1:1 token-backed by
    ///         construction — an unbacked ledger entry could silently disarm
    ///         the `haltShortGamma` 1%-of-NAV check while the fund holds
    ///         nothing. Insurance USDC is segregated from the trading ledger:
    ///         it is NOT added to `usdcBal` and does not mint shares.
    function creditInsurance(uint256 usdcAmt) external onlyOwner {
        if (usdcAmt == 0) revert Zero();
        // WP-09 / #10: a false/reverting transfer must not silently credit an
        //        unbacked insurance ledger entry (WP-11 / #15).
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmt);
        insuranceUsdc += usdcAmt;
        emit InsuranceCredited(usdcAmt, 0);
    }

    function setWpitFeeder(address feeder) external onlyOwner {
        wpitFeeder = feeder;
    }

    /// @notice Farm's 1% harvest tax lands here. Restricted to owner or the
    ///         trusted feeder (the Farm contract).
    function creditInsuranceWpit(uint256 amt) external {
        if (msg.sender != owner && msg.sender != wpitFeeder) revert NotOwner();
        insuranceWpit += amt;
        emit InsuranceCredited(0, amt);
    }

    /// @notice Point the vault at the junior stake contract (slash recipient).
    function setStake(address stake_) external onlyOwner {
        stake = stake_;
    }

    /// @notice Slash order (RISK.md): insurance USDC -> staked WPIT -> pause.
    ///         Owner calls this when a vault hole exceeds insurance; the stake
    ///         contract transfers WPIT here and it is credited to insuranceWpit.
    ///         nonReentrant: `stake.slash` is an external call — a malicious
    ///         stake must not re-enter risk accounting mid-slash.
    function slashInsuranceJunior(uint256 amt) external onlyOwner nonReentrant {
        if (stake == address(0) || amt == 0) revert Zero();
        uint256 slashed = IStake(stake).slash(amt);
        insuranceWpit += slashed; // stake caps at its own total
        emit InsuranceCredited(0, slashed);
    }

    /// @notice Realize junior-tranche WPIT into REAL insurance USDC through an
    ///         owner-allowlisted router. `insuranceWpit` is otherwise dead
    ///         value: `haltShortGamma()` counts only `insuranceUsdc`, so a
    ///         slashed junior tranche looked "funded" while the halt trigger
    ///         ignored it. Balance-delta accounting: only WPIT the insurance
    ///         ledger owns may be sold, proceeds are credited to
    ///         `insuranceUsdc` (never `usdcBal` — no shares are minted), and
    ///         the exec cover floors re-verify that the router did not touch
    ///         trading cover. Owner-only: converting junior collateral is a
    ///         treasury decision, not a keeper hot-key power.
    ///         WP-05 parity: the router AND the selector must be allowlisted
    ///         (both behind ADMIN_TIMELOCK), and the router's WPIT allowance
    ///         is bounded by `allowanceCap` like any other grant — this
    ///         function adds no new drain surface beyond what `exec` already
    ///         has.
    function convertWpitInsurance(IERC20 wpit, address router, bytes calldata data, uint256 minOutUsdc)
        external
        onlyOwner
        nonReentrant
    {
        if (!allowedTarget[router]) revert BadTarget();
        if (data.length < 4) revert BadCalldata();
        if (!allowedSelector[bytes4(data[:4])]) revert BadSelector();
        // The two vault legs must never masquerade as the WPIT being sold —
        // delta accounting on usdc/weth themselves would corrupt the ledgers.
        if (address(wpit) == address(usdc) || address(wpit) == address(weth)) revert BadTarget();
        uint256 wBefore = wpit.balanceOf(address(this));
        uint256 uBefore = usdc.balanceOf(address(this));
        (bool ok, bytes memory ret) = router.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        uint256 wAfter = wpit.balanceOf(address(this));
        uint256 uAfter = usdc.balanceOf(address(this));
        if (wAfter >= wBefore) revert SwapSize(); // nothing sold
        uint256 spent = wBefore - wAfter;
        if (spent > insuranceWpit) revert SwapSize(); // only the insurance ledger may be sold
        if (uAfter < uBefore || uAfter - uBefore < minOutUsdc) revert Slippage();
        uint256 gained = uAfter - uBefore;
        insuranceWpit -= spent;
        insuranceUsdc += gained;
        // exec parity: real balances must still back insurance AND reserves.
        if (uAfter < insuranceUsdc) revert InsuranceSpent();
        if (uAfter - insuranceUsdc < reservedUsdc) revert CoverSpent();
        if (weth.balanceOf(address(this)) < reservedEth) revert CoverSpent();
        emit InsuranceWpitConverted(spent, gained);
        emit InsuranceCredited(gained, 0);
    }

    // --------------------------------------------------- aggregator spot route

    /// @notice WP-05 / #12: delay before a queued privileged action executes.
    ///         Two days is long enough for depositors to see a pending router
    ///         allowlist change and withdraw before it can move their funds.
    uint256 public constant ADMIN_TIMELOCK = 2 days;

    /// @notice Default allowance ceilings, sized for a hedge rather than for
    ///         draining the book: 1,000,000 USDC and 500 WETH. Raising either is
    ///         a timelocked action, so depositors get ADMIN_TIMELOCK of notice
    ///         and can withdraw before a larger grant takes effect.
    uint256 public constant DEFAULT_USDC_CAP = 1_000_000e6;
    uint256 public constant DEFAULT_WETH_CAP = 500 ether;

    function _queue(bytes32 id) internal {
        if (adminReadyAt[id] != 0) revert NotQueued(); // already pending
        uint256 readyAt = block.timestamp + ADMIN_TIMELOCK;
        adminReadyAt[id] = readyAt;
        emit AdminQueued(id, readyAt);
    }

    /// @dev Consumes a queued action, reverting until the delay has elapsed.
    ///      The id binds the EXACT parameters queued, so an owner cannot queue a
    ///      benign action and execute a different one against the same slot.
    function _consume(bytes32 id) internal {
        uint256 readyAt = adminReadyAt[id];
        if (readyAt == 0) revert NotQueued();
        if (block.timestamp < readyAt) revert TimelockPending();
        delete adminReadyAt[id]; // single-use
    }

    /// @notice Cancel a queued action before it matures.
    function cancelAdmin(bytes32 id) external onlyOwner {
        if (adminReadyAt[id] == 0) revert NotQueued();
        delete adminReadyAt[id];
        emit AdminCancelled(id);
    }

    function allowTargetId(address target, bool ok) public pure returns (bytes32) {
        return keccak256(abi.encode("allowTarget", target, ok));
    }

    /// @notice Step 1 of 2: queue a router allowlist change.
    function queueAllowTarget(address target, bool ok) external onlyOwner {
        _queue(allowTargetId(target, ok));
    }

    /// @notice Step 2 of 2: apply it, no earlier than ADMIN_TIMELOCK after queueing.
    function allowTarget(address target, bool ok) external onlyOwner {
        _consume(allowTargetId(target, ok));
        if (target == address(this) || target == address(0)) revert BadTarget();
        allowedTarget[target] = ok;
        emit TargetAllowed(target, ok);
    }

    function setAllowanceId(IERC20 token, address spender, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode("setAllowance", address(token), spender, amount));
    }

    /// @notice Step 1 of 2: queue an allowance grant.
    function queueSetAllowance(IERC20 token, address spender, uint256 amount) external onlyOwner {
        _queue(setAllowanceId(token, spender, amount));
    }

    /// @notice Step 2 of 2: grant token allowances to allowlisted routers only,
    ///         bounded by `allowanceCap` rather than type(uint256).max.
    function setAllowance(IERC20 token, address spender, uint256 amount) external onlyOwner {
        _consume(setAllowanceId(token, spender, amount));
        if (!allowedTarget[spender]) revert BadTarget();
        // WP-05 / #12: an unlimited approval to an allowlisted router is a
        // complete withdrawal path for whoever holds that router's key.
        if (amount > allowanceCap[address(token)]) revert AllowanceTooLarge();
        token.safeApprove(spender, amount); // WP-09 / #10
        emit AllowanceSet(address(token), spender, amount);
    }

    function allowSelectorId(bytes4 selector, bool ok) public pure returns (bytes32) {
        return keccak256(abi.encode("allowSelector", selector, ok));
    }

    /// @notice Step 1 of 2: queue a selector allowlist change.
    function queueAllowSelector(bytes4 selector, bool ok) external onlyOwner {
        _queue(allowSelectorId(selector, ok));
    }

    /// @notice Step 2 of 2: permit or forbid a function selector in `exec`.
    function allowSelector(bytes4 selector, bool ok) external onlyOwner {
        _consume(allowSelectorId(selector, ok));
        allowedSelector[selector] = ok;
        emit SelectorAllowed(selector, ok);
    }

    function setAllowanceCapId(IERC20 token, uint256 next) public pure returns (bytes32) {
        return keccak256(abi.encode("setAllowanceCap", address(token), next));
    }

    /// @notice Step 1 of 2: queue a change to a token's allowance ceiling.
    function queueSetAllowanceCap(IERC20 token, uint256 next) external onlyOwner {
        _queue(setAllowanceCapId(token, next));
    }

    /// @notice Step 2 of 2: raise or lower a token's allowance ceiling.
    function setAllowanceCap(IERC20 token, uint256 next) external onlyOwner {
        _consume(setAllowanceCapId(token, next));
        emit AllowanceCapSet(address(token), allowanceCap[address(token)], next);
        allowanceCap[address(token)] = next;
    }

    /// @notice Keeper executes an allowlisted aggregator call (swap/hedge).
    ///         Value is not attached; routers pull pre-approved tokens.
    function exec(address target, bytes calldata data) external onlyOperator nonReentrant returns (bytes memory) {
        if (!allowedTarget[target]) revert BadTarget();
        // WP-05 / #12: an allowlisted ADDRESS is not enough. Routers expose many
        // token-moving entry points, so arbitrary calldata to an allowlisted
        // router is still a drain path. The selector must be allowlisted too.
        if (data.length < 4) revert BadCalldata();
        bytes4 selector = bytes4(data[:4]);
        if (!allowedSelector[selector]) revert BadSelector();
        emit Executed(target, data);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        // Insurance is physically held by this contract but logically
        // segregated. An allowlisted router may spend trading inventory, never
        // the insurance reserve, and never the RESERVED cover: after the call
        // the real balances must still back insurance AND the reserved book,
        // or a hedge router could drain WETH from under written calls (naked
        // calls) or trading USDC from under cash-secured puts / short futures.
        uint256 uBal = usdc.balanceOf(address(this));
        uint256 eBal = weth.balanceOf(address(this));
        if (uBal < insuranceUsdc) revert InsuranceSpent();
        if (uBal - insuranceUsdc < reservedUsdc) revert CoverSpent();
        if (eBal < reservedEth) revert CoverSpent();
        return ret;
    }

    // ------------------------------------------------------------------ shares

    function spot() public view returns (uint256) {
        uint256 p = oracle.ethUsdc();
        if (p == 0) revert BadOracle();
        return p;
    }

    function navUsdc() public view returns (uint256) {
        return usdcBal + (ethBal * spot()) / WAD;
    }

    function navUsdc(uint256 p) public view returns (uint256) {
        return usdcBal + (ethBal * p) / WAD;
    }

    /// @notice Deposit value in USDC (6 dec): USDC leg + WETH leg marked via oracle.
    function depositValue(uint256 ethAmt, uint256 usdcAmt) public view returns (uint256) {
        return usdcAmt + (ethAmt * spot()) / WAD;
    }

    function previewDeposit(uint256 ethAmt, uint256 usdcAmt) external view returns (uint256) {
        uint256 value = depositValue(ethAmt, usdcAmt);
        uint256 navPre = shares == 0 ? 0 : navUsdc();
        return (value * (shares + VIRTUAL_SHARES)) / (navPre + VIRTUAL_NAV);
    }

    /// @notice Dual-asset deposit. Shares track contributed USDC value (oracle
    ///         marked) — never a raw sum of 18-dec WETH and 6-dec USDC units.
    ///         Virtual share/NAV offset ($1) bounds first-depositor inflation.
    ///         nonReentrant: the swap callback of an allowlisted router (exec /
    ///         openShort) must not re-enter minting mid-swap — that would book
    ///         the deposit's USDC twice (once here, once as swap proceeds) and
    ///         inflate the ledger past the real balance.
    function deposit(uint256 ethAmt, uint256 usdcAmt) external live nonReentrant {
        if (ethAmt == 0 && usdcAmt == 0) revert Zero();
        uint256 value = depositValue(ethAmt, usdcAmt);
        if (shares == 0 && value < MIN_FIRST_DEPOSIT_USDC) revert FirstDepositTooSmall();
        uint256 navPre = shares == 0 ? 0 : navUsdc(); // pre-deposit NAV (anti-dilution)
        if (ethAmt > 0) {
            weth.safeTransferFrom(msg.sender, address(this), ethAmt);
            ethBal += ethAmt;
        }
        if (usdcAmt > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), usdcAmt);
            usdcBal += usdcAmt;
        }
        uint256 minted = (value * (shares + VIRTUAL_SHARES)) / (navPre + VIRTUAL_NAV);
        shares += minted;
        shareOf[msg.sender] += minted;
        emit Deposit(msg.sender, ethAmt, usdcAmt, minted);
    }

    /// @notice Preview the two-leg payout for burning `shareAmt` shares.
    ///         Pro-rata on raw balances with the virtual-share offset in the
    ///         denominator (rounds in the vault's favor, mirroring deposit).
    function previewWithdraw(uint256 shareAmt) public view returns (uint256 ethOut, uint256 usdcOut) {
        uint256 denom = shares + VIRTUAL_SHARES;
        ethOut = (ethBal * shareAmt) / denom;
        usdcOut = (usdcBal * shareAmt) / denom;
    }

    /// @notice Largest `shareAmt` `who` can withdraw without breaching the
    ///         inventory law (reserved ≤ α·balance on BOTH legs). When the
    ///         book sits at the α cap this is 0 — an LP cannot exit until
    ///         utilisation falls (exit queues are a v1.1 concern). The bound
    ///         is exact to the share: callers can burn `maxWithdraw(who)` and
    ///         it will never revert on UtilCap, and one share more would.
    function maxWithdraw(address who) public view returns (uint256) {
        uint256 denom = shares + VIRTUAL_SHARES;
        uint256 cap = shareOf[who];
        uint256 needEth = (reservedEth * 10_000 + ALPHA_BPS - 1) / ALPHA_BPS; // ceil
        uint256 maxByEth = ethBal > needEth ? ((ethBal - needEth) * denom) / ethBal : 0;
        uint256 needUsdc = (reservedUsdc * 10_000 + ALPHA_BPS - 1) / ALPHA_BPS;
        uint256 maxByUsdc = usdcBal > needUsdc ? ((usdcBal - needUsdc) * denom) / usdcBal : 0;
        uint256 m = maxByEth < maxByUsdc ? maxByEth : maxByUsdc;
        if (m > cap) m = cap;
        // Integer floors can shift the exact maximum by a share or two — walk
        // to it so the preview is tight in both directions.
        while (m < cap && _withdrawUtilOk(m + 1)) m++;
        while (m > 0 && !_withdrawUtilOk(m)) m--;
        return m;
    }

    /// @dev Does burning `shareAmt` shares keep BOTH legs inside α?
    function _withdrawUtilOk(uint256 shareAmt) internal view returns (bool) {
        uint256 denom = shares + VIRTUAL_SHARES;
        uint256 eOut = (ethBal * shareAmt) / denom;
        uint256 uOut = (usdcBal * shareAmt) / denom;
        return reservedEth * 10_000 <= (ethBal - eOut) * ALPHA_BPS
            && reservedUsdc * 10_000 <= (usdcBal - uOut) * ALPHA_BPS;
    }

    /// @notice Burn shares for a pro-rata slice of BOTH legs. The inventory
    ///         law (reserved ≤ α·balance) must survive the exit: withdrawals
    ///         that would push utilisation over α revert, so LP exits can
    ///         never strand written options without collateral. Insurance
    ///         USDC is segregated (not in `usdcBal`) and cannot be withdrawn.
    ///         State is settled before tokens move (nonReentrant + CEI).
    function withdraw(uint256 shareAmt) external nonReentrant {
        if (shareAmt == 0) revert Zero();
        if (shareOf[msg.sender] < shareAmt) revert InsufficientShares();
        (uint256 ethOut, uint256 usdcOut) = previewWithdraw(shareAmt);
        shareOf[msg.sender] -= shareAmt;
        shares -= shareAmt;
        ethBal -= ethOut;
        usdcBal -= usdcOut;
        // Inventory law: remaining balances must still cover reserves at α.
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
        if (ethOut > 0) weth.safeTransfer(msg.sender, ethOut);
        if (usdcOut > 0) usdc.safeTransfer(msg.sender, usdcOut);
        emit Withdraw(msg.sender, ethOut, usdcOut, shareAmt);
    }

    // ------------------------------------------------------------------ risk

    function freeEth() public view returns (uint256) {
        return ethBal > reservedEth ? ethBal - reservedEth : 0;
    }

    function freeUsdc() public view returns (uint256) {
        return usdcBal > reservedUsdc ? usdcBal - reservedUsdc : 0;
    }

    function utilBps() public view returns (uint256) {
        if (ethBal == 0) return 10_000;
        return (reservedEth * 10_000) / ethBal;
    }

    /// @notice Halt new short gamma when the insurance fund cannot absorb the
    ///         tail. Fail-closed: no insurance, no oracle, or insurance/NAV
    ///         < 1% all halt.
    function haltShortGamma() public view returns (bool) {
        if (insuranceUsdc == 0) return true;
        uint256 p = oracle.ethUsdc();
        if (p == 0) return true;
        uint256 nav = navUsdc(p);
        if (nav == 0) return true;
        return insuranceUsdc * 10_000 < nav * INSURANCE_NAV_MIN_BPS;
    }

    function writeCall(uint256 size) external live onlyOperator nonReentrant {
        if (size == 0) revert Zero();
        if (haltShortGamma()) revert InsuranceHalt();
        if (size > freeEth()) revert NakedCall();
        reservedEth += size;
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
        emit RiskOpened(this.writeCall.selector, size, 0);
    }

    function writePut(uint256 size, uint256 strike) external live onlyOperator nonReentrant {
        if (size == 0) revert Zero();
        // Short puts are short gamma: the same insurance halt as writeCall.
        // Fail-closed with zero insurance / dead oracle / insurance < 1% NAV.
        if (haltShortGamma()) revert InsuranceHalt();
        uint256 lock = (size * strike) / WAD;
        if (lock > freeUsdc()) revert NakedPut();
        reservedUsdc += lock;
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
        emit RiskOpened(this.writePut.selector, size, strike);
    }

    function openLong(uint256 size) external live onlyOperator nonReentrant {
        if (size == 0) revert Zero();
        reservedEth += size;
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
        emit RiskOpened(this.openLong.selector, size, 0);
    }

    /// @notice Open a covered short as ONE atomic operation: the allowlisted
    ///         router swap executes first, then the book is updated from the
    ///         REAL balance deltas. Reverts (full rollback — the order does not
    ///         exist) unless exactly `size` WETH left the vault and at least
    ///         `minOutUsdc` USDC arrived. No second tx, no un-reconciled drift.
    ///
    ///         `data` is the router call; the router must pull WETH through the
    ///         allowance set via `setAllowance` (value is not attached).
    function openShort(uint256 size, address router, bytes calldata data, uint256 minOutUsdc)
        external
        live
        onlyOperator
        nonReentrant
    {
        if (size == 0) revert Zero();
        if (!allowedTarget[router]) revert BadTarget();
        uint256 p = spot(); // marks at the ORACLE, never a caller print
        // Only UNRESERVED ETH may be sold: hedge-selling collateral that
        // backs written calls would leave ethBal < reservedEth (naked calls).
        if (size > freeEth()) revert NakedCall();
        reservedUsdc += (size * p) / WAD; // reserved first so a reentrant call sees it

        uint256 wethBefore = weth.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));
        (bool ok, bytes memory ret) = router.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        // exec parity (defense in depth): whatever the router did inside the
        // call, the REAL balances must still back the insurance reserve AND
        // the reserved book — the same invariant `exec` enforces for generic
        // aggregator calls. reservedUsdc already includes this short's lock,
        // so the check validates the new reservation against real balances.
        // Without it, a buggy/compromised hedge router holding a USDC
        // allowance could spend the reserve and the tx died with a raw
        // arithmetic-underflow panic instead of an explicit error.
        {
            uint256 uAfter = usdc.balanceOf(address(this));
            uint256 eAfter = weth.balanceOf(address(this));
            if (uAfter < insuranceUsdc) revert InsuranceSpent();
            if (uAfter - insuranceUsdc < reservedUsdc) revert CoverSpent();
            if (eAfter < reservedEth) revert CoverSpent();
        }
        uint256 wethSpent = wethBefore - weth.balanceOf(address(this));
        uint256 usdcReceived = usdc.balanceOf(address(this)) - usdcBefore;
        if (wethSpent != size) revert SwapSize();
        if (usdcReceived < minOutUsdc) revert Slippage();

        ethBal -= size;
        usdcBal += usdcReceived;
        // Both sides must stay inside α. The USDC leg grows with the swap
        // proceeds; the ETH leg SHRINKS, so it must be re-checked too — a
        // hedge-sale can otherwise compress the cover pool that backs written
        // calls / long futures below the 40% law even though no reservation
        // changed (the size <= freeEth() check only guarantees cover, not α).
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
        emit RiskOpened(this.openShort.selector, size, p);
    }

    /// @notice Reconcile internal counters with real token balances after an
    ///         `exec` swap that the vault did not book itself. Insurance USDC
    ///         lives in the same contract but is a segregated ledger, so it is
    ///         excluded from the trading balance. Reverts when real balances
    ///         are below reserved + insurance amounts — a loss must be
    ///         investigated, never silently absorbed into the ledger.
    function reconcileBalances() external onlyOperator {
        uint256 e = weth.balanceOf(address(this));
        uint256 u = usdc.balanceOf(address(this));
        if (u < insuranceUsdc) revert UnreconciledLoss();
        u -= insuranceUsdc; // trading USDC only
        if (e < reservedEth || u < reservedUsdc) revert UnreconciledLoss();
        ethBal = e;
        usdcBal = u;
    }

    function releaseCall(uint256 size) external live onlyOperator nonReentrant {
        if (size > reservedEth) revert Zero();
        _consumeReleaseQueue(true, size);
        reservedEth -= size;
        emit RiskReleased(this.releaseCall.selector, size);
    }

    function releasePut(uint256 lock) external live onlyOperator nonReentrant {
        if (lock > reservedUsdc) revert Zero();
        _consumeReleaseQueue(false, lock);
        reservedUsdc -= lock;
        emit RiskReleased(this.releasePut.selector, lock);
    }

    // ------------------------------------------------------------ release timelock

    /// @notice Owner arms the release timelock (0 disables — launch default).
    ///         With a delay set, the OPERATOR must `queueRelease*` and wait it
    ///         out before `releaseCall`/`releasePut` succeed; the OWNER
    ///         bypasses the queue (multisig = trust root, and an emergency
    ///         full unwind must never be rate-limited for the owner).
    ///
    ///         Changing the delay CLEARS the pending queue. Without that, the
    ///         control does not bind at the one moment it matters: entries
    ///         queued while the delay was 0 carry `eta = block.timestamp`, so a
    ///         compromised operator could pre-queue the whole book and consume
    ///         it in the same block the owner armed the timelock — and raising
    ///         an existing delay would leave the shorter, already-running clock
    ///         in force. The operator simply re-queues under the new delay.
    function setReleaseDelay(uint256 d) external onlyOwner {
        if (d > MAX_RELEASE_DELAY) revert DelayTooLong();
        emit ReleaseDelaySet(releaseDelay, d);
        releaseDelay = d;
        _clearReleaseQueue();
    }

    /// @notice Queue an ETH-side release. Re-queueing REPLACES the pending
    ///         entry and restarts the clock — a compromised key cannot stack
    ///         a large release behind an innocuous one.
    function queueReleaseCall(uint256 size) external live onlyOperator {
        if (size == 0 || size > reservedEth) revert Zero();
        queuedReleaseEth = size;
        queuedReleaseEthEta = block.timestamp + releaseDelay;
        emit ReleaseQueued(this.releaseCall.selector, size, queuedReleaseEthEta);
    }

    /// @notice Queue a USDC-side release (same replace-and-restart rule).
    function queueReleasePut(uint256 lock) external live onlyOperator {
        if (lock == 0 || lock > reservedUsdc) revert Zero();
        queuedReleaseUsdc = lock;
        queuedReleaseUsdcEta = block.timestamp + releaseDelay;
        emit ReleaseQueued(this.releasePut.selector, lock, queuedReleaseUsdcEta);
    }

    /// @notice Owner cancels everything pending in the release queue — the
    ///         veto half of the timelock (see the keeper-compromise runbook).
    function vetoRelease() external onlyOwner {
        _clearReleaseQueue();
    }

    /// @dev Drop every pending release. Emits only when something was pending,
    ///      so `ReleaseVetoed` stays a signal worth alerting on.
    function _clearReleaseQueue() internal {
        if (queuedReleaseEth == 0 && queuedReleaseUsdc == 0) return;
        emit ReleaseVetoed(queuedReleaseEth, queuedReleaseUsdc);
        queuedReleaseEth = 0;
        queuedReleaseEthEta = 0;
        queuedReleaseUsdc = 0;
        queuedReleaseUsdcEta = 0;
    }

    /// @dev Enforce the timelock on an operator release. No-op when the delay
    ///      is 0 (launch) or the caller is the owner. Otherwise the release
    ///      must fit inside a MATURED queue entry, which it consumes.
    function _consumeReleaseQueue(bool ethSide, uint256 amt) internal {
        if (releaseDelay == 0 || msg.sender == owner) return;
        if (ethSide) {
            if (queuedReleaseEth < amt || block.timestamp < queuedReleaseEthEta) revert ReleaseNotReady();
            queuedReleaseEth -= amt;
        } else {
            if (queuedReleaseUsdc < amt || block.timestamp < queuedReleaseUsdcEta) revert ReleaseNotReady();
            queuedReleaseUsdc -= amt;
        }
    }
}
