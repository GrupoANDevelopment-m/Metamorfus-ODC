/**
 * T12 — does cross-domain knowledge actually improve a task?
 *
 * THE HONEST VERSION
 * ------------------
 * The first implementation claimed a 64.7% gain and called it
 * cross-domain. It was not:
 *
 *   baseline MAE 1.638 -> trader 0.578 -> 2-domain 0.630 -> 3-domain 0.630
 *
 * The two-domain and three-domain results were WORSE than trader
 * alone. The "improvement" was entirely the trader RSI skill, because
 * the meteorology and engineering skills were being fed inputs they do
 * not read, and their outputs were read through keys that do not
 * exist. Both failed silently: the skills returned ok:true and
 * contributed nothing.
 *
 * THE SEED SOURCES ARE THE TRUTH
 * ------------------------------
 * dna_library/*.py are OUTPUTS of adopt(), not the source of truth.
 * The source is server/metamorfus-core/seed-sources.ts, and adopt()
 * writes that payload into the .py file. So the contracts that matter
 * are the ones in seed-sources.ts:
 *
 *   analyze_pressure_gradient  reads stations[{station_id, lat, lon,
 *                              pressure_hpa}], pairs each station with
 *                              its EAST neighbour (lon+1), returns
 *                              gradients[] with magnitude_hpa_per_100km
 *                              SORTED BY MAGNITUDE
 *   engineer_load_calc         reads distributed_kg_m2, span_m,
 *                              point_loads_kg, tributary_width_m;
 *                              returns total_kg, area_m2, point_total_kg
 *   rsi_calculator_v2          reads prices[], returns rsi and signal
 *
 * The adapters below speak exactly those contracts, and each one
 * reports whether it actually produced a usable reading.
 */
import path from "node:path";
import { packageRoot } from "../package-root.mjs";

const ROOT = packageRoot();

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

export function mae(predicted, actual) {
  const n = Math.min(predicted.length, actual.length);
  if (!n) return Infinity;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(predicted[i] - actual[i]);
  return s / n;
}

/** Naive extrapolation: the global slope of the training window. */
export function baselinePredict(train, k = 5) {
  const n = train.length;
  const slope = n > 1 ? (train[n - 1] - train[0]) / (n - 1) : 0;
  const out = [];
  for (let i = 0; i < k; i++) out.push(train[n - 1] + slope * (i + 1));
  return out;
}

/** Mean absolute step of a series — the natural unit for a correction. */
export function stepScale(series) {
  if (!series || series.length < 2) return 1;
  let s = 0;
  for (let i = 1; i < series.length; i++) s += Math.abs(series[i] - series[i - 1]);
  return s / (series.length - 1);
}

async function loadRunner() {
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  return runSkill;
}

/** Unwraps the {ok, result:{result:{...}}} envelope the runner returns. */
function inner(result) {
  const r = result?.result;
  if (r && typeof r === "object" && "result" in r) return r.result;
  return r ?? {};
}

/* ------------------------------------------------------------------ *
 * Domain adapters
 *
 * Each adapter reads one domain's skill, in that domain's own input
 * format, and returns a normalised opinion:
 *   signal    in [-1, 1]  — direction (0 = no opinion)
 *   magnitude in [0. , 2.] — how strongly to act, for domains that
 *                             modulate rather than vote
 *   evidence  — what the skill actually reported
 * ------------------------------------------------------------------ */

/**
 * TRADER — mean reversion.
 *
 * The RSI seed reads `prices` and reports `rsi` plus a `signal` label.
 * RSI at the extreme means the series is stretched away from its
 * recent mean, so the trader's opinion is to pull it back.
 */
async function adaptTrader(workspaceRoot, series) {
  const runSkill = await loadRunner();
  const r = await runSkill(workspaceRoot, {
    skillKey: "rsi_calculator_v2_protocol",
    byProfession: "trader",
    context: { prices: series },
  });
  const data = inner(r);
  if (!r.ok || data.rsi === undefined) {
    return {
      domain: "trader",
      signal: 0,
      available: false,
      contributes: "none",
      evidence: r.error ?? "no rsi",
    };
  }
  const rsi = Number(data.rsi);
  let signal = 0;
  if (rsi > 70) signal = -Math.min(1, (rsi - 70) / 30);
  else if (rsi < 30) signal = Math.min(1, (30 - rsi) / 30);
  return {
    domain: "trader",
    signal,
    available: true,
    contributes: "direction",
    rsi,
    evidence: `rsi=${rsi} (${data.signal})`,
  };
}

/**
 * METEOROLOGY — the rate at which the field changes, and whether that
 * rate is building or decaying.
 *
 * The seed pairs each station with its EAST neighbour, so feeding a
 * contiguous run of stations measures the gradient of every adjacent
 * step. It returns the gradients SORTED BY MAGNITUDE, which destroys
 * the temporal order — so the adapter reads the field in SEGMENTS,
 * one call per segment, and each call reports the mean gradient of
 * that stretch of the series. The sequence of segment rates is the
 * kinetic profile of the field over time.
 *
 * What the meteorologist can say that the trader cannot:
 *   • whether the field's energy is BUILDING (continuation) or
 *     DECAYING (the push is exhausting itself, so it turns)
 * The trader's RSI is a level oscillator; it is blind to whether the
 * underlying field is gaining or losing energy.
 */
const SEGMENTS = 4;

async function adaptMeteorology(workspaceRoot, series) {
  const runSkill = await loadRunner();
  const n = series.length;
  const segSize = Math.floor(n / SEGMENTS);
  if (segSize < 3) {
    return { domain: "meteorology", signal: 0, available: false, contributes: "none", evidence: "window too short" };
  }

  const rates = [];
  const perSegment = [];
  for (let j = 0; j < SEGMENTS; j++) {
    const from = j * segSize;
    const to = j === SEGMENTS - 1 ? n : from + segSize;
    const chunk = series.slice(from, to);
    if (chunk.length < 3) continue;
    const stations = chunk.map((v, i) => ({
      station_id: `s${j}_${i}`,
      lat: 0,
      lon: i,
      pressure_hpa: v,
    }));
    const r = await runSkill(workspaceRoot, {
      skillKey: "analyze_pressure_gradient_protocol",
      byProfession: "meteorologist",
      context: { stations, top_n: stations.length },
    });
    if (!r.ok) {
      return {
        domain: "meteorology",
        signal: 0,
        available: false,
        contributes: "none",
        evidence: r.error ?? "gradient failed",
      };
    }
    const grads = inner(r).gradients ?? [];
    const mags = grads.map((g) => Number(g.magnitude_hpa_per_100km ?? 0));
    if (!mags.length) {
      return { domain: "meteorology", signal: 0, available: false, contributes: "none", evidence: "no gradients" };
    }
    // magnitude_hpa_per_100km = |dp| * 100 / (111.32 * cos(lat)); with
    // lat = 0 that is |dp| * 0.898, so |dp| = magnitude * 1.1132.
    const meanMag = mags.reduce((a, b) => a + b, 0) / mags.length;
    const meanAbsStep = meanMag * 1.1132;
    rates.push(meanAbsStep);
    perSegment.push({ segment: j, from, to, meanMag, meanAbsStep, pairs: mags.length });
  }

  if (rates.length < 3) {
    return { domain: "meteorology", signal: 0, available: false, contributes: "none", evidence: "not enough segments" };
  }

  // The RECENT trend of the rate, not the endpoints: a field can
  // build energy early and lose it late, and only the recent slope
  // says what the field is doing now.
  const recent = rates.slice(-2);
  const rateChange = (recent[1] - recent[0]) / Math.max(recent[0], 1e-9);

  // The push: which way the field is currently moving. The gradient
  // skill reports magnitude only, so the sign of the field's motion
  // comes from the stations the adapter laid out.
  const pushStart = series.length - segSize;
  const push = Math.sign(series[series.length - 1] - series[pushStart]) || 1;

  // BUILDING  -> the push is gaining energy -> continue the push
  // DECAYING  -> the push is losing energy -> it will turn
  const BUILD = 0.08;
  const DECAY = 0.08;
  let signal = 0;
  let reading = "steady";
  if (rateChange > BUILD) {
    signal = push * Math.min(1, rateChange / 0.5);
    reading = "building";
  } else if (rateChange < -DECAY) {
    signal = -push * Math.min(1, -rateChange / 0.5);
    reading = "decaying";
  }

  return {
    domain: "meteorology",
    signal,
    available: true,
    contributes: "direction",
    rateProfile: rates,
    rateChange,
    push,
    reading,
    evidence:
      `rates [${rates.map((r) => r.toFixed(3)).join(", ")}], recent ${(rateChange * 100).toFixed(1)}% (${reading})`,
  };
}

/**
 * ENGINEERING — headroom, and how fast the margin is being consumed.
 *
 * The load-calc seed reads `distributed_kg_m2`, `span_m`,
 * `point_loads_kg` and `tributary_width_m`, and returns total_kg,
 * area_m2 and point_total_kg.
 *
 * The engineering domain does NOT vote on direction. Load alone
 * cannot tell a series that peaked from one that is still climbing:
 * both have accumulated load and both report a high total. Claiming
 * otherwise is exactly what made this domain drag the fusion the
 * wrong way before.
 *
 * What it can honestly say is about CAPACITY. The load is read in
 * SEGMENTS, the same way the meteorologist reads the field, so the
 * profile shows how fast the structure is being consumed. A structure
 * whose load is climbing has less margin left, so the same change in
 * the load path lands harder: the engineering reading multiplies the
 * size of the correction, never its direction.
 */
async function adaptEngineering(workspaceRoot, series) {
  const runSkill = await loadRunner();
  const n = series.length;
  const segSize = Math.floor(n / SEGMENTS);
  if (segSize < 3) {
    return { domain: "engineering", signal: 0, available: false, contributes: "none", evidence: "window too short" };
  }

  const intensities = [];
  for (let j = 0; j < SEGMENTS; j++) {
    const from = j * segSize;
    const to = j === SEGMENTS - 1 ? n : from + segSize;
    const chunk = series.slice(from, to);
    if (chunk.length < 3) continue;
    const r = await runSkill(workspaceRoot, {
      skillKey: "engineer_load_calc_protocol",
      byProfession: "engineer",
      context: {
        distributed_kg_m2: Math.abs(chunk.reduce((a, b) => a + b, 0) / chunk.length),
        span_m: 4,
        point_loads_kg: [Math.abs(chunk[0]), Math.abs(chunk[chunk.length - 1])],
        tributary_width_m: 1,
      },
    });
    const data = inner(r);
    if (!r.ok || data.total_kg === undefined) {
      return {
        domain: "engineering",
        signal: 0,
        available: false,
        contributes: "none",
        evidence: r.error ?? `no total_kg (keys: ${Object.keys(data).join(",") || "none"})`,
      };
    }
    const area = Number(data.area_m2) || 1;
    intensities.push(Number(data.total_kg) / area);
  }

  if (intensities.length < 3) {
    return { domain: "engineering", signal: 0, available: false, contributes: "none", evidence: "not enough segments" };
  }

  // How fast the load is being consumed, recently.
  const growth =
    (intensities[intensities.length - 1] - intensities[intensities.length - 2]) /
    Math.max(intensities[intensities.length - 2], 1e-9);

  // Margin left, against the heaviest load the structure has carried.
  const peak = Math.max(...intensities);
  const headroom = Math.max(0, Math.min(1, 1 - intensities[intensities.length - 1] / (peak * 1.15)));

  // A climbing load means less margin, so the same change lands
  // harder. A load that has stopped climbing means the structure has
  // settled and the change is absorbed.
  const magnitude = Math.max(0.5, Math.min(2.0, 1 + growth));

  return {
    domain: "engineering",
    signal: 0,
    available: true,
    contributes: "magnitude",
    loadProfile: intensities,
    growth,
    headroom,
    magnitude,
    evidence:
      `load [${intensities.map((v) => v.toFixed(1)).join(", ")}], growth ${(growth * 100).toFixed(1)}%, headroom ${headroom.toFixed(2)} -> x${magnitude.toFixed(2)}`,
  };
}

/* ------------------------------------------------------------------ *
 * Fusion
 * ------------------------------------------------------------------ */

/** How hard a fully corroborated call is allowed to push. */
const BASE_GAIN = 1.2;

/**
 * Cross-domain reliability review.
 *
 * A domain can be confidently wrong, and one domain can discredit
 * another. The concrete case: RSI pinned at the extreme on a series
 * that is still building energy looks like a certain reversal call,
 * but mean reversion only works in a range. The meteorology domain's
 * rate profile is the evidence that says the field is NOT ranging —
 * it is accelerating — so the trader abstains and the field's own
 * energy drives the forecast. Neither domain could do this alone.
 */
function reliabilityReview(domains) {
  const trader = domains.find((d) => d.domain === "trader");
  const meteo = domains.find((d) => d.domain === "meteorology");
  if (!trader || !meteo || !trader.available || !meteo.available) return domains;

  const pinned = Math.abs(trader.signal) >= 0.99;
  const building = (meteo.rateChange ?? 0) > 0.08;

  return domains.map((d) => {
    if (d.domain !== "trader") return d;
    if (pinned && building) {
      return {
        ...d,
        signal: 0,
        abstained: true,
        contributes: "none",
        evidence: `${d.evidence}; abstained — RSI pinned but the field is building energy, so the range it assumes is not there`,
      };
    }
    return d;
  });
}

/**
 * Fuse the domain opinions onto the baseline.
 *
 * Direction comes from the domains that have one. Magnitude comes
 * from the domains that modulate. The median of the directional
 * votes rejects a single outlier; a genuine disagreement is resolved
 * by conviction, and an abstention never counts as half a vote
 * against the domain that actually spoke.
 */
export function fuseSignals(baseline, domains, horizon, seriesScale = 1) {
  const available = domains.filter((d) => d.available);
  if (!available.length) return [...baseline];

  const reviewed = reliabilityReview(available);
  const voters = reviewed.filter((d) => Math.abs(d.signal) > 1e-6);
  const modulators = reviewed.filter(
    (d) => Math.abs(d.signal) <= 1e-6 && typeof d.magnitude === "number" && d.contributes === "magnitude",
  );
  if (!voters.length) return [...baseline];

  const signals = voters.map((d) => d.signal).sort((a, b) => a - b);
  let composite;
  let conflict = false;
  if (signals.length === 1) {
    composite = signals[0];
  } else if (signals.length % 2 === 1) {
    composite = signals[Math.floor(signals.length / 2)];
  } else {
    const lower = signals[signals.length / 2 - 1];
    const upper = signals[signals.length / 2];
    if (lower < 0 && upper > 0) {
      conflict = true;
      composite = Math.abs(lower) >= Math.abs(upper) ? lower : upper;
    } else {
      composite = (lower + upper) / 2;
    }
  }

  let magnitude = 1;
  for (const m of modulators) magnitude *= m.magnitude;

  // Corroboration is worth something, but not everything: two domains
  // agreeing is stronger than one alone, and two domains disagreeing
  // is weaker than either. Squared, so a lone opinion moves the
  // forecast much less than a corroborated pair.
  //
  // The exception is the case where a domain was silenced BY the
  // reliability review. The review is itself cross-domain evidence:
  // the trader was discredited because the field's energy profile
  // contradicted the range its RSI assumes. Discounting the surviving
  // opinion for lack of company would throw away exactly the
  // corroboration the review produced, so a reviewed survivor counts
  // as corroborated.
  const silenced = reviewed.filter((d) => d.abstained).length;
  const consensus = Math.min(1, voters.length / 2);
  let consensusGain = consensus * consensus;
  if (silenced > 0) consensusGain = 1;
  if (conflict) consensusGain *= 0.5;

  const out = [...baseline];
  for (let i = 0; i < horizon; i++) {
    // The nudge grows with the step, the way a trend extrapolates, and
    // it is measured in the series' own step units.
    out[i] += composite * magnitude * consensusGain * BASE_GAIN * seriesScale * (i + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

/**
 * A rise that saturates and turns.
 *
 * Three properties, each of which a different domain can see and no
 * single one can see alone:
 *   1. it ends OVERBOUGHT, so the trader's RSI has an opinion
 *   2. its slope DECAYS, so the meteorology gradient has an opinion
 *   3. it accumulates LOAD, so the engineering reading has one
 */
export function generateTimeSeries(n = 50, horizon = 8, seed = 42) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const train = [];
  let v = 40;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const slope = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.06;
    v += slope + (rnd() - 0.5) * 0.10;
    train.push(v);
  }
  const test = [];
  let w = train[train.length - 1];
  for (let i = 0; i < horizon; i++) {
    w -= 0.42 + (rnd() - 0.5) * 0.18;
    test.push(w);
  }
  return { train, test };
}

/**
 * A rise that ACCELERATES.
 *
 * The naive baseline extrapolates the GLOBAL slope, well below the
 * recent one, so it systematically under-predicts. RSI is pinned at the
 * extreme the whole window, so the trader reads a certain reversal.
 * The truth is that the series keeps rising: the trader's call is
 * confidently wrong, and only the field's energy profile can say so.
 */
export function generateDivergentSeries(n = 50, horizon = 8, seed = 7) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const train = [];
  let v = 40;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    v += 0.20 + 0.90 * t + (rnd() - 0.5) * 0.10;
    train.push(v);
  }
  const test = [];
  let w = train[train.length - 1];
  for (let i = 0; i < horizon; i++) {
    w += 1.05 + (rnd() - 0.5) * 0.12;
    test.push(w);
  }
  return { train, test };
}

/* ------------------------------------------------------------------ *
 * Fraud helpers (used by T13)
 * ------------------------------------------------------------------ */

export function generateFraudDataset(n = 100, nFraud = 10) {
  const txs = [];
  const fraudIds = new Set();
  const idPick = () => `tx_${(txs.length + 1).toString().padStart(4, "0")}`;

  for (let i = 0; i < n - nFraud; i++) {
    txs.push({
      id: idPick(),
      amount: 50 + Math.random() * 150,
      merchant: ["amazon", "walmart", "target", "costco"][i % 4],
      hour: 8 + (i % 12),
    });
  }
  for (let i = 0; i < nFraud; i++) {
    const id = idPick();
    fraudIds.add(id);
    const profile = i % 3;
    if (profile === 0) {
      txs.push({ id, amount: 5000 + Math.random() * 5000, merchant: "unknown", hour: 3 });
    } else if (profile === 1) {
      txs.push({ id, amount: 80 + Math.random() * 20, merchant: "shell_corp", hour: 2 });
    } else {
      txs.push({ id, amount: 100, merchant: "sketchy_llc", hour: 4 });
    }
  }
  return { txs, fraudIds };
}

export async function runSkillOnFraud(workspaceRoot, skillKey, profession, txsOrContext) {
  const runSkill = await loadRunner();
  let context;
  if (Array.isArray(txsOrContext)) context = { transactions: txsOrContext };
  else if (txsOrContext && typeof txsOrContext === "object") context = txsOrContext;
  else context = {};
  return runSkill(workspaceRoot, { skillKey, byProfession: profession, context });
}

export async function runMultiDomain(workspaceRoot, skills, txs) {
  const { combineResults } = await import(path.join(ROOT, "server/cognitive/synthesis.mjs"));
  const { adopt } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.js"));
  const c = { workspaceRoot, dnaDir: "packages/metamorfus-src/dna_library" };
  const results = [];
  for (const { skillKey, profession, context } of skills) {
    await adopt(profession, c);
    const r = await runSkillOnFraud(workspaceRoot, skillKey, profession, context ?? txs);
    results.push({ key: skillKey, profession, ok: r.ok, result: r.result });
  }
  return combineResults(results);
}

export function scoreFraudPrediction(flagged, fraudIds) {
  const flaggedSet = new Set(flagged);
  let tp = 0, fp = 0, fn = 0;
  for (const id of flaggedSet) {
    if (fraudIds.has(id)) tp++;
    else fp++;
  }
  for (const id of fraudIds) {
    if (!flaggedSet.has(id)) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision,
    recall,
    f1,
    flagged: flaggedSet.size,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
  };
}

/* ------------------------------------------------------------------ *
 * The measurement
 * ------------------------------------------------------------------ */

async function measureScenario(workspaceRoot, gen, label) {
  const { train, test } = gen;
  const baseline = baselinePredict(train, test.length);
  const baselineErr = mae(baseline, test);

  const trader = await adaptTrader(workspaceRoot, train);
  const meteor = await adaptMeteorology(workspaceRoot, train);
  const eng = await adaptEngineering(workspaceRoot, train);
  const domains = [trader, meteor, eng];

  const scale = stepScale(train);
  const reviewed = reliabilityReview(domains.filter((d) => d.available));

  const single = {};
  for (const d of domains) {
    single[d.domain] = d.available
      ? mae(fuseSignals(baseline, [d], test.length, scale), test)
      : null;
  }

  const traderErr = mae(fuseSignals(baseline, [trader], test.length, scale), test);
  const twoErr = mae(fuseSignals(baseline, [trader, meteor], test.length, scale), test);
  const threeErr = mae(fuseSignals(baseline, domains, test.length, scale), test);

  const singles = Object.values(single).filter((v) => v !== null);
  const bestSingle = singles.length ? Math.min(...singles) : Infinity;
  const bestSingleName =
    Object.entries(single).find(([, v]) => v !== null && v === bestSingle)?.[0] ?? "n/a";

  const everyDomainContributed =
    domains.every((d) => d.available) &&
    // the extra domains must have MOVED the answer, not just run
    Math.abs(threeErr - traderErr) > 1e-6;

  return {
    label,
    baselineMAE: baselineErr,
    traderOnlyMAE: traderErr,
    twoDomainMAE: twoErr,
    threeDomainMAE: threeErr,
    singleDomainMAE: single,
    bestSingleMAE: bestSingle,
    bestSingleName,
    improvementPct: baselineErr > 0 ? (1 - threeErr / baselineErr) * 100 : 0,
    beatsBestSingle: threeErr < bestSingle,
    everyDomainContributed,
    domains: reviewed.map((d) => ({
      domain: d.domain,
      available: d.available,
      contributes: d.contributes,
      signal: Number(d.signal.toFixed(4)),
      abstained: !!d.abstained,
      evidence: d.evidence,
    })),
    raw: { trader, meteor, eng },
  };
}

export async function measurePerformanceGain(workspaceRoot) {
  const agreement = await measureScenario(
    workspaceRoot,
    generateTimeSeries(50, 8),
    "agreement: a rise that saturates and turns",
  );
  const disagreement = await measureScenario(
    workspaceRoot,
    generateDivergentSeries(50, 8),
    "disagreement: a rise that accelerates",
  );

  const both = agreement.beatsBestSingle && disagreement.beatsBestSingle;
  const anyContribution =
    agreement.everyDomainContributed && disagreement.everyDomainContributed;

  return {
    ...agreement,
    disagreement: {
      label: disagreement.label,
      baselineMAE: disagreement.baselineMAE,
      traderOnlyMAE: disagreement.traderOnlyMAE,
      twoDomainMAE: disagreement.twoDomainMAE,
      threeDomainMAE: disagreement.threeDomainMAE,
      singleDomainMAE: disagreement.singleDomainMAE,
      bestSingleMAE: disagreement.bestSingleMAE,
      bestSingleName: disagreement.bestSingleName,
      improvementPct: disagreement.improvementPct,
      beatsBestSingle: disagreement.beatsBestSingle,
      everyDomainContributed: disagreement.everyDomainContributed,
      domains: disagreement.domains,
    },
    verdict: !anyContribution
      ? "NOT a cross-domain result: at least one domain produced no usable signal, or the extra domains did not move the answer"
      : both
        ? "Cross-domain fusion beats every single domain and the baseline, on both cases"
        : "Fusion is real and beats the baseline, but does not beat the best single domain on every case",
  };
}
