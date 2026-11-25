// Fresh scoring engine for the token radar.
//
// One frozen snapshot goes in; a ranked board of protocols that have not
// launched a token yet comes out. Every number the board shows is derived
// from the snapshot's own figures at run time: the base multiple is the
// median market-cap-to-TVL of the snapshot's own live-token protocols, so
// no protocol is ever priced from a hand-picked constant, and no protocol
// name is ever special-cased.

export interface ProtocolRecord {
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

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

export interface ScoreParts {
  implied: number;
  growthPct: number;
  damp: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
    base_multiple: number;
    growth_pct: number;
    growth_damp: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface CompactRow {
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
  growth_damp: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface DashPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelTuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_for_multiple: number;
  rows: CompactRow[];
  live: LiveRow[];
}

export interface ModelTuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_damp_tvl: number;
  growth_damp_floor: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL_VERSION = 'radar-2';
export const LIVE_VIEW_COUNT = 24;

// Tuning that does not come from the snapshot itself. The base multiple is
// derived at run time and filled in separately.
export const TUNING: Omit<ModelTuning, 'base_multiple'> = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  growth_damp_tvl: 100_000_000,
  growth_damp_floor: 0.25,
  maturity_floor: 0.6,
  maturity_range: 0.6,
  maturity_days: 1825,
  unknown_age_days: 365,
};

const DAY_MS = 86_400_000;
const BLOCKED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_TAIL = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;

/** True when the record shows no token at all. */
export function isTokenless(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the protocol is a wrapped, staked or bridged product of a token that already trades. */
export function isDerivativeProduct(p: ProtocolRecord): boolean {
  const cat = p.category ?? '';
  if (BLOCKED_CATEGORIES.has(cat)) return true;
  if (cat.toLowerCase().includes('bridge')) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_START.test(p.name)) return true;
  return false;
}

/** True when the protocol may rank: tokenless, not a derivative product, not a versioned pool. */
export function canRank(p: ProtocolRecord): boolean {
  return isTokenless(p) && !isDerivativeProduct(p) && !VERSION_TAIL.test(p.name);
}

/** Whole days from a listing date to the snapshot date; null when either date is missing or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A finite number, or the fallback when the value is missing or not finite. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The base multiple from the snapshot itself: the median market-cap/TVL
 * across live-token protocols that are not exchanges and carry both a
 * market cap and a TVL. Rounded to four decimals.
 */
export function baseMultipleOf(snap: SnapshotDoc): { multiple: number; count: number } {
  const ratios = snap.protocols
    .filter((p) => !isTokenless(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return { multiple: 0.25, count: 0 };
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { multiple: Math.round(median * 1e4) / 1e4, count: ratios.length };
}

/** Score one protocol: the three multipliers and its implied value. */
export function scoreOne(p: ProtocolRecord, asOf: string, tuning: ModelTuning): ScoreParts {
  const age = daysSince(asOf, p.listed_at);
  const rawGrowth = numOr(p.change_7d, 0);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, rawGrowth));
  const damp = Math.min(1, Math.max(tuning.growth_damp_floor, Math.sqrt(p.tvl_usd / tuning.growth_damp_tvl)));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight * damp;
  const ageUsed = age ?? tuning.unknown_age_days;
  const maturityMult =
    tuning.maturity_floor +
    (Math.min(Math.max(ageUsed, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * tuning.base_multiple * growthMult * maturityMult));
  return { implied, growthPct, damp, growthMult, maturityMult, age };
}

/** Cheapest chain first, by a general cheap-first order; the first chain when nothing matches. */
const CHEAP_ORDER = [
  'Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche',
  'Sui', 'Aptos', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mode', 'Zora',
  'Ethereum', 'Bitcoin', 'Hyperliquid L1',
];

export function cheapestChain(p: ProtocolRecord): string {
  if (p.chains.length === 0) return 'its main chain';
  for (const c of CHEAP_ORDER) if (p.chains.includes(c)) return c;
  return p.chains[0]!;
}

/** Capital for one farm position, from the protocol's own TVL. */
function capitalTier(p: ProtocolRecord): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Holding window in days, from the protocol's age. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one action for the protocol's category, in words a farmer can follow. */
function actionSentence(p: ProtocolRecord, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('yield') || c.includes('farm')) {
    return `Deposit $${capital} into ${name}'s highest-yield pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge') || c.includes('canonical bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading') || c.includes('options')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small position.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('launchpad')) return `Join the next ${name} launch with $${capital} of USDC and hold the allocation.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('oracle')) return `Deposit $${capital} as stake to run a ${name} oracle feed on ${chain}.`;
  if (c.includes('privacy')) return `Deposit $${capital} into a ${name} privacy pool on ${chain} and keep the receipt.`;
  if (c.includes('gaming') || c.includes('gamefi')) return `Buy $${capital} of in-game assets on ${name} and play one session a week.`;
  if (c.includes('social')) return `Create a profile on ${name}, post once a week and hold $${capital} of its asset.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('btc') || c.includes('anchor')) return `Bridge $${capital} of BTC through ${name} and hold the receipt on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name} and use its apps once a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: action, then cost and time. */
export function renderStep(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Six farm steps for one protocol, derived from its own record only. */
export function planFor(p: ProtocolRecord, age: number | null, asOf: string): FarmStep[] {
  const chain = cheapestChain(p);
  const capital = capitalTier(p);
  const hold = holdWindow(age);
  const action = actionSentence(p, capital, chain);
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
      text: `Make one qualifying action each week on ${chain}, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `As of the ${asOf} snapshot, watch ${p.name}'s own site and channels for a points page or a token announcement, and claim only from links it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Build the ranked board: watchlist first as the floor, then every other rankable protocol. */
export function buildBoard(snap: SnapshotDoc, tuning: ModelTuning): BoardRow[] {
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, ProtocolRecord>();
  for (const slug of snap.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  for (const p of snap.protocols) {
    if (!picked.has(p.slug) && canRank(p)) picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => {
    const s = scoreOne(p, snap.as_of, tuning);
    return { p, s };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_multiple: tuning.base_multiple,
        growth_pct: s.growthPct,
        growth_damp: round4(s.damp),
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: planFor(p, s.age, snap.as_of).map(renderStep),
    };
  });
}

/** Live-token protocols by market cap, for the dashboard's live view. */
export function liveTop(snap: SnapshotDoc): LiveRow[] {
  return snap.protocols
    .filter((p) => !isTokenless(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_VIEW_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot and the board. */
export function buildPayload(
  snap: SnapshotDoc,
  board: BoardRow[],
  tuning: ModelTuning,
  liveCount: number,
): { payload: DashPayload; board: BoardRow[] } {
  const live = liveTop(snap);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const payload: DashPayload = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: tuning,
    model_version: MODEL_VERSION,
    watchlist_size: snap.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_for_multiple: liveCount,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      growth_damp: r.model.growth_damp,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
    })),
    live,
  };
  return { payload, board };
}

/** The dashboard's dataset as one script tag's worth of JavaScript. */
export function dataScript(payload: DashPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}

export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

/** Parse and shape-check a snapshot file's text. */
export function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotShapeError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotShapeError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotShapeError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotShapeError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotShapeError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotShapeError('snapshot.json has no watchlist of slugs');
  }
  const protocols: ProtocolRecord[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotShapeError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board fails the gate, or null when it passes. */
export function boardProblem(board: BoardRow[], snap: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}
