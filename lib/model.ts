// The token radar's model (v2, "comps"): one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// the pre-token protocols below the floor that could plausibly issue a token of their own: the
// early rows the radar exists to find. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept apart and shown with
// the market's own values, never mixed into the ranked board.
//
// Implied value is a comparables valuation, derived only from the snapshot's own figures:
//
//   multiple   = the category's median mcap/TVL among the snapshot's tokened protocols,
//                winsorised, shrunk toward the market-wide median, and capped. A category
//                with fewer than 3 listed comparables uses the market-wide median outright:
//                one or two names are not a market. No protocol name is ever special-cased.
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x 0.35
//   maturity   = 0.8 + min(age_days, 1095) / 1095 x 0.2   (age_days unknown: 365)
//   breadth    = 1 + min(chains - 1, 5) x 0.02
//   implied    = max(1, round(base x growthMult x maturity x breadth))
//
// Every factor is a function of the protocol's own record (TVL, 7-day growth, age, chain count)
// and of the market the snapshot itself records (the category multiple). The dashboard's detail
// view shows each factor with the numbers behind it, and the category's comparables beside it,
// so a reader can re-derive any row's value from the snapshot alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
  shrink_prior: number;
  winsor_low: number;
  winsor_high: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_comps: 3,
  shrink_prior: 5,
  winsor_low: 0.005,
  winsor_high: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-comps-2';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    category_median: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_n: number;
  category_median: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** One listed comparable: a tokened protocol in the same category. */
export interface CompRow {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** A category's multiple and the comparables behind it. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
  comps: CompRow[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  multiples: CategoryMultiple[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-unsorted list, or null when it is empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a product of a token that already trades, not a launch of their own. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name carrying a whole word wrapped, staked or staking is a product, not a protocol. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol could plausibly issue a token of its own: pre-token, not a wrapped, staked
 * or bridged product of a token that already trades, not a versioned pool, not an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The market-wide median mcap/TVL and every category's multiple, from the snapshot's tokened
 * protocols. Ratios are winsorised before the median; a category with fewer than `min_comps`
 * comparables takes the market-wide median; the rest shrink toward it by n / (n + prior). */
export function buildMultiples(protocols: SnapshotProtocol[], model: ModelConstants): { global: number; byCategory: Map<string, CategoryMultiple> } {
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const clip = (r: number): number => Math.min(model.winsor_high, Math.max(model.winsor_low, r));
  const allRatios = live.map((p) => clip(p.mcap_usd! / p.tvl_usd));
  const global = median(allRatios) ?? 0.2;
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? '(no category)';
    const list = byCat.get(key);
    if (list) list.push(p);
    else byCat.set(key, [p]);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, members] of byCat) {
    const ratios = members.map((p) => clip(p.mcap_usd! / p.tvl_usd));
    const catMedian = median(ratios);
    const comps: CompRow[] = members
      .map((p) => ({ slug: p.slug, name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd, ratio: p.mcap_usd! / p.tvl_usd }))
      .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1))
      .slice(0, 5);
    let multiple: number;
    if (catMedian === null || members.length < model.min_comps) {
      multiple = global;
    } else {
      const w = members.length / (members.length + model.shrink_prior);
      multiple = catMedian * w + global * (1 - w);
    }
    multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiple));
    byCategory.set(category, { category, n: members.length, median: catMedian, multiple, comps });
  }
  return { global, byCategory };
}

/** The four factors and the implied value one protocol gets under the comps model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  multipleN: number,
  categoryMedian: number | null,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the position open.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the receipt.`;
  if (c.includes('launchpad')) return `Stake $${capital} of the launchpad's asset on ${name} and join one sale.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's main risk, in one line a farmer can act on. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lending risk: a sharp price move can liquidate a borrow, so never borrow against the whole deposit and keep the health factor above 2.`;
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative')) return `Pool risk: impermanent loss and a thin pool can eat the yield, so check the pool's depth before the deposit and size it small.`;
  if (c.includes('bridge')) return `Bridge risk: a bridge is a custodian of the funds in transit, so move in two smaller transfers instead of one large one.`;
  if (c.includes('staking') || c.includes('restak')) return `Slashing risk: a validator fault can cut the stake, so use the protocol's own validator set and never stake the whole wallet.`;
  if (c.includes('prediction')) return `Market risk: a prediction position can go to zero, so treat the stake as the cost of the farm, not as an investment.`;
  if (c.includes('curator') || c.includes('allocator')) return `Manager risk: a curator's strategy can change without notice, so read the vault's strategy page each month and exit if it drifts.`;
  if (c.includes('rwa')) return `Issuer risk: a real-world asset depends on its off-chain issuer, so check the issuer's audits and attestations before minting.`;
  if (c.includes('stable')) return `Peg risk: a stable asset can depeg, so never hold the whole farm in the one asset and watch its peg weekly.`;
  return `Smart-contract risk: the protocol's contracts are the farm's whole exposure, so keep the position to money you can afford to lose and check its audits.`;
}

/** A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, 7-day growth), never from a
 * hand-written list of names. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const tvlM = (p.tvl_usd / 1e6).toFixed(p.tvl_usd >= 1e9 ? 0 : 1);
  const growth = p.change_7d === null ? 'unreported' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`;
  const chainsText = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains, starting with ${chain}.` : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Watch the signal that put ${p.name} on this board: $${tvlM}M of TVL, ${growth} over the last 7 days.${chainsText} Keep farming while the TVL holds above its floor, and check the growth again each week.`,
      cost: 'nothing but the check',
      time: '5 minutes a week',
    },
    {
      text: riskFor(p),
      cost: 'nothing to check',
      time: '15 minutes of reading',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: Map<string, CategoryMultiple>; global: number } {
  const { global, byCategory } = buildMultiples(snapshot.protocols, model);
  const multipleFor = (p: SnapshotProtocol): CategoryMultiple | undefined => byCategory.get(p.category ?? '(no category)');
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that could plausibly issue a
  // token of their own, by TVL. Never a replacement for a watchlist row: a chosen protocol stays
  // chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const cat = multipleFor(p);
    const multiple = cat?.multiple ?? global;
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, multiple, cat?.n ?? 0, cat?.median ?? null, model);
    return { p, implied, growthPct, growthMult, maturityMult, breadthMult, age, multiple, multipleN: cat?.n ?? 0, categoryMedian: cat?.median ?? null };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // The multiple stays full-precision: the dashboard recomputes the row's value in the page
      // from this same figure, so the page's arithmetic and the board's must agree exactly.
      multiple: s.multiple,
      multiple_n: s.multipleN,
      category_median: s.categoryMedian === null ? null : round4(s.categoryMedian),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, multiples: byCategory, global };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot, count = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, count)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_n: row.model.multiple_n,
    category_median: row.model.category_median,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples, global } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiplesList = [...multiples.values()]
    .filter((m) => board.some((r) => r.category === m.category || (r.category === null && m.category === '(no category)')))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: Math.round(global * 1e4) / 1e4,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    multiples: multiplesList,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
