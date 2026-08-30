// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function approve(address spender, uint256 amt) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
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
    uint256 public constant ALPHA_BPS = 4_000; // α = 40%
    uint256 public constant WAD = 1e18;
    uint256 public constant INSURANCE_NAV_MIN_BPS = 100; // < 1% insurance/NAV halts new short gamma
    /// @notice Minimum first deposit ($5k) so totalSupply cannot be captured cheaply.
    uint256 public constant MIN_FIRST_DEPOSIT_USDC = 5_000e6;
    /// @notice Virtual shares/NAV offset ($1) — bounds first-depositor share
    ///         inflation to ~$1 per round trip (ERC4626-style offset).
    uint256 public constant VIRTUAL_SHARES = 1e6;
    uint256 public constant VIRTUAL_NAV = 1e6;

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
    uint256 public insuranceWpit;

    mapping(address => uint256) public shareOf;
    /// @notice DEX aggregator routers `exec` may call (owner-set).
    mapping(address => bool) public allowedTarget;

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

    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event OperatorSet(address indexed previous, address indexed next);
    event OracleSet(address indexed previous, address indexed next);
    event TargetAllowed(address indexed target, bool allowed);
    event AllowanceSet(address indexed token, address indexed spender, uint256 amount);
    event Deposit(address indexed who, uint256 ethAmt, uint256 usdcAmt, uint256 minted);
    event PausedSet(bool v);
    event InsuranceCredited(uint256 usdcAmt, uint256 wpitAmt);
    event RiskOpened(bytes4 indexed sig, uint256 a, uint256 b);
    event RiskReleased(bytes4 indexed sig, uint256 a);
    event Executed(address indexed target, bytes data);

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

    constructor(IERC20 usdc_, IERC20 weth_, IOracle oracle_, address owner_, address operator_) {
        if (owner_ == address(0) || operator_ == address(0)) revert Zero();
        usdc = usdc_;
        weth = weth_;
        oracle = oracle_;
        owner = owner_;
        operator = operator_;
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

    function pause(bool v) external onlyOwner {
        paused = v;
        emit PausedSet(v);
    }

    /// @notice ACCOUNTING ONLY (F16): books `usdcAmt` into insuranceUsdc.
    ///         No tokens move — the caller must transfer the backing USDC to
    ///         this contract first (treasury top-up), or the number is a
    ///         ledger entry and the fund is NOT actually 1:1 backed. Insurance
    ///         is only drawn during liquidation/settlement paths that move
    ///         real USDC, so an unbacked credit would make those paths fail
    ///         (vault runs out of USDC) rather than silently mint.
    function creditInsurance(uint256 usdcAmt) external onlyOwner {
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

    // --------------------------------------------------- aggregator spot route

    function allowTarget(address target, bool ok) external onlyOwner {
        if (target == address(this) || target == address(0)) revert BadTarget();
        allowedTarget[target] = ok;
        emit TargetAllowed(target, ok);
    }

    /// @notice Owner grants token allowances to allowlisted routers only.
    function setAllowance(IERC20 token, address spender, uint256 amount) external onlyOwner {
        if (!allowedTarget[spender]) revert BadTarget();
        token.approve(spender, amount); // IERC20-minimal: extend with safeApprove in prod if needed
        emit AllowanceSet(address(token), spender, amount);
    }

    /// @notice Keeper executes an allowlisted aggregator call (swap/hedge).
    ///         Value is not attached; routers pull pre-approved tokens.
    function exec(address target, bytes calldata data) external onlyOperator nonReentrant returns (bytes memory) {
        if (!allowedTarget[target]) revert BadTarget();
        emit Executed(target, data);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
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
            weth.transferFrom(msg.sender, address(this), ethAmt);
            ethBal += ethAmt;
        }
        if (usdcAmt > 0) {
            usdc.transferFrom(msg.sender, address(this), usdcAmt);
            usdcBal += usdcAmt;
        }
        uint256 minted = (value * (shares + VIRTUAL_SHARES)) / (navPre + VIRTUAL_NAV);
        shares += minted;
        shareOf[msg.sender] += minted;
        emit Deposit(msg.sender, ethAmt, usdcAmt, minted);
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
        if (ethBal < size) revert NakedCall();
        uint256 lock = (size * p) / WAD;
        reservedUsdc += lock; // reserved first so a reentrant call sees it

        uint256 wethBefore = weth.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));
        (bool ok, bytes memory ret) = router.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        uint256 wethSpent = wethBefore - weth.balanceOf(address(this));
        uint256 usdcReceived = usdc.balanceOf(address(this)) - usdcBefore;
        if (wethSpent != size) revert SwapSize();
        if (usdcReceived < minOutUsdc) revert Slippage();

        ethBal -= size;
        usdcBal += usdcReceived;
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
        emit RiskOpened(this.openShort.selector, size, p);
    }

    /// @notice Reconcile internal counters with real token balances after an
    ///         `exec` swap that the vault did not book itself. Reverts when
    ///         real balances are below reserved amounts — a loss must be
    ///         investigated, never silently absorbed into the ledger.
    function reconcileBalances() external onlyOperator {
        uint256 e = weth.balanceOf(address(this));
        uint256 u = usdc.balanceOf(address(this));
        if (e < reservedEth || u < reservedUsdc) revert UnreconciledLoss();
        ethBal = e;
        usdcBal = u;
    }

    function releaseCall(uint256 size) external live onlyOperator nonReentrant {
        if (size > reservedEth) revert Zero();
        reservedEth -= size;
        emit RiskReleased(this.releaseCall.selector, size);
    }

    function releasePut(uint256 lock) external live onlyOperator nonReentrant {
        if (lock > reservedUsdc) revert Zero();
        reservedUsdc -= lock;
        emit RiskReleased(this.releasePut.selector, lock);
    }
}
