export type Side = "buy" | "sell";
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

export type SpotPos = {
  asset: "ETH" | "WPIT" | "USDC";
  qty: number;
  avg: number;
};

export type FuturePos = {
  id: string;
  side: FutSide;
  sizeEth: number;
  entry: number;
  expiry: number;
  margin: number;
  openedAt: number;
  under?: string;
};

export type OptionPos = {
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
};

export type VaultState = {
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

export type LpPosition = {
  poolId: PoolId;
  shares: number;
  costUsdc?: number;
};

export type StakePos = {
  amount: number;
  since: number;
};

export type PaperAccount = {
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

export type GameBet = {
  id: string;
  raceId: string;
  kind: RaceKind;
  runner: number;
  name: string;
  stake: number;
  odds: number;
  placedAt: number;
  status: "open" | "won" | "lost";
  payout: number;
};

export type GameMeet = {
  raceId: string;
  kind: RaceKind;
  winner: number;
  winnerName: string;
  paid: number;
  at: number;
};

export type GamesState = {
  vaultWpit: number;
  bets: GameBet[];
  meets: GameMeet[];
};

export type EngineState = {
  clock: number;
  eth: number;
  ethBid: number;
  ethAsk: number;
  wpit: number;
  iv: number;
  realizedVol: number;
  candles: Candle[];
  wpitCandles: Candle[];
  btc: number;
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
export const START_WPIT = 50_000;
export const MINI_ETH = 0.1;
export const FUT_IM = 0.25;
export const FUT_MM = 0.125;
export const SPOT_FEE = 0.003;
export const DERIV_FEE = 0.0005;
export const UTIL_CAP = 0.4;
export const WPIT_EMIT_PER_SEC = 0.08;
export const DERIV_UNDERS = ["ETH", "WPIT"] as const;
export const STAKE_APR = 0.12;
export const INSURANCE_SEED = 25_000;
