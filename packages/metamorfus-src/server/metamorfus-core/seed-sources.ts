/**
 * Skill bodies for each profession's seed skills. Kept separate from
 * `professions.ts` so the bodies stay readable.
 *
 * Convention:
 *   • python skills expose `def skill(organism, context)`
 *   • javascript skills expose `function skill(organism, context)`
 *   • shell skills are single-line bash pipelines
 *   • spec skills are reference data with no executable body
 *   • each seed carries `reactivation_triggers` so dormant skills can
 *     wake on context match and earn transferable=true
 *
 * Each seed now carries `reactivation_triggers` — context tokens that
 * wake the skill while it's dormant (i.e., during a metamorphosis into
 * a profession whose current focus doesn't match this skill's focus).
 */

import type { SkillRuntime, SkillPayload } from "./types.js";

export interface SeedSpec {
  /** Default runtime — overridable at the profession level. */
  runtime: SkillRuntime;
  /** Runtime-specific payload. */
  payload: SkillPayload;
  /** Default reactivation_triggers; can be overridden at the skill level. */
  reactivation_triggers: string[];
}

const PY = (source: string): SkillPayload => ({ source } as SkillPayload);
const JS = (source: string): SkillPayload => ({ source } as SkillPayload);
const SH = (command: string): SkillPayload => ({ command } as SkillPayload);
const SP = (content: unknown, format: string): SkillPayload =>
  ({ content, format } as SkillPayload);

export const SEED_SOURCES: Record<string, SeedSpec> = {
  // ─── SCIENTIST ────────────────────────────────────────────────────────
  hypothesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["surprise", "anomaly", "why", "unexpected"],
    payload: PY(`
def skill(organism, context):
    """Form a falsifiable hypothesis from an observation.

    Originally forged by: scientist.adopt
    Reactivation triggers: surprise, anomaly, why, unexpected
    """
    observation = context.get("observation", "")
    return {
        "action": "FORM_HYPOTHESIS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 25},
        "version": 1,
        "params": {"observation": observation, "falsifiable": True}
    }
`.trim()),
  },

  experimental_design_protocol: {
    runtime: "python",
    reactivation_triggers: ["comparison", "controlled", "control", "baseline"],
    payload: PY(`
def skill(organism, context):
    """Design an experiment to test a hypothesis.

    Originally forged by: scientist.adopt
    Reactivation triggers: comparison, controlled, control, baseline
    """
    hypothesis = context.get("hypothesis", "")
    return {
        "action": "DESIGN_EXPERIMENT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"hypothesis": hypothesis, "controls": True}
    }
`.trim()),
  },

  peer_review_protocol: {
    runtime: "python",
    reactivation_triggers: ["critique", "review", "feedback", "objection"],
    payload: PY(`
def skill(organism, context):
    """Review a colleague's claim for rigor.

    Originally forged by: scientist.adopt
    Reactivation triggers: critique, review, feedback, objection
    Note: historically thought non-transferable, but in practice it
    wakes up in any profession when someone submits work for review.
    """
    claim = context.get("claim", "")
    return {
        "action": "PEER_REVIEW",
        "intensity": 0.5,
        "required_attributes": {"cpu": 30},
        "version": 1,
        "params": {"claim": claim}
    }
`.trim()),
  },

  // ─── LUMBERJACK ───────────────────────────────────────────────────────
  fell_tree_protocol: {
    runtime: "python",
    reactivation_triggers: ["fall", "fell", "storm", "emergency"],
    payload: PY(`
def skill(organism, context):
    """Chop down a tree. Pure physical action.

    Originally forged by: lumberjack.adopt
    Reactivation triggers: fall, fell, storm, emergency
    """
    tree_id = context.get("tree_id", "")
    return {
        "action": "FELL_TREE",
        "intensity": 0.9,
        "required_attributes": {"strength": 60, "agility": 20},
        "version": 1,
        "params": {"tree_id": tree_id}
    }
`.trim()),
  },

  sharpen_axe_protocol: {
    runtime: "shell",
    reactivation_triggers: ["edge", "sharpen", "maintenance", "repair"],
    // Real sharpen-axe would be a bash that runs a sharpening routine.
    // We use `true` so the executor can verify the discipline is honoured.
    payload: SH(`echo "sharpen_axe: edge restored" && exit 0`),
  },

  navigate_forest_protocol: {
    runtime: "javascript",
    reactivation_triggers: ["lost", "trail", "bearing", "outdoor", "forest"],
    payload: JS(`
function skill(organism, context) {
  // Pure navigation solver: emit a bearing recommendation.
  return {
    action: "NAVIGATE_FOREST",
    intensity: 0.5,
    required_attributes: { agility: 30 },
    version: 1,
    params: { destination: context.destination || "", bearing_deg: 0 }
  };
}
`.trim()),
  },

  weather_read_protocol: {
    runtime: "spec",
    reactivation_triggers: ["weather", "sky", "wind", "storm", "forecast"],
    // Reference protocol: not executable, just remembered. The cortex
    // can read this as guidance; executors don't invoke it.
    payload: SP(
      {
        title: "weather_read_protocol",
        type: "reference",
        rules: [
          "If cumulus build vertically fast → convective risk",
          "If wind shifts counter-clockwise → incoming front",
          "If pressure drops > 3 hPa/hour → storm within 6 hours",
        ],
      },
      "json",
    ),
  },

  // ─── ARCHITECT ────────────────────────────────────────────────────────
  blueprint_protocol: {
    runtime: "python",
    reactivation_triggers: ["design", "draft", "blueprint", "plan"],
    payload: PY(`
def skill(organism, context):
    """Draft a blueprint from a brief.

    Originally forged by: architect.adopt
    Reactivation triggers: design, draft, blueprint, plan
    """
    brief = context.get("brief", "")
    return {
        "action": "DRAFT_BLUEPRINT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 50},
        "version": 1,
        "params": {"brief": brief}
    }
`.trim()),
  },

  structural_analysis_protocol: {
    runtime: "python",
    reactivation_triggers: ["load", "stress", "span", "collapse"],
    payload: PY(`
def skill(organism, context):
    """Compute load-bearing requirements.

    Originally forged by: architect.adopt
    Reactivation triggers: load, stress, span, collapse
    """
    span = context.get("span_meters", 0)
    return {
        "action": "STRUCTURAL_ANALYSIS",
        "intensity": 0.8,
        "required_attributes": {"cpu": 60},
        "version": 1,
        "params": {"span_meters": span}
    }
`.trim()),
  },

  material_selection_protocol: {
    runtime: "spec",
    reactivation_triggers: ["material", "specs", "substrate", "selection"],
    // Reference data — organism just remembers the rubric.
    payload: SP(
      {
        title: "material_selection_protocol",
        type: "rubric",
        axes: ["load_kg_m2", "exposure", "cost_per_m2", "lifecycle_years"],
        defaults: { load_kg_m2: 200, exposure: "interior", cost_per_m2: 50, lifecycle_years: 30 },
      },
      "json",
    ),
  },

  // ─── T1–T11 DOMAIN EXTENSION ─────────────────────────────────────────
  // The following seeds close the gap between the existing DNA library
  // (39 .py files on disk) and the manifest (10 entries). They are not
  // new functionality — the Python bodies either come verbatim from
  // existing dna_library/*.py files (the 5 marked "FROM DISK" below)
  // or are minimal real Python exercising the same domain logic.

  // ─── METEOROLOGIST ──────────────────────────────────────────────────
  analyze_pressure_gradient_protocol: {
    runtime: "python",
    reactivation_triggers: ["pressure", "gradient", "isobar", "weather"],
    payload: PY(`
def skill(organism, context):
    """Compute the steepest local pressure gradients from station data."""
    import math
    stations = context.get("stations", [])
    top_n = int(context.get("top_n", 3))
    if not stations:
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                "result": {"gradients": [], "computed": 0}}
    grid = {(round(s["lat"], 2), round(s["lon"], 2)): s for s in stations}
    out = []
    for s in stations:
        lat0, lon0 = round(s["lat"], 2), round(s["lon"], 2)
        east = grid.get((lat0, round(lon0 + 1, 2)))
        if east is None or east["station_id"] == s["station_id"]:
            continue
        dist_km = 111.32 * max(0.1, math.cos(math.radians(lat0)))
        dp = east["pressure_hpa"] - s["pressure_hpa"]
        mag = abs(dp) / dist_km
        out.append({"station_id": s["station_id"],
                    "neighbor_id": east["station_id"],
                    "magnitude_hpa_per_100km": round(mag * 100, 4)})
    out.sort(key=lambda r: -r["magnitude_hpa_per_100km"])
    return {"action": "PRESSURE_GRADIENT", "intensity": 0.7, "version": 1,
            "result": {"gradients": out[:top_n], "computed": len(out)}}
`.trim()),
  },
  front_detection_protocol: {
    runtime: "python",
    reactivation_triggers: ["front", "boundary", "weather", "temperature"],
    payload: PY(`
def skill(organism, context):
    """Detect temperature fronts where adjacent stations differ > 5C."""
    stations = context.get("stations", [])
    threshold = float(context.get("threshold_c", 5.0))
    fronts = []
    for a, b in zip(stations, stations[1:]):
        dt = abs(a.get("temp_c", 0) - b.get("temp_c", 0))
        if dt >= threshold:
            fronts.append({"from": a.get("station_id"),
                           "to":   b.get("station_id"),
                           "delta_c": dt})
    return {"action": "FRONT_DETECTED" if fronts else "NO_FRONT",
            "intensity": 0.5 if fronts else 0.1, "version": 1,
            "result": {"fronts": fronts, "count": len(fronts)}}
`.trim()),
  },
  forecast_synthesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["forecast", "synthesis", "outlook", "weather"],
    payload: PY(`
def skill(organism, context):
    """Combine multiple station observations into a single forecast string."""
    stations = context.get("stations", [])
    if not stations:
        return {"action": "FORECAST", "intensity": 0.1, "version": 1,
                "result": {"summary": "no data"}}
    avg_p = sum(s.get("pressure_hpa", 1013) for s in stations) / len(stations)
    avg_t = sum(s.get("temp_c", 15) for s in stations) / len(stations)
    return {"action": "FORECAST", "intensity": 0.6, "version": 1,
            "result": {"summary": f"avg {avg_t:.1f}C, {avg_p:.1f}hPa across {len(stations)} stations",
                       "avg_temp_c":      round(avg_t, 2),
                       "avg_pressure_hpa": round(avg_p, 2)}}
`.trim()),
  },

  // ─── CYBERSECURITY — FROM DISK (real_port_scanner, _audit, _incident) ──
  real_port_scanner_protocol: {
    runtime: "python",
    reactivation_triggers: ["port", "scan", "tcp", "recon"],
    payload: PY(`
import asyncio, socket, json, time

def skill(organism, context):
    """Scan a host for open TCP ports.
    context: {"host": "scanme.nmap.org", "ports": [22,80,443]}
    """
    host = context.get("host", "127.0.0.1")
    ports = context.get("ports", [21,22,23,25,53,80,110,143,443,445,3306,3389,5432,5900,8080])
    timeout = float(context.get("timeout", 1.0))

    async def check(p):
        try:
            r, w = await asyncio.wait_for(asyncio.open_connection(host, p), timeout=timeout)
            w.close()
            try: await w.wait_closed()
            except Exception: pass
            return p
        except Exception: return None

    async def run_all():
        results = await asyncio.gather(*(check(p) for p in ports))
        return [p for p in results if p]

    t0 = time.time()
    open_ports = asyncio.run(run_all())
    return {
        "action": "PORT_SCAN",
        "intensity": 0.7,
        "version": 1,
        "result": {
            "host": host,
            "scanned_ports": len(ports),
            "open_ports": open_ports,
            "open_count": len(open_ports),
            "duration_ms": int((time.time() - t0) * 1000),
            "summary": f"{len(open_ports)}/{len(ports)} ports open on {host}",
        },
    }
`.trim()),
  },
  real_http_header_audit_protocol: {
    runtime: "python",
    reactivation_triggers: ["http", "header", "audit", "csp"],
    payload: PY(`
import urllib.request, urllib.error, json

SECURITY_HEADERS = {
    "strict-transport-security": "Force HTTPS",
    "content-security-policy":   "XSS / injection",
    "x-frame-options":           "Clickjacking",
    "x-content-type-options":    "MIME sniffing",
    "referrer-policy":           "Referrer leakage",
    "permissions-policy":        "Feature abuse",
}

def skill(organism, context):
    """Audit HTTP security headers of a target URL."""
    url = context.get("url", "")
    if not url: return {"action": "HEADER_AUDIT", "intensity": 0.1, "version": 1, "result": {"error": "url is required"}}
    findings = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "metamorfus/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            for header, purpose in SECURITY_HEADERS.items():
                findings.append({"header": header, "present": header in headers, "purpose": purpose})
            present = sum(1 for f in findings if f["present"])
            return {"action": "HEADER_AUDIT", "intensity": 0.6, "version": 1,
                    "result": {"url": url, "status": resp.status, "score": round(present / len(findings), 2), "findings": findings}}
    except urllib.error.HTTPError as e:
        return {"action": "HEADER_AUDIT", "intensity": 0.3, "version": 1,
                "result": {"url": url, "status": e.code, "error": e.reason, "findings": findings}}
    except Exception as e:
        return {"action": "HEADER_AUDIT", "intensity": 0.1, "version": 1,
                "result": {"url": url, "error": str(e), "findings": findings}}
`.trim()),
  },
  real_incident_logger_protocol: {
    runtime: "python",
    reactivation_triggers: ["incident", "log", "tamper", "audit"],
    payload: PY(`
import json, os, time, hashlib

def skill(organism, context):
    """Append a security incident to an immutable WORM hash-chained log."""
    event = context.get("event", {})
    log_path = context.get("log_path", "/tmp/metamorfus-incidents.ndjson")
    ts = time.time()
    entry = {"ts": ts, "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)), "event": event}
    prev_hash = ""
    if os.path.exists(log_path):
        try:
            with open(log_path, "rb") as f:
                prev_hash = hashlib.sha256(f.read()).hexdigest()
        except Exception: pass
    payload = json.dumps(entry, sort_keys=True).encode() + prev_hash.encode()
    entry["hash"] = hashlib.sha256(payload).hexdigest()
    entry["prev_hash"] = prev_hash
    try:
        os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
        with open(log_path, "a") as f:
            f.write(json.dumps(entry) + "\\n")
        return {"action": "INCIDENT_LOGGED", "intensity": 0.5, "version": 1,
                "result": {"logged": True, "path": log_path, "hash": entry["hash"][:16]}}
    except Exception as e:
        return {"action": "INCIDENT_ERROR", "intensity": 0.2, "version": 1,
                "result": {"logged": False, "error": str(e)}}
`.trim()),
  },

  // ─── ENGINEER ───────────────────────────────────────────────────────
  engineer_load_calc_protocol: {
    runtime: "python",
    reactivation_triggers: ["load", "weight", "engineering", "support"],
    payload: PY(`
def skill(organism, context):
    """Compute total load on a structural member."""
    distributed = float(context.get("distributed_kg_m2", 0))
    span = float(context.get("span_m", 1))
    points = context.get("point_loads_kg", [])
    point_total = sum(float(p) for p in points)
    area = span * float(context.get("tributary_width_m", 1))
    total = distributed * area + point_total
    return {"action": "LOAD_CALC", "intensity": 0.7, "version": 1,
            "result": {"total_kg": round(total, 2),
                       "area_m2":  round(area, 2),
                       "point_total_kg": round(point_total, 2)}}
`.trim()),
  },
  engineer_stress_analysis_protocol: {
    runtime: "python",
    reactivation_triggers: ["stress", "strain", "tension", "compression"],
    payload: PY(`
def skill(organism, context):
    """Compute axial stress and a safety factor."""
    force_n = float(context.get("force_n", 0))
    area_mm2 = float(context.get("area_mm2", 1))
    yield_mpa = float(context.get("yield_mpa", 250))
    stress_mpa = force_n / area_mm2
    safety = yield_mpa / max(0.001, stress_mpa)
    return {"action": "STRESS_ANALYSIS", "intensity": 0.8, "version": 1,
            "result": {"stress_mpa": round(stress_mpa, 3),
                       "safety_factor": round(safety, 2),
                       "status": "OK" if safety >= 1.5 else "WARN"}}
`.trim()),
  },
  engineer_tolerance_design_protocol: {
    runtime: "python",
    reactivation_triggers: ["tolerance", "fit", "clearance", "engineering"],
    payload: PY(`
def skill(organism, context):
    """Compute worst-case tolerance stack for an assembly."""
    parts = context.get("parts", [])
    plus = sum(float(p.get("plus_mm", 0)) for p in parts)
    minus = sum(float(p.get("minus_mm", 0)) for p in parts)
    return {"action": "TOLERANCE_DESIGN", "intensity": 0.6, "version": 1,
            "result": {"max_clearance_mm": round(plus, 4),
                       "min_clearance_mm": round(-minus, 4),
                       "stack_parts": len(parts)}}
`.trim()),
  },

  // ─── TRADER — FROM DISK (crypto_price_v2, rsi_calculator_v2) + signal_synthesis ─
  crypto_price_v2_protocol: {
    runtime: "python",
    reactivation_triggers: ["price", "crypto", "market", "trading"],
    payload: PY(`
import urllib.request, urllib.parse, json

def skill(organism, context):
    """Fetch current price for a crypto symbol via CoinGecko."""
    base = "https://api.coingecko.com/api/v3/simple/price"
    params = {"vs_currencies": "usd", "include_24hr_change": "true", "include_market_cap": "true"}
    if "ids" in context: params["ids"] = context["ids"]
    elif "symbol" in context: params["ids"] = context["symbol"]
    else:
        return {"action": "PRICE", "intensity": 0.0, "version": 1, "result": {"error": "symbol or ids required"}}
    try:
        url = base + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        return {"action": "PRICE", "intensity": 0.6, "version": 1,
                "result": {"prices": data, "fetched_at": __import__("time").time()}}
    except Exception as e:
        return {"action": "PRICE", "intensity": 0.1, "version": 1, "result": {"error": str(e)}}
`.trim()),
  },
  rsi_calculator_v2_protocol: {
    runtime: "python",
    reactivation_triggers: ["rsi", "relative", "strength", "index"],
    payload: PY(`
def skill(organism, context):
    """Calculate Wilder's RSI from a list of closing prices."""
    prices = context.get("prices", [])
    period = int(context.get("period", 14))
    if len(prices) < period + 1:
        return {"action": "RSI", "intensity": 0.0, "version": 1,
                "result": {"error": f"need at least {period + 1} prices, got {len(prices)}"}}
    gains, losses = [], []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        rsi = 100
    else:
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
    return {"action": "RSI", "intensity": 0.5, "version": 1,
            "result": {"rsi": round(rsi, 2),
                       "period": period,
                       "signal": "overbought" if rsi > 70 else "oversold" if rsi < 30 else "neutral",
                       "samples": len(prices)}}
`.trim()),
  },
  signal_synthesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["signal", "trade", "entry", "exit"],
    payload: PY(`
def skill(organism, context):
    """Combine RSI + price vs SMA into a single trading signal."""
    rsi = float(context.get("rsi", 50))
    price = float(context.get("price", 0))
    sma = float(context.get("sma", price))
    if rsi < 30 and price > sma:
        action = "BUY"
    elif rsi > 70 and price < sma:
        action = "SELL"
    else:
        action = "HOLD"
    return {"action": "SIGNAL_" + action, "intensity": 0.7, "version": 1,
            "result": {"rsi": rsi, "price": price, "sma": sma, "decision": action}}
`.trim()),
  },

  // ─── DOCTOR ─────────────────────────────────────────────────────────
  doctor_triage_protocol: {
    runtime: "python",
    reactivation_triggers: ["triage", "urgent", "emergency", "patient"],
    payload: PY(`
def skill(organism, context):
    """Classify patient acuity from vitals (RED/YELLOW/GREEN)."""
    hr = float(context.get("heart_rate", 80))
    sbp = float(context.get("systolic_bp", 120))
    spo2 = float(context.get("spo2", 98))
    if spo2 < 90 or sbp < 90 or hr > 130:
        acuity = "RED"
    elif spo2 < 94 or sbp < 100 or hr > 110:
        acuity = "YELLOW"
    else:
        acuity = "GREEN"
    return {"action": "TRIAGE_" + acuity,
            "intensity": 0.9 if acuity == "RED" else 0.5 if acuity == "YELLOW" else 0.2,
            "version": 1,
            "result": {"acuity": acuity, "hr": hr, "sbp": sbp, "spo2": spo2}}
`.trim()),
  },
  doctor_differential_protocol: {
    runtime: "python",
    reactivation_triggers: ["differential", "diagnosis", "symptoms", "disease"],
    payload: PY(`
def skill(organism, context):
    """Rank candidate diagnoses by symptom match count."""
    candidates = context.get("candidates", [])
    symptoms = set(context.get("symptoms", []))
    ranked = []
    for c in candidates:
        cs = set(c.get("symptoms", []))
        overlap = len(symptoms & cs)
        ranked.append({"diagnosis": c.get("name"), "match": overlap, "total": len(cs)})
    ranked.sort(key=lambda r: -r["match"])
    return {"action": "DIFFERENTIAL", "intensity": 0.6, "version": 1,
            "result": {"ranked": ranked[:5]}}
`.trim()),
  },
  doctor_treatment_protocol: {
    runtime: "python",
    reactivation_triggers: ["treatment", "therapy", "prescription", "patient"],
    payload: PY(`
def skill(organism, context):
    """Recommend first-line treatment for a diagnosis."""
    diagnosis = str(context.get("diagnosis", "")).lower()
    db = {
        "hypertension":       ["ACE inhibitor", "lifestyle change", "follow-up 4w"],
        "type 2 diabetes":    ["metformin", "diet", "HbA1c q3mo"],
        "asthma exacerbation":["short-acting beta-agonist", "oral corticosteroid"],
    }
    plan = db.get(diagnosis, ["consult specialist", "supportive care"])
    return {"action": "TREATMENT_PLAN", "intensity": 0.7, "version": 1,
            "result": {"diagnosis": diagnosis, "plan": plan}}
`.trim()),
  },

  // ─── PHYSICIST ──────────────────────────────────────────────────────
  physicist_dimensional_protocol: {
    runtime: "python",
    reactivation_triggers: ["dimension", "units", "physics", "consistency"],
    payload: PY(`
def skill(organism, context):
    """Parse a dimensional expression and return SI exponents."""
    import re
    expr = str(context.get("expression", ""))
    base = {"kg": 0, "m": 0, "s": 0, "K": 0, "A": 0, "mol": 0, "cd": 0}
    for sym, exp in re.findall(r"(kg|m|s|K|A|mol|cd)\\^(-?\\d+)", expr):
        if sym in base: base[sym] += int(exp)
    for sym in re.findall(r"(?<!\\^)(kg|m|s|K|A|mol|cd)(?!\\^)", expr):
        if sym in base: base[sym] += 1
    return {"action": "DIMENSIONAL", "intensity": 0.5, "version": 1,
            "result": {"expression": expr, "dimensions": base}}
`.trim()),
  },
  physicist_force_balance_protocol: {
    runtime: "python",
    reactivation_triggers: ["force", "balance", "equilibrium", "physics"],
    payload: PY(`
def skill(organism, context):
    """Sum forces on a body in 1D and report equilibrium."""
    forces = [float(f) for f in context.get("forces_n", [])]
    net = sum(forces)
    return {"action": "EQUILIBRIUM" if abs(net) < 1e-6 else "UNBALANCED",
            "intensity": 0.5, "version": 1,
            "result": {"net_force_n": round(net, 6), "count": len(forces)}}
`.trim()),
  },
  physicist_wave_protocol: {
    runtime: "python",
    reactivation_triggers: ["wave", "frequency", "wavelength", "physics"],
    payload: PY(`
def skill(organism, context):
    """Compute wave speed c = f * lambda."""
    f = float(context.get("frequency_hz", 0))
    lam = float(context.get("wavelength_m", 0))
    c = f * lam
    return {"action": "WAVE_SPEED", "intensity": 0.5, "version": 1,
            "result": {"speed_m_s": round(c, 4),
                       "frequency_hz": f,
                       "wavelength_m": lam}}
`.trim()),
  },

  // ─── ARCHAEOLOGIST ─────────────────────────────────────────────────
  archaeo_stratigraphy_protocol: {
    runtime: "python",
    reactivation_triggers: ["stratigraphy", "layer", "depth", "dig"],
    payload: PY(`
def skill(organism, context):
    """Order strata by depth (deepest first)."""
    layers = context.get("layers", [])
    ordered = sorted(layers, key=lambda l: -float(l.get("depth_m", 0)))
    return {"action": "STRATIGRAPHY", "intensity": 0.6, "version": 1,
            "result": {"ordered": [l.get("name") for l in ordered]}}
`.trim()),
  },
  archaeo_artifact_inference_protocol: {
    runtime: "python",
    reactivation_triggers: ["artifact", "inference", "dating", "find"],
    payload: PY(`
def skill(organism, context):
    """Infer likely period from artifact description keywords."""
    text = str(context.get("description", "")).lower()
    rules = [
        ("bronze age",  ["bronze", "sword", "copper"]),
        ("iron age",    ["iron", "steel"]),
        ("neolithic",   ["polished", "stone", "ceramic"]),
        ("modern",      ["plastic", "battery", "circuit"]),
    ]
    hits = [period for period, kws in rules if any(k in text for k in kws)]
    period = hits[0] if hits else "unknown"
    return {"action": "INFER_PERIOD", "intensity": 0.5, "version": 1,
            "result": {"period": period, "matched_rules": hits}}
`.trim()),
  },
  archaeo_chronology_protocol: {
    runtime: "python",
    reactivation_triggers: ["chronology", "timeline", "date", "age"],
    payload: PY(`
def skill(organism, context):
    """Order events by date and flag gaps > 100 years."""
    events = context.get("events", [])
    parsed = []
    for e in events:
        try:
            parsed.append({"name": e.get("name"), "year": int(e.get("year", 0))})
        except (ValueError, TypeError):
            continue
    parsed.sort(key=lambda e: e["year"])
    gaps = []
    for a, b in zip(parsed, parsed[1:]):
        if b["year"] - a["year"] > 100:
            gaps.append({"from": a["name"], "to": b["name"], "span_years": b["year"] - a["year"]})
    return {"action": "CHRONOLOGY", "intensity": 0.5, "version": 1,
            "result": {"events": parsed, "gaps_over_100y": gaps}}
`.trim()),
  },

  // ─── FRAUD ANALYST ──────────────────────────────────────────────────
  fraud_anomaly_protocol: {
    runtime: "python",
    reactivation_triggers: ["anomaly", "fraud", "suspicious", "transaction"],
    payload: PY(`
def skill(organism, context):
    """Flag transactions > 3 standard deviations from the mean amount."""
    txs = context.get("transactions", [])
    if len(txs) < 2:
        return {"action": "ANOMALY_SCAN", "intensity": 0.0, "version": 1,
                "result": {"flagged": [], "flagged_count": 0, "reason": "insufficient data"}}
    amounts = [float(t.get("amount", 0)) for t in txs]
    mean = sum(amounts) / len(amounts)
    var = sum((a - mean) ** 2 for a in amounts) / len(amounts)
    sd = var ** 0.5
    flagged = [t for t in txs if abs(float(t.get("amount", 0)) - mean) > 3 * sd]
    return {"action": "ANOMALY_SCAN", "intensity": 0.7, "version": 1,
            "result": {"mean": round(mean, 2),
                       "stdev": round(sd, 2),
                       "flagged": flagged[:20],
                       "flagged_count": len(flagged)}}
`.trim()),
  },
  fraud_network_protocol: {
    runtime: "python",
    reactivation_triggers: ["network", "graph", "connections", "fraud"],
    payload: PY(`
def skill(organism, context):
    """Count connections per node in a transaction graph."""
    edges = context.get("edges", [])
    deg = {}
    for pair in edges:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2: continue
        src, dst = pair
        deg[src] = deg.get(src, 0) + 1
        deg[dst] = deg.get(dst, 0) + 1
    hubs = sorted(deg.items(), key=lambda kv: -kv[1])[:5]
    return {"action": "NETWORK_ANALYSIS", "intensity": 0.6, "version": 1,
            "result": {"hubs": hubs, "nodes": len(deg), "edges": len(edges)}}
`.trim()),
  },
  fraud_report_protocol: {
    runtime: "python",
    reactivation_triggers: ["report", "fraud", "summary", "compliance"],
    payload: PY(`
def skill(organism, context):
    """Compose a fraud compliance report from scan + network results."""
    scan = context.get("scan", {})
    network = context.get("network", {})
    top_hub = network.get("hubs", [["?", 0]])[0]
    body = (f"Flagged {scan.get('flagged_count', 0)} anomalous transactions "
            f"(mean {scan.get('mean', 0)}, sd {scan.get('stdev', 0)}). "
            f"Top hub: {top_hub[0]} with {top_hub[1]} connections.")
    return {"action": "FRAUD_REPORT", "intensity": 0.7, "version": 1,
            "result": {"report": body}}
`.trim()),
  },
};
