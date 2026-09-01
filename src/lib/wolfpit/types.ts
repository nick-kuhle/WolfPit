export type FutSide = "long" | "short";
export type OptType = "call" | "put";
export type Product = "spot" | "future" | "option";
export type PoolId = string;

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type FuturePos = {
  id: string;
  side: FutSide;
  sizeEth: number;
  entry: number;
  expiry: number;
  margin: number;
  openedAt: number;
  under?: string;
};

type OptionPos = {
  id: string;
  type: OptType;
  strike: number;
  expiry: number;
  sizeEth: number;
  premium: number;
  openedAt: number;
  under?: string;
  securedUsdc?: number;
  securedEth?: number;
};

export type OrderFill = {
  id: string;
  t: number;
  product: Product;
  symbol: string;
  side: string;
  size: number;
  price: number;
  fee: number;
  note?: string;
  pnl?: number;
  before?: CashShot;
  after?: CashShot;
  fair?: { raceId: string; commit: string; seed?: string; winner?: number };
};

export type CashShot = {
  usdc: number;
  eth: number;
  wpit: number;
};

type VaultState = {
  eth: number;
  usdc: number;
  reservedEth: number;
  reservedUsdc: number;
  hedgeEth: number;
  escrowUsdc?: number;
};

export type PoolState = {
  id: PoolId;
  base: string;
  quote: string;
  baseReserve: number;
  quoteReserve: number;
  lpSupply: number;
  feeBps: number;
};

type LpPosition = {
  poolId: PoolId;
  shares: number;
  costUsdc?: number;
};

type StakePos = {
  amount: number;
  since: number;
};

type PaperAccount = {
  usdc: number;
  eth: number;
  wpit: number;
  tokens: Record<string, number>;
  realized: number;
  startEquity: number;
};

export type OrderKind = "mkt" | "lmt" | "stp" | "stl";
export type Tif = "day" | "gtc" | "ioc";
export type DeskSide = "buy" | "sell";

export type WorkingOrder = {
  id: string;
  product: Product;
  side: DeskSide;
  kind: OrderKind;
  tif: Tif;
  qty: number;
  limit?: number;
  stop?: number;
  poolId?: PoolId;
  expiry?: number;
  strike?: number;
  optType?: OptType;
  under?: string;
  created: number;
};

export type RaceKind = "horse" | "dog";
export type BetMarket = "win" | "place" | "show" | "quinella" | "exacta";

export type GameBet = {
  id: string;
  raceId: string;
  kind: RaceKind;
  runner: number;
  runnerB?: number;
  name: string;
  stake: number;
  odds: number;
  market: BetMarket;
  placedAt: number;
  status: "open" | "won" | "lost" | "refunded";
  payout: number;
  groupId?: string;
};

export type FairRace = {
  id: string;
  kind: RaceKind;
  commit: string;
  seed: string;
  winner: number;
};

export type GameMeet = {
  raceId: string;
  kind: RaceKind;
  winner: number;
  winnerName: string;
  paid: number;
  at: number;
  commit?: string;
  seed?: string;
};

export type GamesState = {
  vaultWpit: number;
  bets: GameBet[];
  meets: GameMeet[];
  races?: Record<string, FairRace>;
};

export type EngineState = {
  clock: number;
  eth: number;
  ethBid: number;
  ethAsk: number;
  wpit: number;
  iv: number;
  realizedVol: number;
  /**
   * Dedicated long-history vol series (~1h bars, ~41 days), separate from
   * `candles` which serves the chart at whatever interval the user picked.
   * Risk inputs must not depend on the chart's zoom level.
   */
  volCandles: Candle[];
  /** Bars in the series the vol estimate actually came from. */
  rvBars: number;
  /** Hours of history behind the vol estimate. */
  rvSpanHours: number;
  /** True when the vol estimate came from real data rather than the prior. */
  rvLive: boolean;
  candles: Candle[];
  wpitCandles: Candle[];
  liveAt: number;
  liveSource: string;
  account: PaperAccount;
  vault: VaultState;
  pools: Record<PoolId, PoolState>;
  lp: LpPosition[];
  stake: StakePos;
  futures: FuturePos[];
  options: OptionPos[];
  fills: OrderFill[];
  working: WorkingOrder[];
  farmWpit: number;
  harvestedWpit: number;
  insuranceUsdc: number;
  circuitUntil: number;
  simSpeed: 1 | 10 | 60;
  liquidations: number;
  equityTape: Candle[];
  compJoined: boolean;
  compPaid: boolean;
  games?: GamesState;
};

export const START_ETH = 1000;
export const START_USDC = 100_000;
export const START_WPIT = 100_000;
export const MINI_ETH = 0.1;
export const FUT_IM = 0.25;
export const FUT_MM = 0.125;
export const DERIV_FEE = 0.0005;
export const UTIL_CAP = 0.4;
export const WPIT_EMIT_PER_SEC = 0.08;
export const DERIV_UNDERS = ["ETH", "WPIT"] as const;
export const STAKE_APR = 0.12;
export const INSURANCE_SEED = 25_000;
