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
};

export type OptionPos = {
  id: string;
  type: OptType;
  strike: number;
  expiry: number;
  sizeEth: number;
  premium: number;
  openedAt: number;
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
  created: number;
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
  insuranceUsdc: number;
  circuitUntil: number;
  simSpeed: 1 | 10 | 60;
  liquidations: number;
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
export const STAKE_APR = 0.12;
export const INSURANCE_SEED = 25_000;
