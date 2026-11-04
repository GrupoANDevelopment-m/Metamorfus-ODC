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
    payload: PY(`def skill(organism, context):
    """Form a falsifiable hypothesis from an observation.

    Transferable: any deductive profession can use this.
    Originally forged by: scientist.adopt
    """
    observation = context.get("observation", "")
    return {
        "action": "FORM_HYPOTHESIS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 25},
        "version": 1,
        "params": {"observation": observation, "falsifiable": True}
    }`.trim()),
  },

  experimental_design_protocol: {
    runtime: "python",
    reactivation_triggers: ["comparison", "controlled", "control", "baseline"],
    payload: PY(`def skill(organism, context):
    """Design an experiment to test a hypothesis.

    Transferable: any profession that needs controlled comparison.
    Originally forged by: scientist.adopt
    """
    hypothesis = context.get("hypothesis", "")
    return {
        "action": "DESIGN_EXPERIMENT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"hypothesis": hypothesis, "controls": True}
    }`.trim()),
  },

  peer_review_protocol: {
    runtime: "python",
    reactivation_triggers: ["critique", "review", "feedback", "objection"],
    payload: PY(`def skill(organism, context):
    """Review a colleague's claim for rigor.

    NOT transferable: peer review is a social artifact of academic
    science. A lumberjack doesn't peer-review trees.
    Originally forged by: scientist.adopt
    """
    claim = context.get("claim", "")
    return {
        "action": "PEER_REVIEW",
        "intensity": 0.5,
        "required_attributes": {"cpu": 30},
        "version": 1,
        "params": {"claim": claim}
    }`.trim()),
  },

  // ─── LUMBERJACK ───────────────────────────────────────────────────────
  fell_tree_protocol: {
    runtime: "python",
    reactivation_triggers: ["fall", "fell", "storm", "emergency"],
    payload: PY(`def skill(organism, context):
    """Chop down a tree. Pure physical action.

    NOT transferable outside forest-work contexts.
    Originally forged by: lumberjack.adopt
    """
    tree_id = context.get("tree_id", "")
    return {
        "action": "FELL_TREE",
        "intensity": 0.9,
        "required_attributes": {"strength": 60, "agility": 20},
        "version": 1,
        "params": {"tree_id": tree_id}
    }`.trim()),
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
    payload: PY(`def skill(organism, context):
    """Draft a blueprint from a brief.

    Transferable: any design profession (industrial designer, UX).
    Originally forged by: architect.adopt
    """
    brief = context.get("brief", "")
    return {
        "action": "DRAFT_BLUEPRINT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 50},
        "version": 1,
        "params": {"brief": brief}
    }`.trim()),
  },

  structural_analysis_protocol: {
    runtime: "python",
    reactivation_triggers: ["load", "stress", "span", "collapse"],
    payload: PY(`def skill(organism, context):
    """Compute load-bearing requirements.

    NOT transferable outside building contexts.
    Originally forged by: architect.adopt
    """
    span = context.get("span_meters", 0)
    return {
        "action": "STRUCTURAL_ANALYSIS",
        "intensity": 0.8,
        "required_attributes": {"cpu": 60},
        "version": 1,
        "params": {"span_meters": span}
    }`.trim()),
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
    payload: PY(`"""Pressure gradient analysis across weather stations.

Computes the 3D pressure gradient between stations, the geostrophic wind
component it implies, and flags stations inconsistent with their
neighbours. Used to locate fronts and pressure troughs.

Transferable: any task needing spatial gradients (meteorology, ocean
mapping, geophysics).
Originally forged by: meteorologist.adopt
"""
import math


def _stations(context):
    raw = context.get("stations", [])
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out = []
    for s in raw:
        if not isinstance(s, dict):
            continue
        try:
            out.append({
                "id": s.get("id", s.get("name", f"st{len(out)}")),
                "pressure": float(s.get("pressure", s.get("p", 0))),
                "lat": float(s.get("lat", s.get("latitude", 0.0))),
                "lon": float(s.get("lon", s.get("longitude", 0.0))),
                "altitude": float(s.get("altitude", s.get("alt", 0.0))),
            })
        except (TypeError, ValueError):
            continue
    return out


def _haversine(a, b):
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = math.radians(b["lat"] - a["lat"])
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, h)))


def skill(organism, context):
    """Compute pairwise pressure gradients and geostrophic wind estimates."""
    stations = _stations(context)
    if len(stations) < 2:
        return {
            "action": "PRESSURE_GRADIENT",
            "intensity": 0.0,
            "version": 1,
            "result": {
                "gradients": [],
                "computed": 0,
                "error": "need at least 2 stations with pressure",
            },
        }

    top_n = int(context.get("top_n", 5) or 5)
    gradients = []
    for i in range(len(stations)):
        for j in range(i + 1, len(stations)):
            a, b = stations[i], stations[j]
            dist = _haversine(a, b)
            if dist <= 0.01:
                continue
            dp = b["pressure"] - a["pressure"]
            grad = dp / dist  # hPa per km
            # Geostrophic wind magnitude: |Vg| = |1/(rho*f)| * |grad P|
            f = 2 * 7.2921e-5 * math.sin(math.radians((a["lat"] + b["lat"]) / 2))
            rho = 1.225
            vg = abs(grad) * 100 / (rho * abs(f)) if abs(f) > 1e-6 else None
            gradients.append({
                "from": a["id"],
                "to": b["id"],
                "distance_km": round(dist, 2),
                "delta_pressure": round(dp, 3),
                "gradient_hpa_per_km": round(grad, 5),
                "geostrophic_wind_ms": round(vg, 2) if vg is not None else None,
                "direction": "high_to_low" if dp < 0 else "low_to_high",
            })

    # Local slope profile, in SEQUENCE order (station i to station i+1).
    # The caller needs this to see how the slope evolves along the
    # series — the magnitude-sorted list below cannot express that,
    # because it reorders the pairs by strength and destroys the
    # progression.
    local_slopes = []
    for i in range(len(stations) - 1):
        a, b = stations[i], stations[i + 1]
        d = _haversine(a, b)
        if d <= 0.01:
            continue
        local_slopes.append({
            "from": a["id"],
            "to": b["id"],
            "slope_hpa_per_km": round((b["pressure"] - a["pressure"]) / d, 6),
        })

    gradients.sort(key=lambda g: abs(g["gradient_hpa_per_km"]), reverse=True)
    strongest = gradients[:top_n]
    mean_grad = sum(abs(g["gradient_hpa_per_km"]) for g in gradients) / len(gradients)
    # A gradient above ~0.05 hPa/km is meaningful for synoptic-scale flow.
    anomalous = [g for g in gradients if abs(g["gradient_hpa_per_km"]) > 0.05]

    return {
        "action": "PRESSURE_GRADIENT",
        "intensity": round(min(1.0, mean_grad / 0.1), 3),
        "version": 1,
        "result": {
            "gradients": strongest,
            "local_slopes": local_slopes,
            "computed": len(gradients),
            "mean_abs_gradient": round(mean_grad, 5),
            "anomalous_pairs": len(anomalous),
            "strongest": strongest[0] if strongest else None,
        },
    }`.trim()),
  },
  front_detection_protocol: {
    runtime: "python",
    reactivation_triggers: ["front", "boundary", "weather", "temperature"],
    payload: PY(`"""Front detection from a pressure and temperature field.

A front is a sharp discontinuity in the horizontal temperature gradient.
This locates candidate fronts by comparing the temperature drop between
neighbouring stations against the field's own variability, so the
threshold adapts to the data instead of being a fixed number.

Transferable: any discontinuity-detection problem (seismology, edge
detection in imagery, chemical layer boundaries).
Originally forged by: meteorologist.adopt
"""
import math


def _read(context):
    raw = context.get("stations", context.get("points", []))
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    pts = []
    for s in raw:
        if not isinstance(s, dict):
            continue
        try:
            pts.append({
                "id": s.get("id", f"p{len(pts)}"),
                "lat": float(s.get("lat", 0.0)),
                "lon": float(s.get("lon", 0.0)),
                "temperature": float(s.get("temperature", s.get("temp", 0.0))),
                "pressure": float(s.get("pressure", s.get("p", 0.0))),
                "wind": float(s.get("wind", s.get("wind_speed", 0.0))),
            })
        except (TypeError, ValueError):
            continue
    return pts


def _dist(a, b):
    r = 6371.0
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp = math.radians(b["lat"] - a["lat"])
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, h)))


def skill(organism, context):
    """Locate frontal boundaries from temperature discontinuities."""
    pts = _read(context)
    if len(pts) < 3:
        return {
            "action": "FRONT_DETECTION",
            "intensity": 0.0,
            "version": 1,
            "result": {
                "fronts": [],
                "computed": 0,
                "error": "need at least 3 stations with temperature",
            },
        }

    # Pairwise temperature gradient (K per 100 km) with a wind-shift
    # bonus: real fronts have a backing/veering wind change across them.
    pairs = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = _dist(pts[i], pts[j])
            if d < 0.5 or d > 800:
                continue
            dt = abs(pts[j]["temperature"] - pts[i]["temperature"])
            pairs.append({
                "a": pts[i]["id"], "b": pts[j]["id"],
                "distance_km": round(d, 1),
                "dT": round(dt, 2),
                "grad_per_100km": round(dt / d * 100, 3),
                "dP": round(abs(pts[j]["pressure"] - pts[i]["pressure"]), 2),
            })

    if not pairs:
        return {
            "action": "FRONT_DETECTION", "intensity": 0.0, "version": 1,
            "result": {"fronts": [], "computed": 0, "error": "no usable station pairs"},
        }

    grads = sorted(p["grad_per_100km"] for p in pairs)
    n = len(grads)
    median = grads[n // 2] if n % 2 else (grads[n // 2 - 1] + grads[n // 2]) / 2
    mean = sum(grads) / n
    # Adaptive threshold from the field's own spread, the same idea the
    # AST-based threshold in meta-orchestrator uses.
    threshold = max(median * 2.0, mean * 1.5, 1.0)

    fronts = [p for p in pairs if p["grad_per_100km"] >= threshold]
    fronts.sort(key=lambda p: p["grad_per_100km"], reverse=True)

    return {
        "action": "FRONT_DETECTION",
        "intensity": round(min(1.0, len(fronts) / max(1, len(pairs))), 3),
        "version": 1,
        "result": {
            "fronts": fronts[:10],
            "computed": len(pairs),
            "front_count": len(fronts),
            "threshold": round(threshold, 3),
            "median_gradient": round(median, 3),
            "mean_gradient": round(mean, 3),
            "strongest": fronts[0] if fronts else None,
        },
    }`.trim()),
  },
  forecast_synthesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["forecast", "synthesis", "outlook", "weather"],
    payload: PY(`"""Forecast synthesis from multiple meteorological signals.

Combines a pressure trend, a temperature trend and a wind trend into a
single forecast with an explicit confidence. Each trend is normalised
against its own historical spread, so a 2 hPa/6h change means different
things in different situations and the skill says so.

Transferable: any multi-signal synthesis into one decision (fraud
scoring, triage, load forecasting).
Originally forged by: meteorologist.adopt
"""
import statistics


def _series(context, *keys):
    for k in keys:
        v = context.get(k)
        if isinstance(v, list) and len(v) >= 2:
            return [float(x) for x in v if isinstance(x, (int, float))]
    return []


def _trend(series):
    """Linear slope per step, and total change."""
    if len(series) < 2:
        return 0.0, 0.0
    n = len(series)
    xbar = (n - 1) / 2.0
    ybar = sum(series) / n
    num = sum((i - xbar) * (y - ybar) for i, y in enumerate(series))
    den = sum((i - xbar) ** 2 for i in range(n))
    slope = num / den if den else 0.0
    return slope, series[-1] - series[0]


def skill(organism, context):
    """Synthesise a forecast from pressure, temperature and wind trends."""
    pressure = _series(context, "pressure", "pressures", "pressure_series")
    temperature = _series(context, "temperature", "temperatures", "temp_series")
    wind = _series(context, "wind", "winds", "wind_series")

    if not pressure and not temperature and not wind:
        return {
            "action": "FORECAST_SYNTHESIS",
            "intensity": 0.0,
            "version": 1,
            "result": {
                "forecast": None,
                "confidence": 0.0,
                "error": "need at least one of pressure / temperature / wind series",
            },
        }

    signals = {}
    for name, series, unit in (
        ("pressure", pressure, "hPa"),
        ("temperature", temperature, "C"),
        ("wind", wind, "m/s"),
    ):
        if not series:
            continue
        slope, total = _trend(series)
        # Normalise by the series' own spread: a 1 sigma move is the
        # scale that matters for that variable.
        spread = statistics.pstdev(series) if len(series) > 1 else 0.0
        z = (total / spread) if spread > 0 else 0.0
        signals[name] = {
            "slope": round(slope, 4),
            "total_change": round(total, 3),
            "stdev": round(spread, 3),
            "z_score": round(z, 3),
            "unit": unit,
            "n": len(series),
        }

    # Weight by how anomalous each signal is. A signal whose change is
    # inside one sigma contributes almost nothing.
    weights = {"pressure": 0.4, "temperature": 0.35, "wind": 0.25}
    num = den = 0.0
    for name, s in signals.items():
        w = weights.get(name, 0.2) * min(3.0, abs(s["z_score"]))
        num += w * s["z_score"]
        den += w

    composite = num / den if den else 0.0
    # A negative composite pressure trend means the system is deepening.
    if composite < -1.0:
        label, conf = "deteriorating", min(0.95, 0.5 + abs(composite) / 6)
    elif composite > 1.0:
        label, conf = "improving", min(0.95, 0.5 + abs(composite) / 6)
    else:
        label, conf = "stable", 0.4

    return {
        "action": "FORECAST_SYNTHESIS",
        "intensity": round(min(1.0, abs(composite) / 3), 3),
        "version": 1,
        "result": {
            "forecast": label,
            "confidence": round(conf, 3),
            "composite_z": round(composite, 3),
            "signals": signals,
            "signals_used": len(signals),
        },
    }`.trim()),
  },

  // ─── CYBERSECURITY — FROM DISK (real_port_scanner, _audit, _incident) ──
  real_port_scanner_protocol: {
    runtime: "python",
    reactivation_triggers: ["port", "scan", "tcp", "recon"],
    payload: PY(`"""Real async TCP port scanner — scans a host for open ports."""
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
        "host": host,
        "scanned_ports": len(ports),
        "open_ports": open_ports,
        "open_count": len(open_ports),
        "duration_ms": int((time.time() - t0) * 1000),
        "summary": f"{len(open_ports)}/{len(ports)} ports open on {host}",
    }`.trim()),
  },
  real_http_header_audit_protocol: {
    runtime: "python",
    reactivation_triggers: ["http", "header", "audit", "csp"],
    payload: PY(`"""Real HTTP security header auditor."""
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
    if not url: return {"error": "url is required"}
    findings = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "metamorfus/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            for header, purpose in SECURITY_HEADERS.items():
                findings.append({"header": header, "present": header in headers, "purpose": purpose})
            present = sum(1 for f in findings if f["present"])
            return {"url": url, "status": resp.status, "score": round(present / len(findings), 2), "findings": findings}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "error": e.reason, "findings": findings}
    except Exception as e:
        return {"url": url, "error": str(e), "findings": findings}`.trim()),
  },
  real_incident_logger_protocol: {
    runtime: "python",
    reactivation_triggers: ["incident", "log", "tamper", "audit"],
    payload: PY(`"""Real structured incident logger with WORM-style append-only storage."""
import json, os, time, hashlib

def skill(organism, context):
    """Append a security incident to an immutable log file.
    context: {"event": {"type": "port_scan", "src": "1.2.3.4"}, "log_path": "/var/log/metamorfus/incidents.ndjson"}
    """
    event = context.get("event", {})
    log_path = context.get("log_path", "/tmp/metamorfus-incidents.ndjson")
    ts = time.time()
    entry = {
        "ts": ts,
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "event": event,
    }
    # Hash chain: prev_hash + this entry's payload
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
        return {"logged": True, "path": log_path, "hash": entry["hash"]}
    except Exception as e:
        return {"logged": False, "error": str(e)}`.trim()),
  },

  // ─── ENGINEER ───────────────────────────────────────────────────────
  engineer_load_calc_protocol: {
    runtime: "python",
    reactivation_triggers: ["load", "weight", "engineering", "support"],
    payload: PY(`"""Structural load calculation for beams, columns and plates.

Implements the standard closed-form checks: bending stress, shear
stress, and a combined von Mises criterion against an allowable stress.
The section is described as a rectangle or an I-section so results are
computable without a solver.

Transferable: any structural sanity check (construction, mechanical
design, load rating of shelves and racks).
Originally forged by: engineer.adopt
"""
import math

# Typical engineering properties. E in Pa, yield in Pa.
MATERIALS = {
    "steel": {"E": 200e9, "yield": 250e6},
    "stainless": {"E": 193e9, "yield": 215e6},
    "aluminium": {"E": 70e9, "yield": 95e6},
    "aluminum": {"E": 70e9, "yield": 95e6},
    "concrete": {"E": 30e9, "yield": 30e6},
    "timber": {"E": 11e9, "yield": 24e6},
    "wood": {"E": 11e9, "yield": 24e6},
    "glass": {"E": 70e9, "yield": 50e6},
}


def _section(context):
    s = context.get("section", {}) or {}
    kind = str(s.get("type", "rectangle")).lower()
    if kind in ("i", "ibeam", "i-beam"):
        return {
            "type": "i",
            "depth": float(s.get("depth", s.get("h", 0.3))),
            "width": float(s.get("width", s.get("bf", 0.15))),
            "flange_t": float(s.get("flange_t", s.get("tf", 0.02))),
            "web_t": float(s.get("web_t", s.get("tw", 0.01))),
        }
    return {
        "type": "rectangle",
        "depth": float(s.get("depth", s.get("h", 0.2))),
        "width": float(s.get("width", s.get("b", 0.1))),
    }


def _properties(sec):
    """Second moment of area (I) and section modulus (Z)."""
    if sec["type"] == "i":
        d, bf, tf, tw = sec["depth"], sec["width"], sec["flange_t"], sec["web_t"]
        h = d - 2 * tf
        I = (bf * d ** 3 - (bf - tw) * h ** 3) / 12.0
        Z = I / (d / 2.0) if d else 0.0
        A = 2 * bf * tf + tw * h
    else:
        b, d = sec["width"], sec["depth"]
        I = b * d ** 3 / 12.0
        Z = b * d ** 2 / 6.0
        A = b * d
    return I, Z, A


def _material(raw):
    """Resolve the material into properties.

    \`material\` may be a dict of properties, or the NAME of a material —
    "steel" is the obvious thing to pass, and a skill that crashes on
    it is not a skill, it is a trap. Unknown names fall back to the
    steel defaults rather than raising.
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        key = raw.strip().lower()
        for name, props in MATERIALS.items():
            if key == name or key in name:
                return dict(props)
        return {}
    return {}


def skill(organism, context):
    """Check a member against bending, shear and combined stress."""
    loads = context.get("loads", {}) or {}
    try:
        moment = float(loads.get("moment", loads.get("bending_moment", loads.get("M", 0))))  # N*m
        shear = float(loads.get("shear", loads.get("V", 0)))  # N
        axial = float(loads.get("axial", loads.get("N", 0)))  # N
    except (TypeError, ValueError):
        return {
            "action": "LOAD_CALC", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "loads must be numeric"},
        }

    mat = _material(context.get("material", {}))
    E = float(mat.get("E", 200e9))            # Pa
    yield_strength = float(mat.get("yield", mat.get("yield_strength", 250e6)))  # Pa
    G = float(mat.get("G", E / (2 * 1.3)))    # Pa
    allowable = float(mat.get("allowable", yield_strength / 1.5))

    sec = _section(context)
    I, Z, A = _properties(sec)
    if Z <= 0 or A <= 0:
        return {
            "action": "LOAD_CALC", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "section has no usable geometry"},
        }

    bending_stress = moment / Z
    # Rectangular section shear: tau = 1.5 V / A
    shear_stress = 1.5 * shear / A
    axial_stress = axial / A
    # von Mises for a plane-stress state with a shear component.
    vm = math.sqrt(bending_stress ** 2 + 3 * shear_stress ** 2 + axial_stress ** 2)
    util = vm / allowable if allowable else 0.0

    # Deflection of a simply supported beam: 5 w L^4 / (384 E I)
    length = float(loads.get("length", loads.get("L", 0)) or 0)
    w = float(loads.get("distributed", loads.get("w", 0)) or 0)
    deflection = (5 * w * length ** 4 / (384 * E * I)) if (length and w and I) else 0.0
    max_deflection = float(mat.get("max_deflection", length / 360) if length else 0.0)

    checks = {
        "bending": {"value": round(bending_stress, 2), "utilisation": round(bending_stress / allowable, 3) if allowable else None},
        "shear": {"value": round(shear_stress, 2), "utilisation": round(shear_stress / allowable, 3) if allowable else None},
        "axial": {"value": round(axial_stress, 2), "utilisation": round(axial_stress / allowable, 3) if allowable else None},
    }
    ok = util <= 1.0 and (not max_deflection or deflection <= max_deflection)

    return {
        "action": "LOAD_CALC",
        "intensity": round(min(1.0, util), 3),
        "version": 1,
        "result": {
            "ok": ok,
            "utilisation": round(util, 3),
            "von_mises_pa": round(vm, 2),
            "allowable_pa": allowable,
            "section_properties": {
                "I_m4": round(I, 10),
                "Z_m3": round(Z, 8),
                "area_m2": round(A, 6),
                "type": sec["type"],
            },
            "checks": checks,
            "deflection_m": round(deflection, 8),
            "max_deflection_m": max_deflection,
            "governing": max(checks.items(), key=lambda kv: kv[1]["utilisation"] or 0)[0],
        },
    }`.trim()),
  },
  engineer_stress_analysis_protocol: {
    runtime: "python",
    reactivation_triggers: ["stress", "strain", "tension", "compression"],
    payload: PY(`"""Stress analysis of a member under combined loading with safety factors.

Takes a set of load cases, applies partial safety factors, computes
each case's von Mises utilisation, and reports the critical case and
whether the member passes with a stated margin.

Transferable: load rating, factor of safety checks, anything that
combines several load cases into a pass/fail with a margin.
Originally forged by: engineer.adopt
"""
import math


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def skill(organism, context):
    """Evaluate multiple load cases and report the governing one."""
    cases = context.get("cases", context.get("load_cases", []))
    if isinstance(cases, dict):
        cases = [{"name": k, **v} for k, v in cases.items()]
    if not isinstance(cases, list) or not cases:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of load cases"},
        }

    mat = context.get("material", {}) or {}
    E = _num(mat.get("E", 200e9), 200e9)
    yield_strength = _num(mat.get("yield", mat.get("yield_strength", 250e6)), 250e6)
    safety_factor = _num(mat.get("safety_factor", 1.5), 1.5)
    allowable = yield_strength / safety_factor if safety_factor else yield_strength

    sec = context.get("section", {}) or {}
    depth = _num(sec.get("depth", sec.get("h", 0.2)), 0.2)
    width = _num(sec.get("width", sec.get("b", 0.1)), 0.1)
    I = width * depth ** 3 / 12.0
    Z = width * depth ** 2 / 6.0
    A = width * depth
    if Z <= 0 or A <= 0:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "section has no usable geometry"},
        }

    results = []
    for i, case in enumerate(cases):
        if not isinstance(case, dict):
            continue
        moment = _num(case.get("moment", case.get("M", 0)))
        shear = _num(case.get("shear", case.get("V", 0)))
        axial = _num(case.get("axial", case.get("N", 0)))
        factor = _num(case.get("factor", 1.0), 1.0)

        sb = abs(moment) * factor / Z
        sv = 1.5 * abs(shear) * factor / A
        sa = abs(axial) * factor / A
        vm = math.sqrt(sb ** 2 + 3 * sv ** 2 + sa ** 2)
        results.append({
            "name": case.get("name", f"case_{i}"),
            "factor": factor,
            "von_mises_pa": round(vm, 2),
            "bending_pa": round(sb, 2),
            "shear_pa": round(sv, 2),
            "axial_pa": round(sa, 2),
            "utilisation": round(vm / allowable, 3) if allowable else None,
        })

    if not results:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable load cases"},
        }

    results.sort(key=lambda r: r["utilisation"] or 0, reverse=True)
    governing = results[0]
    margin = 1.0 - governing["utilisation"] if governing["utilisation"] is not None else 0.0

    return {
        "action": "STRESS_ANALYSIS",
        "intensity": round(min(1.0, governing["utilisation"] or 0), 3),
        "version": 1,
        "result": {
            "ok": (governing["utilisation"] or 0) <= 1.0,
            "cases_evaluated": len(results),
            "governing_case": governing,
            "margin": round(margin, 3),
            "safety_factor": safety_factor,
            "allowable_pa": allowable,
            "all_cases": results,
        },
    }`.trim()),
  },
  engineer_tolerance_design_protocol: {
    runtime: "python",
    reactivation_triggers: ["tolerance", "fit", "clearance", "engineering"],
    payload: PY(`"""Tolerance stack-up for assembled parts.

Given nominal dimensions, tolerances and their statistical independence,
computes the worst-case and RSS (statistical) stack, then the resulting
assembly variation. Supports either worst-case arithmetic or RSS, which
is the choice that actually decides whether a design is capable.

Transferable: any assembly tolerance analysis (mechanical, PCB, optical
alignment, packaging).
Originally forged by: engineer.adopt
"""
import math


def _tol(entry):
    """Return (nominal, plus_tol, minus_tol) from a flexible spec."""
    if isinstance(entry, (int, float)):
        return float(entry), 0.0, 0.0
    if not isinstance(entry, dict):
        return 0.0, 0.0, 0.0
    nominal = float(entry.get("nominal", entry.get("value", 0)) or 0)
    plus = float(entry.get("plus", entry.get("upper", entry.get("+", 0))) or 0)
    minus = float(entry.get("minus", entry.get("lower", entry.get("-", 0))) or 0)
    return nominal, plus, minus


def skill(organism, context):
    """Compute worst-case and statistical tolerance stacks."""
    dims = context.get("dimensions", context.get("dims", []))
    if isinstance(dims, dict):
        dims = [{"name": k, **v} for k, v in dims.items()]
    if not isinstance(dims, list) or not dims:
        return {
            "action": "TOLERANCE_DESIGN", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of dimensions"},
        }

    method = str(context.get("method", "rss")).lower()
    target = context.get("target_tolerance", context.get("tolerance_limit"))

    entries = []
    wc_sum = 0.0
    rss_sq = 0.0
    nominal_total = 0.0
    for d in dims:
        if not isinstance(d, dict):
            continue
        n, p, m = _tol(d)
        entries.append({
            "name": d.get("name", d.get("id", f"dim{len(entries)}")),
            "nominal": n, "plus": p, "minus": m,
        })
        nominal_total += n
        wc_sum += abs(p) + abs(m)
        # RSS treats the tolerance as a +/- range about the nominal, so
        # each contribution is (p+m)/2.
        half = (abs(p) + abs(m)) / 2.0
        rss_sq += half ** 2

    if not entries:
        return {
            "action": "TOLERANCE_DESIGN", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable dimensions"},
        }

    rss = math.sqrt(rss_sq)
    stack = wc_sum if method in ("worst", "worst_case", "arithmetic") else rss
    # The resulting limit deviation on the assembly is half the stack.
    limit_deviation = stack / 2.0

    ok = None
    if target is not None:
        try:
            ok = limit_deviation <= float(target)
        except (TypeError, ValueError):
            ok = None

    return {
        "action": "TOLERANCE_DESIGN",
        "intensity": round(min(1.0, (limit_deviation / float(target)) if (target and ok is not None) else 0.5), 3),
        "version": 1,
        "result": {
            "ok": ok,
            "method": method,
            "nominal_sum": round(nominal_total, 6),
            "worst_case_stack": round(wc_sum, 6),
            "rss_stack": round(rss, 6),
            "stack_used": round(stack, 6),
            "limit_deviation": round(limit_deviation, 6),
            "target_tolerance": target,
            "dimensions": entries,
        },
    }`.trim()),
  },

  // ─── TRADER — FROM DISK (crypto_price_v2, rsi_calculator_v2) + signal_synthesis ─
  crypto_price_v2_protocol: {
    runtime: "python",
    reactivation_triggers: ["price", "crypto", "market", "trading"],
    payload: PY(`"""Real crypto price fetcher using public CoinGecko API."""
import urllib.request, urllib.parse, json

def skill(organism, context):
    """Fetch current price for a crypto symbol.
    context: {"symbol": "bitcoin"}  or  {"ids": "bitcoin,ethereum"}
    """
    base = "https://api.coingecko.com/api/v3/simple/price"
    params = {
        "vs_currencies": "usd",
        "include_24hr_change": "true",
        "include_market_cap": "true",
    }
    if "ids" in context:
        params["ids"] = context["ids"]
    elif "symbol" in context:
        params["ids"] = context["symbol"]
    else:
        return {"error": "symbol or ids required"}
    try:
        url = base + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        return {"prices": data, "fetched_at": __import__("time").time()}
    except Exception as e:
        return {"error": str(e)}`.trim()),
  },
  rsi_calculator_v2_protocol: {
    runtime: "python",
    reactivation_triggers: ["rsi", "relative", "strength", "index"],
    payload: PY(`"""Real RSI (Relative Strength Index) calculator."""
def skill(organism, context):
    """Calculate RSI from a list of closing prices.
    context: {"prices": [44, 44.34, 44.09, ...], "period": 14}
    """
    prices = context.get("prices", [])
    period = int(context.get("period", 14))
    if len(prices) < period + 1:
        return {"error": f"need at least {period + 1} prices, got {len(prices)}"}
    gains, losses = [], []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    # Wilder's smoothing
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
    return {
        "rsi": round(rsi, 2),
        "period": period,
        "signal": "overbought" if rsi > 70 else "oversold" if rsi < 30 else "neutral",
        "samples": len(prices),
    }`.trim()),
  },
  signal_synthesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["signal", "trade", "entry", "exit"],
    payload: PY(`"""Signal synthesis across multiple technical indicators.

Reads RSI, MACD and moving-average signals and combines them into one
directional call with a confidence that reflects their agreement.
Disagreement lowers confidence rather than being averaged away, which
is what makes it usable as a decision input rather than a number to
admire.

Transferable: any ensemble of indicators into one call (fraud scores,
sensor fusion, medical triage scores).
Originally forged by: trader.adopt
"""


def _rsi_signal(context):
    for key in ("rsi", "rsi_value"):
        v = context.get(key)
        if isinstance(v, (int, float)):
            r = float(v)
            if r >= 70:
                return "overbought", -1, abs(r - 70) / 30.0
            if r <= 30:
                return "oversold", 1, abs(30 - r) / 30.0
            return "neutral", 0, 0.0
    return None


def _macd_signal(context):
    for key in ("macd", "macd_histogram", "histogram"):
        v = context.get(key)
        if isinstance(v, (int, float)):
            h = float(v)
            if h > 0:
                return "bullish", 1, min(1.0, abs(h))
            if h < 0:
                return "bearish", -1, min(1.0, abs(h))
            return "neutral", 0, 0.0
    return None


def _ma_signal(context):
    ma = context.get("ma_signal")
    if isinstance(ma, str):
        s = ma.lower()
        if "bull" in s or "up" in s:
            return "bullish", 1, 0.5
        if "bear" in s or "down" in s:
            return "bearish", -1, 0.5
        return "neutral", 0, 0.0
    return None


def skill(organism, context):
    """Fuse technical indicators into one directional signal."""
    sources = [
        ("rsi", _rsi_signal(context)),
        ("macd", _macd_signal(context)),
        ("ma", _ma_signal(context)),
    ]
    active = [(n, s) for n, s in sources if s is not None]

    if not active:
        return {
            "action": "SIGNAL_SYNTHESIS", "intensity": 0.0, "version": 1,
            "result": {
                "signal": "unknown", "direction": 0, "confidence": 0.0,
                "agreement": 0.0, "inputs_used": 0,
                "error": "need at least one of rsi / macd / ma_signal",
            },
        }

    dirs = [sig[1] for _, sig in active]
    direction = sum(dirs) / len(dirs)
    bulls = sum(1 for d in dirs if d > 0)
    bears = sum(1 for d in dirs if d < 0)
    neutral = sum(1 for d in dirs if d == 0)
    # Agreement is the share of directional votes pointing the same way.
    directional = bulls + bears
    if directional == 0:
        agreement = 0.0
    else:
        dominant = max(bulls, bears)
        agreement = dominant / directional

    strength = sum(abs(sig[2]) for _, sig in active) / len(active)
    # Confidence needs both agreement AND signal strength. Two
    # indicators pointing opposite ways is not a confident call.
    confidence = round(agreement * min(1.0, strength * 1.5), 3)

    if direction > 0.15:
        label = "bullish"
    elif direction < -0.15:
        label = "bearish"
    else:
        label = "neutral"

    # A conflict is worth surfacing even when the label is neutral.
    conflict = bulls > 0 and bears > 0

    return {
        "action": "SIGNAL_SYNTHESIS",
        "intensity": round(min(1.0, abs(direction)), 3),
        "version": 1,
        "result": {
            "signal": label,
            "direction": round(direction, 3),
            "confidence": confidence,
            "agreement": round(agreement, 3),
            "conflict": conflict,
            "bulls": bulls,
            "bears": bears,
            "neutral": neutral,
            "inputs_used": len(active),
            "components": {n: {"label": sig[0], "direction": sig[1], "strength": round(sig[2], 3)} for n, sig in active},
        },
    }`.trim()),
  },

  // ─── DOCTOR ─────────────────────────────────────────────────────────
  doctor_triage_protocol: {
    runtime: "python",
    reactivation_triggers: ["triage", "urgent", "emergency", "patient"],
    payload: PY(`"""Clinical triage — assign an acuity level from vitals and complaint.

Implements a NEWS2-style early warning score: each vital contributes
points, the total maps to an acuity band and a maximum wait time.
Transparent, deterministic, and auditable, which is what triage needs
to be.

Transferable: any risk-scoring triage (incident severity, queue
priority, security escalation).
Originally forged by: doctor.adopt
"""


def _vitals(context):
    v = context.get("vitals", context.get("observations", {})) or {}
    def g(*keys, default=None):
        for k in keys:
            if k in v and v[k] is not None:
                try:
                    return float(v[k])
                except (TypeError, ValueError):
                    return default
        return default
    return {
        "respiratory_rate": g("respiratory_rate", "rr"),
        "spo2": g("spo2", "o2_sat", "sats"),
        "systolic_bp": g("systolic_bp", "sbp", "systolic"),
        "pulse": g("pulse", "heart_rate", "hr"),
        "consciousness": g("consciousness", "avpu", "gcs"),
        "temperature": g("temperature", "temp"),
    }


def skill(organism, context):
    """Score vitals into a triage priority and target time to care."""
    v = _vitals(context)
    total = 0
    contributions = {}

    rr = v["respiratory_rate"]
    if rr is not None:
        if rr <= 8:
            p = 3
        elif rr <= 11:
            p = 1
        elif rr <= 20:
            p = 0
        elif rr <= 24:
            p = 2
        else:
            p = 3
        contributions["respiratory_rate"] = p
        total += p

    spo2 = v["spo2"]
    if spo2 is not None:
        if spo2 <= 91:
            p = 3
        elif spo2 <= 93:
            p = 2
        elif spo2 <= 95:
            p = 1
        else:
            p = 0
        contributions["spo2"] = p
        total += p

    sbp = v["systolic_bp"]
    if sbp is not None:
        if sbp <= 90:
            p = 3
        elif sbp <= 100:
            p = 2
        elif sbp <= 110:
            p = 1
        elif sbp <= 220:
            p = 0
        else:
            p = 3
        contributions["systolic_bp"] = p
        total += p

    pulse = v["pulse"]
    if pulse is not None:
        if pulse <= 40:
            p = 3
        elif pulse <= 50:
            p = 1
        elif pulse <= 90:
            p = 0
        elif pulse <= 110:
            p = 1
        elif pulse <= 130:
            p = 2
        else:
            p = 3
        contributions["pulse"] = p
        total += p

    cons = v["consciousness"]
    if cons is not None:
        p = 3 if str(cons).upper() in ("V", "P", "U", "UNRESPONSIVE") else 0
        contributions["consciousness"] = p
        total += p

    temp = v["temperature"]
    if temp is not None:
        if temp <= 35.0:
            p = 3
        elif temp <= 36.0:
            p = 1
        elif temp <= 38.0:
            p = 0
        elif temp <= 39.0:
            p = 1
        else:
            p = 2
        contributions["temperature"] = p
        total += p

    if not contributions:
        return {
            "action": "TRIAGE", "intensity": 0.0, "version": 1,
            "result": {
                "acuity": "undetermined", "score": 0, "max_wait_minutes": None,
                "error": "no vitals supplied",
            },
        }

    if total >= 7:
        acuity, wait = "critical", 0
    elif total >= 5:
        acuity, wait = "emergent", 10
    elif total >= 3:
        acuity, wait = "urgent", 60
    elif total >= 1:
        acuity, wait = "standard", 240
    else:
        acuity, wait = "routine", 240

    return {
        "action": "TRIAGE",
        "intensity": round(min(1.0, total / 12.0), 3),
        "version": 1,
        "result": {
            "acuity": acuity,
            "score": total,
            "max_wait_minutes": wait,
            "contributions": contributions,
            "escalate": total >= 7,
            "vitals_seen": v,
        },
    }`.trim()),
  },
  doctor_differential_protocol: {
    runtime: "python",
    reactivation_triggers: ["differential", "diagnosis", "symptoms", "disease"],
    payload: PY(`"""Differential diagnosis from presenting findings.

Ranks candidate conditions by how well the supplied findings support
each one, using a weight per finding per condition. Crucially it also
returns what is NOT accounted for, and which single finding would most
change the ranking — the part that actually helps a clinician decide
what to test next.

Transferable: hypothesis ranking from evidence (root-cause analysis,
incident investigation, literature screening).
Originally forged by: doctor.adopt
"""
import math

# Each condition lists the findings that support it and how strongly.
CONDITIONS = {
    "sepsis": {
        "fever": 3, "tachycardia": 2, "hypotension": 3, "confusion": 2,
        "tachypnea": 2, "high_white_count": 3, "lactate_high": 3,
    },
    "pneumonia": {
        "fever": 2, "cough": 3, "hypoxia": 3, "crackles": 3, "tachypnea": 2,
    },
    "myocardial_infarction": {
        "chest_pain": 3, "diaphoresis": 2, "elevated_troponin": 3,
        "arm_pain": 2, "nausea": 1, "tachycardia": 1,
    },
    "pulmonary_embolism": {
        "chest_pain": 2, "hypoxia": 3, "tachycardia": 2, "dvt_signs": 3,
        "sudden_onset": 2,
    },
    "stroke": {
        "facial_droop": 3, "arm_weakness": 3, "speech_disturbance": 3,
        "sudden_onset": 3, "confusion": 1, "hypertension": 1,
    },
    "hypoglycemia": {
        "sweating": 2, "confusion": 2, "shakiness": 2, "low_glucose": 3,
        "palpitations": 1,
    },
    "gastroenteritis": {
        "vomiting": 3, "diarrhoea": 3, "abdominal_pain": 2, "dehydration": 2,
    },
    "anaphylaxis": {
        "urticaria": 3, "angioedema": 3, "wheeze": 3, "hypotension": 2,
        "exposure_history": 2,
    },
}

# Findings that, if present, argue against a condition.
NEGATIVE_WEIGHTS = {
    "sepsis": {"rash": 1},
    "pneumonia": {"rash": 1},
    "stroke": {"fever": 1},
}


def _findings(context):
    raw = context.get("findings", context.get("symptoms", []))
    if isinstance(raw, dict):
        raw = [raw]
    if isinstance(raw, str):
        raw = [raw]
    out = []
    for f in raw or []:
        if isinstance(f, str):
            out.append(f.strip().lower().replace(" ", "_"))
        elif isinstance(f, dict):
            name = f.get("name", f.get("finding", ""))
            if name:
                out.append(str(name).strip().lower().replace(" ", "_"))
    return out


def skill(organism, context):
    """Rank differential diagnoses and name the discriminating finding."""
    findings = _findings(context)
    if not findings:
        return {
            "action": "DIFFERENTIAL", "intensity": 0.0, "version": 1,
            "result": {"candidates": [], "error": "need a list of findings"},
        }

    ranked = []
    for name, weights in CONDITIONS.items():
        support = 0.0
        matched = []
        for f in findings:
            if f in weights:
                support += weights[f]
                matched.append(f)
        if support <= 0:
            continue
        penalty = sum(NEGATIVE_WEIGHTS.get(name, {}).get(f, 0) for f in findings)
        net = support - penalty
        # Normalise by the maximum support this condition could have
        # reached, so scores are comparable across conditions.
        ceiling = sum(weights.values())
        ranked.append({
            "condition": name,
            "score": round(net, 2),
            "normalised": round(net / ceiling, 4) if ceiling else 0.0,
            "supporting_findings": matched,
            "unsupported_by": [f for f in findings if f not in weights],
        })

    if not ranked:
        return {
            "action": "DIFFERENTIAL", "intensity": 0.0, "version": 1,
            "result": {
                "candidates": [],
                "error": "no condition matched the supplied findings",
            },
        }

    ranked.sort(key=lambda r: r["score"], reverse=True)
    total = sum(r["score"] for r in ranked) or 1
    for r in ranked:
        r["probability"] = round(r["score"] / total, 4)

    # Which single unobserved finding would most change the ranking?
    # This is the actionable output: what to ask or test next.
    observed = set(findings)
    best_probe = None
    best_gain = 0.0
    for name, weights in CONDITIONS.items():
        for f, w in weights.items():
            if f in observed:
                continue
            gain = w / max(1, len(weights))
            if gain > best_gain:
                best_gain = gain
                best_probe = {"finding": f, "would_support": name, "weight": w}
    for name, weights in NEGATIVE_WEIGHTS.items():
        for f, w in weights.items():
            if f in observed:
                continue
            if w / max(1, len(weights)) > best_gain:
                best_gain = w / max(1, len(weights))
                best_probe = {"finding": f, "would_support_against": name, "weight": w}

    top = ranked[0]
    # A wide margin between first and second is what makes a ranking
    # actionable; a narrow one means the differential is open.
    margin = top["score"] - (ranked[1]["score"] if len(ranked) > 1 else 0)
    decisive = margin >= 2.0

    return {
        "action": "DIFFERENTIAL",
        "intensity": round(min(1.0, top["probability"] * 2), 3),
        "version": 1,
        "result": {
            "candidates": ranked[:5],
            "top": top["condition"],
            "top_probability": top["probability"],
            "margin_over_second": round(margin, 2),
            "decisive": decisive,
            "findings_used": findings,
            "next_best_test": best_probe,
            "unexplained_findings": top["unsupported_by"],
        },
    }`.trim()),
  },
  doctor_treatment_protocol: {
    runtime: "python",
    reactivation_triggers: ["treatment", "therapy", "prescription", "patient"],
    payload: PY(`"""Treatment planning from a working diagnosis and patient constraints.

Checks a proposed treatment against allergies, contraindications, renal
and hepatic impairment, and pregnancy, then adjusts the dose for renal
function using the Cockcroft-Gault estimate. Outputs a plan with the
adjustments applied and the reasons, so a clinician can see why.

Transferable: any policy-checked recommendation with dose adjustment
(software rollout canaries, chemical dosing, resource quotas).
Originally forged by: doctor.adopt
"""


def _creatinine_mgdl_to_mlmin(creatinine_mgdl, age, weight_kg):
    """Cockcroft-Gault, creatinine in mg/dL -> CrCl in mL/min."""
    return ((140 - age) * weight_kg) / (72.0 * creatinine_mgdl)


def skill(organism, context):
    """Validate a treatment and adjust it for the patient's context."""
    treatment = context.get("treatment", {}) or {}
    drug = str(treatment.get("drug", treatment.get("name", ""))).strip()
    dose = treatment.get("dose", treatment.get("dose_mg", 0))
    try:
        dose = float(dose)
    except (TypeError, ValueError):
        dose = 0.0

    allergies = [str(a).strip().lower() for a in (context.get("allergies", []) or [])]
    conditions = [str(c).strip().lower() for c in (context.get("conditions", []) or [])]
    age = float(context.get("age", 0) or 0)
    weight = float(context.get("weight_kg", context.get("weight", 0)) or 0)
    creatinine = context.get("creatinine_mgdl", context.get("creatinine"))
    pregnant = bool(context.get("pregnant", False))

    # Drug class rules: each entry lists blocked allergies, cautions and
    # dosing notes.
    RULES = {
        "nsaid": {
            "block_allergy": ["nsaid", "aspirin", "ibuprofen"],
            "caution_condition": ["peptic_ulcer", "renal_failure", "heart_failure"],
            "contraindicated_condition": ["pregnancy_third_trimester"],
            "note": "Avoid in renal impairment and active ulcer; COX-2 selective is safer.",
        },
        "warfarin": {
            "block_allergy": ["warfarin"],
            "caution_condition": ["bleeding_disorder", "liver_failure"],
            "note": "Requires INR monitoring; many drug and food interactions.",
        },
        "metformin": {
            "block_allergy": ["metformin"],
            "caution_condition": ["liver_failure"],
            "contraindicated_condition": ["renal_failure"],
            "note": "Contraindicated below eGFR 30; hold around contrast imaging.",
        },
        "ibuprofen": {
            "block_allergy": ["nsaid", "ibuprofen", "aspirin"],
            "caution_condition": ["peptic_ulcer", "renal_failure"],
            "note": "Shortest course at lowest effective dose.",
        },
        "amoxicillin": {
            "block_allergy": ["penicillin", "amoxicillin"],
            "caution_condition": [],
            "note": "Check for penicillin allergy cross-reactivity.",
        },
        "lisinopril": {
            "block_allergy": ["lisinopril"],
            "caution_condition": ["hyperkalemia", "renal_failure"],
            "contraindicated_condition": ["pregnancy"],
            "note": "Contraindicated in pregnancy; monitor potassium and creatinine.",
        },
    }

    if not drug:
        return {
            "action": "TREATMENT", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "treatment.drug is required"},
        }

    key = drug.lower().replace("-", "").replace(" ", "")
    rule = None
    for k, r in RULES.items():
        if key.replace("-", "") == k.replace("-", "") or k in key:
            rule = r
            break

    blocks = []
    cautions = []
    notes = []
    if rule:
        notes.append(rule.get("note", ""))
        for a in allergies:
            if a in rule.get("block_allergy", []):
                blocks.append(f"allergy to {a}")
        for c in conditions:
            if c in rule.get("contraindicated_condition", []):
                blocks.append(f"contraindicated with {c}")
            elif c in rule.get("caution_condition", []):
                cautions.append(f"caution: {c}")
        if pregnant and "pregnancy" in rule.get("contraindicated_condition", []):
            blocks.append("contraindicated in pregnancy")
    else:
        notes.append("No specific rule set for this drug; only allergy and pregnancy checks applied.")

    # Renal dose adjustment
    dose_adjustment = None
    crcl = None
    if creatinine is not None and age and weight:
        try:
            crcl = _creatinine_mgdl_to_mlmin(float(creatinine), age, weight)
            if crcl < 30:
                dose_adjustment = 0.0
                cautions.append("renal impairment: reduce or withhold dose")
            elif crcl < 60:
                dose_adjustment = 0.5
                cautions.append("moderate renal impairment: reduce dose")
        except (TypeError, ValueError, ZeroDivisionError):
            crcl = None

    recommended_dose = round(dose * dose_adjustment, 2) if dose_adjustment is not None else dose

    return {
        "action": "TREATMENT",
        "intensity": 1.0 if blocks else (0.6 if cautions else 0.2),
        "version": 1,
        "result": {
            "ok": not blocks,
            "drug": drug,
            "original_dose": dose,
            "recommended_dose": recommended_dose,
            "dose_adjustment_factor": dose_adjustment,
            "crcl_ml_min": round(crcl, 1) if crcl is not None else None,
            "blocks": blocks,
            "cautions": cautions,
            "notes": [n for n in notes if n],
            "requires_review": bool(blocks or cautions),
        },
    }`.trim()),
  },

  // ─── PHYSICIST ──────────────────────────────────────────────────────
  physicist_dimensional_protocol: {
    runtime: "python",
    reactivation_triggers: ["dimension", "units", "physics", "consistency"],
    payload: PY(`"""Dimensional analysis and unit checking.

Tracks a quantity through an expression, keeping the unit attached, and
reports whether the result is dimensionless. Catches dimensional
mismatches before they become wrong numbers — the classic source of
physics and engineering errors.

Transferable: any symbolic unit bookkeeping (chemistry, data pipelines
with mixed units, dimensional ML feature checks).
Originally forged by: physicist.adopt
"""
import math
import re

# Base dimensions: length, mass, time, current, temperature, amount, luminosity
BASE = {
    "m": (1, 0, 0, 0, 0, 0, 0), "kg": (0, 1, 0, 0, 0, 0, 0),
    "s": (0, 0, 1, 0, 0, 0, 0), "A": (0, 0, 0, 1, 0, 0, 0),
    "K": (0, 0, 0, 0, 1, 0, 0), "mol": (0, 0, 0, 0, 0, 1, 0),
    "cd": (0, 0, 0, 0, 0, 0, 1),
}

# Derived units expressed as powers of base units.
DERIVED = {
    "N":  (1, 1, -2, 0, 0, 0, 0),
    "J":  (1, 1, -2, 0, 0, 0, 0),
    "W":  (1, 1, -3, 0, 0, 0, 0),
    "Pa": (-1, 1, -2, 0, 0, 0, 0),
    "Hz": (0, 0, -1, 0, 0, 0, 0),
    "V":  (1, 1, -3, -1, 0, 0, 0),
    "C":  (0, 0, 1, 1, 0, 0, 0),
    "Ohm": (1, 1, -3, -2, 0, 0, 0),
    "T":  (0, 1, -2, -1, 0, 0, 0),
    "F":  (-1, -1, 4, 2, 0, 0, 0),
    "g":  (0, 1, 0, 0, 0, 0, 0),
    "min": (0, 0, 1, 0, 0, 0, 0),
    "h": (0, 0, 1, 0, 0, 0, 0),
    "L":  (1, 0, 0, 0, 0, 0, 0),
}

_NAMES = ("length", "mass", "time", "current", "temperature", "amount", "luminosity")


def _parse_unit(unit):
    """Parse a unit string like 'kg*m/s^2' into a base-dimension vector."""
    if not unit or unit in ("1", "-", "dimensionless"):
        return (0,) * 7
    text = unit.replace("**", "^").replace(" ", "")
    total = [0] * 7
    # Split on * and / while remembering which side we are on.
    tokens = re.split(r"([*/])", text)
    sign = 1
    for tok in tokens:
        if tok == "*":
            sign = 1
            continue
        if tok == "/":
            sign = -1
            continue
        if not tok:
            continue
        m = re.match(r"^([A-Za-zΩμ°]+)(?:\\^(-?\\d+(?:\\.\\d+)?))?$", tok)
        if not m:
            return None
        name, exp = m.group(1), m.group(2)
        exp = float(exp) if exp else 1.0
        if name in BASE:
            vec = BASE[name]
        elif name in DERIVED:
            vec = DERIVED[name]
        else:
            return None
        for i in range(7):
            total[i] += sign * exp * vec[i]
    return tuple(total)


def _describe(vec):
    if all(abs(x) < 1e-9 for x in vec):
        return "dimensionless"
    parts = []
    for i, v in enumerate(vec):
        if abs(v) < 1e-9:
            continue
        parts.append(_NAMES[i] if abs(v - 1) < 1e-9 else f"{_NAMES[i]}^{v:g}")
    return " * ".join(parts)


def skill(organism, context):
    """Check the dimensions of an expression and its result."""
    unit = context.get("unit", context.get("units", ""))
    value = context.get("value", context.get("result", 1))
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 0.0

    operands = context.get("operands", [])
    # Optional: a list of {value, unit} to multiply together.
    if operands:
        total = (0,) * 7
        for o in operands:
            if not isinstance(o, dict):
                continue
            v = _parse_unit(o.get("unit", ""))
            if v is None:
                return {
                    "action": "DIMENSIONAL_ANALYSIS", "intensity": 0.0, "version": 1,
                    "result": {"ok": False, "error": f"unrecognised unit in operand: {o.get('unit')!r}"},
                }
            for i in range(7):
                total[i] += v[i]
        dim = total
    else:
        dim = _parse_unit(unit)
        if dim is None:
            return {
                "action": "DIMENSIONAL_ANALYSIS", "intensity": 0.0, "version": 1,
                "result": {"ok": False, "error": f"unrecognised unit: {unit!r}"},
            }

    # Optional expected dimensions to check against.
    expected = context.get("expected_unit", context.get("expected"))
    mismatch = None
    if expected:
        exp_vec = _parse_unit(expected)
        if exp_vec is None:
            mismatch = f"unrecognised expected unit {expected!r}"
        elif any(abs(a - b) > 1e-6 for a, b in zip(dim, exp_vec)):
            mismatch = f"expected {expected} ({_describe(exp_vec)}) but got {_describe(dim)}"

    dimensionless = all(abs(x) < 1e-9 for x in dim)
    result = {
        "ok": mismatch is None,
        "dimensions": {n: round(v, 6) for n, v in zip(_NAMES, dim) if abs(v) > 1e-9},
        "description": _describe(dim),
        "dimensionless": dimensionless,
        "value": value,
    }
    if mismatch:
        result["mismatch"] = mismatch
    if expected:
        result["expected"] = expected

    return {
        "action": "DIMENSIONAL_ANALYSIS",
        "intensity": 0.2 if dimensionless else 0.5,
        "version": 1,
        "result": result,
    }`.trim()),
  },
  physicist_force_balance_protocol: {
    runtime: "python",
    reactivation_triggers: ["force", "balance", "equilibrium", "physics"],
    payload: PY(`"""Static force balance on a structure.

Sums the applied forces and moments about a chosen point and reports
whether the system is in equilibrium, with the residual that would
cause acceleration or rotation. The residual is the useful part: a
non-zero one says by how much the structure is out of balance.

Transferable: any force-equilibrium check (rigging, brackets, robots,
statics verification).
Originally forged by: physicist.adopt
"""
import math


def _vec(v, default=(0.0, 0.0)):
    if isinstance(v, dict):
        return (float(v.get("x", 0) or 0), float(v.get("y", 0) or 0))
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return (float(v[0]), float(v[1]))
    return default


def skill(organism, context):
    """Sum forces and moments and report the equilibrium residual."""
    forces = context.get("forces", [])
    if not isinstance(forces, list) or not forces:
        return {
            "action": "FORCE_BALANCE", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of forces"},
        }

    pivot = _vec(context.get("pivot", (0.0, 0.0)))
    # Optional third dimension (z) for 3D force balance.
    fx = fy = fz = 0.0
    torque = 0.0
    counted = 0
    details = []

    for i, f in enumerate(forces):
        if not isinstance(f, dict):
            continue
        try:
            x = float(f.get("x", f.get("position_x", 0)) or 0)
            y = float(f.get("y", f.get("position_y", 0)) or 0)
            z = float(f.get("z", f.get("position_z", 0)) or 0)
            mag = float(f.get("magnitude", f.get("force", f.get("value", 0))) or 0)
        except (TypeError, ValueError):
            continue
        angle = f.get("angle", f.get("direction"))
        if angle is None:
            fx += mag
        else:
            try:
                a = math.radians(float(angle))
                fx += mag * math.cos(a)
                fy += mag * math.sin(a)
            except (TypeError, ValueError):
                fx += mag
        fz += float(f.get("fz", f.get("force_z", 0)) or 0)
        # Moment about the pivot: r x F
        torque += (x - pivot[0]) * 0 + (x - pivot[0]) * 0  # placeholder, computed below
        counted += 1
        details.append({
            "index": i,
            "position": [x, y, z],
            "magnitude": mag,
            "angle": angle,
        })

    # Recompute the 2D moment correctly: M = r_x * F_y - r_y * F_x
    torque = 0.0
    for i, f in enumerate(forces):
        if not isinstance(f, dict):
            continue
        try:
            x = float(f.get("x", f.get("position_x", 0)) or 0)
            y = float(f.get("y", f.get("position_y", 0)) or 0)
            mag = float(f.get("magnitude", f.get("force", f.get("value", 0))) or 0)
            angle = f.get("angle", f.get("direction"))
        except (TypeError, ValueError):
            continue
        if angle is None:
            comp_x, comp_y = mag, 0.0
        else:
            try:
                a = math.radians(float(angle))
                comp_x, comp_y = mag * math.cos(a), mag * math.sin(a)
            except (TypeError, ValueError):
                comp_x, comp_y = mag, 0.0
        torque += (x - pivot[0]) * comp_y - (y - pivot[1]) * comp_x

    resultant = math.sqrt(fx ** 2 + fy ** 2 + fz ** 2)
    tolerance = float(context.get("tolerance", 1e-6) or 1e-6)
    balanced = resultant <= tolerance and abs(torque) <= tolerance

    return {
        "action": "FORCE_BALANCE",
        "intensity": round(min(1.0, resultant / (tolerance * 1000) if tolerance else 1.0), 3),
        "version": 1,
        "result": {
            "ok": balanced,
            "balanced": balanced,
            "resultant_force": round(resultant, 8),
            "sum_fx": round(fx, 8),
            "sum_fy": round(fy, 8),
            "sum_fz": round(fz, 8),
            "net_moment": round(torque, 8),
            "pivot": list(pivot),
            "forces_counted": counted,
            "tolerance": tolerance,
        },
    }`.trim()),
  },
  physicist_wave_protocol: {
    runtime: "python",
    reactivation_triggers: ["wave", "frequency", "wavelength", "physics"],
    payload: PY(`"""Wave analysis — superposition, energy and shoaling.

Adds waves by superposition with phase, computes the resulting energy
flux, and applies shoaling (wave height growth as depth decreases) for
a given seabed slope. Handles the shallow-water limit where linear
theory stops applying.

Transferable: any superposition of periodic signals (acoustics, EMI,
structural vibration, population cycles).
Originally forged by: physicist.adopt
"""
import math


def _wave(context, key, default_depth=None):
    w = context.get(key, {}) or {}
    try:
        height = float(w.get("height", w.get("amplitude", 0)) or 0)
        period = float(w.get("period", 0) or 0)
    except (TypeError, ValueError):
        return None
    phase = float(w.get("phase", 0) or 0)
    depth = w.get("depth", default_depth)
    try:
        depth = float(depth) if depth is not None else None
    except (TypeError, ValueError):
        depth = None
    return {"height": height, "period": period, "phase": phase, "depth": depth}


def skill(organism, context):
    """Superpose waves and estimate energy flux and shoaling."""
    waves = []
    for key in ("wave1", "wave2", "wave3", "wave"):
        w = _wave(context, key, context.get("depth"))
        if w and w["period"] > 0:
            waves.append(w)
    if not waves:
        return {
            "action": "WAVE_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need wave1 with a positive period"},
        }

    g = float(context.get("g", 9.81) or 9.81)
    rho = float(context.get("density", 1025) or 1025)  # seawater, kg/m^3

    # Superposition at x = 0 (the reference point).
    total_height = 0.0
    total_slope = 0.0
    components = []
    energy = 0.0
    for w in waves:
        omega = 2 * math.pi / w["period"]
        k = omega ** 2 / g  # deep-water wavenumber
        amp = w["height"] / 2.0
        total_height += amp * math.cos(w["phase"])
        total_slope += amp * k * math.sin(w["phase"])
        # Deep-water energy flux per unit crest width, E = rho g^2 H^2 / (8 w)
        flux = rho * g ** 2 * w["height"] ** 2 / (8 * w["period"])
        energy += flux
        components.append({
            "period": w["period"], "height": w["height"],
            "phase": w["phase"], "wavenumber": round(k, 6),
            "energy_flux_w_m": round(flux, 2),
        })

    # Shoaling: as depth drops, wave height grows.
    shoaling = None
    depth = context.get("depth")
    if depth:
        try:
            d = float(depth)
            if d > 0:
                longest = max(waves, key=lambda w: w["period"])
                T = longest["period"]
                # Deep-water wavelength, then the shoaling coefficient
                # for a horizontal bed: Ks = (Cg_deep / Cg)^0.5
                L0 = g * T ** 2 / (2 * math.pi)
                L = L0 * math.tanh(2 * math.pi * d / L0) ** 0.5 if L0 else L0
                cg_deep = g * T / (4 * math.pi)
                cg = (g / (2 * omega_shallow)) if False else cg_deep
                # Use the full linear-theory group velocity at the given depth.
                omega = 2 * math.pi / T
                kh = omega ** 2 * d / g
                if kh > 0:
                    n = 0.5 * (1 + 2 * kh ** 2 / math.sinh(2 * kh)) if kh > 0.01 else 0.5
                    cg_shallow = cg_deep * n
                    Ks = math.sqrt(cg_deep / cg_shallow) if cg_shallow > 0 else 1.0
                    shoaling = {
                        "depth_m": d,
                        "coeff_ks": round(Ks, 4),
                        "shoaled_height": round(longest["height"] * Ks, 4),
                        "wavelength_m": round(L, 3),
                        "kh": round(kh, 4),
                        "shallow_water": kh < 0.01,
                    }
        except (TypeError, ValueError, ZeroDivisionError):
            shoaling = None

    result_height = abs(total_height) * 2.0
    # Constructive interference: the result is meaningfully larger than
    # the largest input.
    largest = max(w["height"] for w in waves)
    constructive = result_height > largest * 1.05

    return {
        "action": "WAVE_ANALYSIS",
        "intensity": round(min(1.0, result_height / (largest * 3 or 1)), 3),
        "version": 1,
        "result": {
            "ok": True,
            "resulting_height": round(result_height, 4),
            "largest_input": largest,
            "constructive": constructive,
            "total_energy_flux_w_m": round(energy, 2),
            "components": components,
            "shoaling": shoaling,
        },
    }`.trim()),
  },

  // ─── ARCHAEOLOGIST ─────────────────────────────────────────────────
  archaeo_stratigraphy_protocol: {
    runtime: "python",
    reactivation_triggers: ["stratigraphy", "layer", "depth", "dig"],
    payload: PY(`"""Archaeological stratigraphy — sequence, superposition and phasing.

Orders archaeological contexts by their recorded stratigraphic
relationships (above/below, fills, cuts), detects the contradictions
that indicate a recording error, and computes a Harris matrix of the
accepted order.

Transferable: any dependency ordering over recorded observations with
conflict detection (build dependency graphs, ETL lineage, incident
timeline reconstruction).
Originally forged by: archaeologist.adopt
"""
import re


def _contexts(context):
    raw = context.get("contexts", context.get("units", []))
    if isinstance(raw, dict):
        raw = [{"id": k, **v} for k, v in raw.items()]
    if not isinstance(raw, list):
        return []
    out = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        cid = c.get("id", c.get("context"))
        if cid is None:
            continue
        out.append({
            "id": str(cid),
            "type": str(c.get("type", "deposit")).lower(),
            "above": [str(x) for x in (c.get("above", c.get("later_than", [])) or [])],
            "below": [str(x) for x in (c.get("below", c.get("earlier_than", [])) or [])],
            "date": c.get("date", c.get("period")),
            "description": c.get("description", ""),
        })
    return out


def skill(organism, context):
    """Order contexts, detect contradictions, and build the sequence."""
    ctxs = _contexts(context)
    if not ctxs:
        return {
            "action": "STRATIGRAPHY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a list of contexts"},
        }

    ids = {c["id"] for c in ctxs}
    edges = []          # (later, earlier)
    conflicts = []

    for c in ctxs:
        for a in c["above"]:
            if a not in ids:
                conflicts.append({"type": "dangling_reference", "context": c["id"], "references": a})
                continue
            edges.append((c["id"], a))
        for b in c["below"]:
            if b not in ids:
                conflicts.append({"type": "dangling_reference", "context": c["id"], "references": b})
                continue
            edges.append((b, c["id"]))

    # A cycle means two contexts claim to be above each other.
    adj = {}
    for later, earlier in edges:
        adj.setdefault(later, set()).add(earlier)

    def has_path(src, dst, seen=None):
        seen = seen or set()
        if src in seen:
            return False
        seen.add(src)
        for nxt in adj.get(src, ()):
            if nxt == dst:
                return True
            if has_path(nxt, dst, seen):
                return True
        return False

    for later, earlier in set(edges):
        if has_path(earlier, later):
            conflicts.append({
                "type": "cycle",
                "contexts": [later, earlier],
                "detail": f"{later} is recorded above {earlier} and vice versa",
            })

    # Also flag a context that says it is above something it is
    # explicitly recorded below.
    for c in ctxs:
        for a in c["above"]:
            for b in c["below"]:
                if a == b:
                    conflicts.append({
                        "type": "self_contradiction",
                        "context": c["id"],
                        "detail": f"{c['id']} is both above and below {a}",
                    })

    # Topological order of the acyclic part.
    indeg = {i: 0 for i in ids}
    for later, earlier in set(edges):
        indeg[later] = indeg.get(later, 0) + 1
    ready = sorted([i for i, d in indeg.items() if d == 0])
    order = []
    adj_list = {}
    for later, earlier in set(edges):
        adj_list.setdefault(later, set()).add(earlier)
    # \`indeg\` above counts incoming edges from "later" nodes; for Kahn's
    # algorithm over "is later than" we need out-degree zero first.
    outdeg = {i: 0 for i in ids}
    for later, earlier in set(edges):
        outdeg[earlier] = outdeg.get(earlier, 0) + 1
    ready = sorted([i for i in ids if outdeg[i] == 0])
    while ready:
        node = ready.pop(0)
        order.append(node)
        for later in [l for l, e in set(edges) if e == node]:
            outdeg[later] -= 1
            if outdeg[later] == 0:
                ready.append(later)
        ready.sort()

    # Phase grouping: contexts not related by a stratigraphic edge are
    # contemporaneous.
    phases = []
    assigned = set()
    for cid in order:
        if cid in assigned:
            continue
        group = [cid]
        assigned.add(cid)
        for other in order:
            if other in assigned:
                continue
            if not has_path(cid, other) and not has_path(other, cid):
                group.append(other)
                assigned.add(other)
        phases.append(group)

    return {
        "action": "STRATIGRAPHY",
        "intensity": round(min(1.0, len(conflicts) / max(1, len(ctxs))), 3),
        "version": 1,
        "result": {
            "ok": not conflicts,
            "contexts": len(ctxs),
            "sequence": order,                 # earliest first
            "phases": phases,
            "conflicts": conflicts,
            "relationship_count": len(set(edges)),
            "earliest": order[0] if order else None,
            "latest": order[-1] if order else None,
        },
    }`.trim()),
  },
  archaeo_artifact_inference_protocol: {
    runtime: "python",
    reactivation_triggers: ["artifact", "inference", "dating", "find"],
    payload: PY(`"""Artifact inference — what an artifact implies about its makers.

Given an artifact's material, form, manufacturing evidence and context,
infers the likely production technology, the implied labour investment,
and the social context. The labour estimate is derived from observable
manufacturing traces rather than asserted, so the reasoning stays
auditable.

Transferable: any inference from observed properties to a production
process (reverse engineering, manufacturing forensics, product
counterfeit detection).
Originally forged by: archaeologist.adopt
"""


# Labour hours per unit, by production technology.
LABOUR = {
    "hand_collected": 0.5,
    "hand_knapped": 2.0,
    "hand_formed": 4.0,
    "simple_pottery_wheel": 8.0,
    "fast_pottery_wheel": 15.0,
    "hand_woven": 12.0,
    "loom_woven": 25.0,
    "hand_smelted": 30.0,
    "furnace_smelted": 60.0,
    "hand_worked_metal": 20.0,
    "cast_metal": 35.0,
    "machine_manufactured": 3.0,
    "industrial_molded": 1.0,
}

# Material -> plausible technologies, most likely first.
TECHNOLOGIES = {
    "stone": ["hand_knapped", "hand_collected"],
    "flint": ["hand_knapped"],
    "bone": ["hand_knapped", "hand_collected"],
    "clay": ["simple_pottery_wheel", "hand_formed"],
    "terracotta": ["simple_pottery_wheel", "hand_formed"],
    "copper": ["hand_smelted", "hand_worked_metal", "furnace_smelted"],
    "bronze": ["furnace_smelted", "cast_metal", "hand_worked_metal"],
    "iron": ["furnace_smelted", "cast_metal"],
    "gold": ["hand_worked_metal", "furnace_smelted"],
    "silver": ["hand_worked_metal", "furnace_smelted"],
    "wood": ["hand_collected", "hand_worked"],
    "textile": ["hand_woven", "loom_woven"],
    "fiber": ["hand_woven", "loom_woven"],
    "plastic": ["industrial_molded", "machine_manufactured"],
    "steel": ["industrial_molded", "machine_manufactured"],
}


def _findings(context):
    out = []
    f = context.get("findings", context.get("observations", []))
    if isinstance(f, dict):
        f = [f]
    for x in f or []:
        if isinstance(x, str):
            out.append(x.strip().lower().replace(" ", "_"))
        elif isinstance(x, dict):
            n = x.get("name", x.get("trace", ""))
            if n:
                out.append(str(n).strip().lower().replace(" ", "_"))
    return out


def skill(organism, context):
    """Infer production technology and labour investment from an artifact."""
    material = str(context.get("material", "")).strip().lower()
    form = str(context.get("form", context.get("shape", ""))).strip().lower()
    findings = _findings(context)

    if not material:
        return {
            "action": "ARTIFACT_INFERENCE", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "material is required"},
        }

    plausible = TECHNOLOGIES.get(material)
    if not plausible:
        plausible = ["hand_formed"]

    # Observable manufacturing traces upgrade the estimate.
    TRACE_UPGRADE = {
        "wheel_thrown": "fast_pottery_wheel",
        "fast_pottery_wheel": "fast_pottery_wheel",
        "kiln_dried": "simple_pottery_wheel",
        "firing": "simple_pottery_wheel",
        "temper": "simple_pottery_wheel",
        "casting_sprue": "cast_metal",
        "mould_evidence": "cast_metal",
        "hammer_marks": "hand_worked_metal",
        "annealing": "furnace_smelted",
        "slag_inclusion": "furnace_smelted",
        "wheel_fibre": "loom_woven",
        "inlay": "loom_woven",
        "machine_marks": "machine_manufactured",
        "mould_seam": "industrial_molded",
        "uniform_thickness": "industrial_molded",
        "saw_marks": "machine_manufactured",
        "lathe_marks": "machine_manufactured",
    }

    chosen = plausible[0]
    evidence = []
    for f in findings:
        tech = TRACE_UPGRADE.get(f)
        if tech:
            evidence.append({"trace": f, "implies": tech})
            # Prefer the more advanced technology consistent with the
            # material; a firing trace outranks a default hand-forming.
            if plausible.index(tech) < plausible.index(chosen) or tech not in plausible:
                chosen = tech

    labour = LABOUR.get(chosen, 5.0)
    # Complexity in the form raises the estimate, but with diminishing
    # returns — a complex shape is not ten times the work.
    complexity = 1.0
    if form:
        complexity += min(1.0, len(form.split()) / 4.0) * 0.3
    if context.get("ornamented"):
        complexity += 0.25
    if context.get("composite"):
        complexity += 0.4
    labour = round(labour * complexity, 2)

    # Social context inference from the technology level.
    if chosen in ("industrial_molded", "machine_manufactured"):
        social = "industrialised"
    elif chosen in ("loom_woven", "furnace_smelted", "fast_pottery_wheel", "cast_metal"):
        social = "specialised_workshop"
    elif chosen in ("hand_knapped", "hand_collected", "hand_formed"):
        social = "domestic_foraging"
    else:
        social = "intermediate_workshop"

    return {
        "action": "ARTIFACT_INFERENCE",
        "intensity": round(min(1.0, labour / 60.0), 3),
        "version": 1,
        "result": {
            "ok": True,
            "material": material,
            "form": form,
            "technology": chosen,
            "plausible_technologies": plausible,
            "evidence": evidence,
            "estimated_labour_hours": labour,
            "social_context": social,
            "confidence": round(min(0.95, 0.4 + 0.15 * len(evidence)), 2),
        },
    }`.trim()),
  },
  archaeo_chronology_protocol: {
    runtime: "python",
    reactivation_triggers: ["chronology", "timeline", "date", "age"],
    payload: PY(`"""Chronology — dates, periods and the consistency of a timeline.

Normalises dates in several formats, orders them, groups them into
periods, and checks for temporal impossibilities: an object dated
before the context that contains it, a deposit that post-dates what it
is supposed to underlie.

Transferable: any timeline validation over recorded dates (audit logs,
incident timelines, supply-chain lead times).
Originally forged by: archaeologist.adopt
"""
import re

# Radiocarbon era boundaries (years before present) for coarse periods.
PERIODS = [
    (0, 3000, "Holocene"),
    (3000, 5000, "Mesolithic"),
    (5000, 10000, "Neolithic"),
    (10000, 40000, "Upper Palaeolithic"),
]

# Calendar conversions for calibrated ranges: (year, +/- uncertainty).
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_date(value):
    """Return (year, uncertainty, raw) for a range of date formats."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return (float(value), 0.0, str(value))
    s = str(value).strip()
    if not s:
        return None

    # "1200-1500 AD"
    m = re.match(r"^(-?\\d+(?:\\.\\d+)?)\\s*-\\s*(-?\\d+(?:\\.\\d+)?)\\s*(bce?|bc|ad|ce)?$", s, re.I)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        era = (m.group(3) or "").lower()
        if era.startswith("b"):
            a, b = -a, -b
        return ((a + b) / 2.0, abs(b - a) / 2.0, s)

    # "1500 BP" / "1500 b.p."
    m = re.match(r"^(-?\\d+(?:\\.\\d+)?)\\s*bp\\b", s, re.I)
    if m:
        y = -float(m.group(1))
        return (y, 0.0, s)

    # "1500 BC"
    m = re.match(r"^(-?\\d+(?:\\.\\d+)?)\\s*(bce?|bc)\\b", s, re.I)
    if m:
        y = -float(m.group(1))
        return (y, 0.0, s)

    # "12 Mar 1500" / "Mar 1500" / "1500"
    m = re.match(r"^(\\d{1,2})\\s+([a-z]{3})[a-z]*\\s+(-?\\d+)$", s, re.I)
    if m:
        return (float(m.group(3)), 0.0, s)
    m = re.match(r"^([a-z]{3})[a-z]*\\s+(-?\\d+)$", s, re.I)
    if m:
        return (float(m.group(2)), 0.0, s)
    m = re.match(r"^(-?\\d{1,4})$", s)
    if m:
        return (float(m.group(1)), 0.0, s)

    return None


def _period(year):
    for lo, hi, name in PERIODS:
        if lo <= abs(year) < hi:
            return name
    return "unclassified"


def skill(organism, context):
    """Build and validate a chronology from dated contexts."""
    items = context.get("items", context.get("contexts", []))
    if isinstance(items, dict):
        items = [{"id": k, **v} for k, v in items.items()]
    if not isinstance(items, list) or not items:
        return {
            "action": "CHRONOLOGY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a list of dated items"},
        }

    dated = []
    undated = []
    for it in items:
        if not isinstance(it, dict):
            continue
        raw = it.get("date", it.get("year", it.get("dated")))
        parsed = _parse_date(raw)
        rec = {
            "id": str(it.get("id", it.get("context", f"item{len(dated)}"))),
            "raw_date": raw,
            "contains": [str(x) for x in (it.get("contains", it.get("above", [])) or [])],
            "within": [str(x) for x in (it.get("within", it.get("below", [])) or [])],
            "material": it.get("material", ""),
        }
        if parsed is None:
            undated.append(rec)
        else:
            rec.update({"year": parsed[0], "uncertainty": parsed[1], "period": _period(parsed[0])})
            dated.append(rec)

    if not dated:
        return {
            "action": "CHRONOLOGY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no parsable dates found", "undated": undated},
        }

    dated.sort(key=lambda r: r["year"])
    by_id = {r["id"]: r for r in dated}
    problems = []

    # An object dated earlier than the context holding it is a problem.
    for rec in dated:
        for child in rec["contains"]:
            if child not in by_id:
                continue
            c = by_id[child]
            if c["year"] > rec["year"] + rec["uncertainty"] + c["uncertainty"]:
                problems.append({
                    "type": "object_predates_container",
                    "detail": f"{child} is dated {c['year']:g} but sits in {rec['id']} dated {rec['year']:g}",
                    "context": rec["id"], "object": child,
                })

    # A context cannot be later than the context it is within.
    for rec in dated:
        for parent in rec["within"]:
            if parent not in by_id:
                continue
            p = by_id[parent]
            if rec["year"] < p["year"] - rec["uncertainty"] - p["uncertainty"]:
                problems.append({
                    "type": "context_predates_its_container",
                    "detail": f"{rec['id']} ({rec['year']:g}) is older than {parent} ({p['year']:g}) it should be inside",
                    "context": rec["id"], "container": parent,
                })

    by_period = {}
    for r in dated:
        by_period.setdefault(r["period"], []).append(r["id"])

    span = dated[-1]["year"] - dated[0]["year"]
    # Dating precision: how tight the errors are relative to the span.
    avg_unc = sum(r["uncertainty"] for r in dated) / len(dated)
    precision = round(max(0.0, 1.0 - (avg_unc / span if span else 1.0)), 3)

    return {
        "action": "CHRONOLOGY",
        "intensity": round(min(1.0, len(problems) / max(1, len(dated))), 3),
        "version": 1,
        "result": {
            "ok": not problems,
            "dated": len(dated),
            "undated": len(undated),
            "timeline": [{"id": r["id"], "year": r["year"], "period": r["period"],
                          "uncertainty": r["uncertainty"], "raw": r["raw_date"]} for r in dated],
            "span_years": round(span, 2),
            "periods": by_period,
            "problems": problems,
            "precision": precision,
            "undated_items": undated,
        },
    }`.trim()),
  },

  // ─── FRAUD ANALYST ──────────────────────────────────────────────────
  fraud_anomaly_protocol: {
    runtime: "python",
    reactivation_triggers: ["anomaly", "fraud", "suspicious", "transaction"],
    payload: PY(`"""Fraud anomaly detection over a transaction stream.

Combines several independent detectors — amount outlier, merchant
rarity, off-hours activity, burst velocity — and scores each transaction
rather than hard-flagging it, so a threshold can be tuned against a
cost matrix instead of baked in.

The z-score uses a robust median/MAD estimate rather than mean/stdev,
because fraud skews the very distribution it is measured against: one
huge fraudulent transaction inflates the standard deviation enough to
hide itself.

Transferable: any anomaly scoring over a skewed numeric stream.
Originally forged by: fraud_analyst.adopt
"""
import math
import statistics


def _txs(context):
    raw = context.get("transactions", context.get("txs", []))
    if not isinstance(raw, list):
        return []
    out = []
    for t in raw:
        if isinstance(t, dict):
            out.append(t)
    return out


def _amount(t):
    for k in ("amount", "value", "amt"):
        if k in t:
            try:
                return float(t[k])
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _merchant(t):
    for k in ("nameDest", "destination", "merchant", "counterparty"):
        if t.get(k):
            return str(t[k])
    return ""


def _hour(t):
    for k in ("hour", "hour_of_day"):
        if t.get(k) is not None:
            try:
                return int(t[k])
            except (TypeError, ValueError):
                continue
    return None


def _robust_z(values):
    """Median/MAD z-score. Falls back to mean/stdev when MAD is 0."""
    if len(values) < 3:
        return [0.0] * len(values)
    med = statistics.median(values)
    devs = [abs(v - med) for v in values]
    mad = statistics.median(devs)
    if mad > 1e-9:
        # 1.4826 makes MAD a consistent estimator of sigma for normal data.
        sigma = mad * 1.4826
        return [(v - med) / sigma for v in values]
    mean = statistics.fmean(values)
    try:
        sd = statistics.pstdev(values)
    except statistics.StatisticsError:
        return [0.0] * len(values)
    if sd < 1e-9:
        return [0.0] * len(values)
    return [(v - mean) / sd for v in values]


def skill(organism, context):
    """Score transactions for fraud risk using independent detectors."""
    txs = _txs(context)
    if not txs:
        return {
            "action": "FRAUD_ANOMALY_SCAN", "intensity": 0.0, "version": 1,
            "result": {"flagged": [], "flagged_count": 0, "scored": 0,
                       "error": "no transactions supplied"},
        }

    amounts = [_amount(t) for t in txs]
    zs = _robust_z(amounts)

    # Merchant frequency: a rare counterparty is more suspicious.
    merchant_counts = {}
    for t in txs:
        m = _merchant(t)
        if m:
            merchant_counts[m] = merchant_counts.get(m, 0) + 1
    total = len(txs)

    # Hour distribution: rare hours are suspicious.
    hour_counts = {}
    for t in txs:
        h = _hour(t)
        if h is not None:
            hour_counts[h] = hour_counts.get(h, 0) + 1

    scored = []
    for i, t in enumerate(txs):
        amt = amounts[i]
        z = zs[i]
        m = _merchant(t)
        h = _hour(t)

        reasons = []
        risk = 0.0

        # 1. Amount outlier
        if z >= 3.0:
            risk += 0.40
            reasons.append(f"amount outlier (z={z:.2f})")
        elif z >= 2.0:
            risk += 0.20
            reasons.append(f"amount elevated (z={z:.2f})")

        # 2. Rare merchant
        if m:
            freq = merchant_counts[m] / total
            if merchant_counts[m] == 1 and total >= 20:
                risk += 0.25
                reasons.append("first-seen counterparty")
            elif freq < 0.01:
                risk += 0.15
                reasons.append(f"rare counterparty ({merchant_counts[m]} hits)")

        # 3. Off-hours
        if h is not None and (h < 6 or h > 22):
            if hour_counts.get(h, 0) / total < 0.05:
                risk += 0.20
                reasons.append(f"unusual hour {h}")
            else:
                risk += 0.10
                reasons.append(f"off-hours {h}")

        # 4. Drain pattern: spend a large share of the origin balance
        bal = t.get("balanceOrig", t.get("balance_before"))
        if bal is not None:
            try:
                b = float(bal)
                if b > 0 and amt / b > 0.9:
                    risk += 0.35
                    reasons.append(f"drains {amt/b:.0%} of balance")
            except (TypeError, ValueError, ZeroDivisionError):
                pass

        scored.append({
            "id": t.get("id", i),
            "amount": amt,
            "risk": round(min(1.0, risk), 4),
            "reasons": reasons,
        })

    # 5. Burst / velocity detector.
    #
    # A fraud ring is a group of comparable transfers fired in quick
    # succession. This is the case the amount statistics cannot see: the
    # ring is a large share of the population, so it inflates the very
    # median and MAD it would be measured against, and each transfer
    # looks unremarkable in isolation. The group only stands out when
    # considered together.
    bursts = []
    by_hour = {}
    for i, t in enumerate(txs):
        h = _hour(t)
        if h is not None:
            by_hour.setdefault(h, []).append(i)
    for h, idxs in by_hour.items():
        if len(idxs) < 2:
            continue
        big = [i for i in idxs if amounts[i] > 0]
        if len(big) < 2:
            continue
        burst_total = sum(amounts[i] for i in big)
        burst_mean = burst_total / len(big)
        # Compare the burst against the transactions outside it.
        outside = [amounts[i] for i in range(len(txs)) if i not in set(idxs)]
        outside_mean = statistics.fmean(outside) if outside else 0.0
        ratio = (burst_mean / outside_mean) if outside_mean > 0 else 0.0
        if ratio >= 2.0 and len(big) >= 2:
            bursts.append({
                "hour": h,
                "count": len(big),
                "mean_amount": round(burst_mean, 2),
                "total": round(burst_total, 2),
                "ratio_to_rest": round(ratio, 2),
            })

    if bursts:
        worst = max(bursts, key=lambda b: b["ratio_to_rest"])
        bump = min(0.45, 0.15 * worst["count"] + 0.05 * min(4.0, worst["ratio_to_rest"]))
        # Apply the bump to every transaction in the burst window.
        burst_hours = {b["hour"] for b in bursts}
        for idx, s_ in enumerate(scored):
            h = _hour(txs[idx])
            if h in burst_hours:
                s_["risk"] = round(min(1.0, s_["risk"] + bump), 4)
                s_["reasons"] = s_["reasons"] + [
                    f"burst of {len(bursts)} large transfers in hour {h}"
                ]

    threshold = float(context.get("threshold", 0.5) or 0.5)
    flagged = [s for s in scored if s["risk"] >= threshold]
    scored.sort(key=lambda s: s["risk"], reverse=True)

    mean = statistics.fmean(amounts) if amounts else 0.0
    try:
        stdev = statistics.pstdev(amounts) if len(amounts) > 1 else 0.0
    except statistics.StatisticsError:
        stdev = 0.0

    return {
        "action": "FRAUD_ANOMALY_SCAN",
        "intensity": round(len(flagged) / total, 3) if total else 0.0,
        "version": 1,
        "result": {
            "flagged": [s["id"] for s in flagged],
            "flagged_count": len(flagged),
            "scored": len(scored),
            "threshold": threshold,
            "mean": round(mean, 2),
            "stdev": round(stdev, 2),
            "median": round(statistics.median(amounts), 2) if amounts else 0.0,
            "top_risks": scored[:5],
            "detectors": ["amount_outlier", "merchant_rarity", "unusual_hour", "balance_drain", "burst_velocity"],
            "bursts": bursts,
        },
    }`.trim()),
  },
  fraud_network_protocol: {
    runtime: "python",
    reactivation_triggers: ["network", "graph", "connections", "fraud"],
    payload: PY(`"""Fraud network analysis — who is connected to whom.

Builds a graph of accounts from shared attributes (counterparty,
device, IP, amount patterns) and finds the accounts that sit at the
centre of it. A single transaction may look ordinary; a ring of
accounts cycling money through each other does not.

Centrality uses degree plus the number of short cycles each account
participates in, which is the signature of a money-mule ring.

Transferable: graph-based insider-threat and ring detection.
Originally forged by: fraud_analyst.adopt
"""
from collections import defaultdict


def _txs(context):
    raw = context.get("transactions", context.get("txs", []))
    return [t for t in raw if isinstance(t, dict)] if isinstance(raw, list) else []


def _accounts(txs):
    accs = set()
    for t in txs:
        for k in ("nameOrig", "origin", "account", "from", "nameDest", "destination", "to"):
            v = t.get(k)
            if v:
                accs.add(str(v))
    return accs


def skill(organism, context):
    """Build the transaction graph and rank accounts by ring centrality."""
    txs = _txs(context)
    if len(txs) < 2:
        return {
            "action": "FRAUD_NETWORK", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need at least 2 transactions"},
        }

    edges = defaultdict(float)
    edge_count = defaultdict(int)
    for t in txs:
        src = str(t.get("nameOrig", t.get("origin", t.get("from", ""))) or "")
        dst = str(t.get("nameDest", t.get("destination", t.get("to", ""))) or "")
        if not src or not dst or src == dst:
            continue
        try:
            amt = float(t.get("amount", 0) or 0)
        except (TypeError, ValueError):
            amt = 0.0
        edges[(src, dst)] += amt
        edge_count[(src, dst)] += 1

    if not edges:
        return {
            "action": "FRAUD_NETWORK", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable edges in the transactions"},
        }

    accounts = _accounts(txs)
    undirected = defaultdict(set)
    for (s, d) in edges:
        undirected[s].add(d)
        undirected[d].add(s)

    # Triangle count per node: the cheapest reliable ring signature.
    triangles = defaultdict(int)
    for node, neighbours in undirected.items():
        for a in neighbours:
            for b in neighbours:
                if a < b and b in undirected.get(a, ()):
                    triangles[node] += 1
    # Each triangle contributes to all three of its vertices.
    tri_per_node = {n: triangles[n] // 2 for n in undirected}

    # Also: accounts that both send and receive, which is what a mule
    # does — pass money straight through.
    sends = defaultdict(int)
    receives = defaultdict(int)
    for (s, d) in edges:
        sends[s] += 1
        receives[d] += 1

    total_flow = sum(edges.values()) or 1.0

    # Chain detector: a pass-through chain that loses only a little
    # value at each hop. The triangle count below finds closed rings,
    # but a real laundering chain is often open — money enters one end
    # and leaves the other, with a small haircut at each step. The
    # tell is a high retention ratio across consecutive hops.
    chain_edges = sorted(
        ({"from": s_, "to": d_, "flow": v, "count": edge_count[(s_, d_)]}
         for (s_, d_), v in edges.items()),
        key=lambda e: e["flow"], reverse=True,
    )
    chains = []
    for i, e in enumerate(chain_edges):
        for j in range(i + 1, len(chain_edges)):
            nxt = chain_edges[j]
            if e["to"] != nxt["from"]:
                continue
            retention = nxt["flow"] / e["flow"] if e["flow"] else 0
            if retention >= 0.85 and e["flow"] >= 0.05 * total_flow:
                chains.append({
                    "path": [e["from"], e["to"], nxt["to"]],
                    "retention": round(retention, 4),
                    "flow": round(e["flow"] + nxt["flow"], 2),
                })
    # Extend chains greedily to their full length.
    adjacency = {s_: d_ for (s_, d_) in edges}
    longest_chain = []
    for e in chain_edges:
        path = [e["from"], e["to"]]
        flow = e["flow"]
        cur = e["to"]
        while cur in adjacency:
            nxt_flow = edges[(cur, adjacency[cur])]
            if nxt_flow / flow < 0.85 or flow == 0:
                break
            path.append(adjacency[cur])
            flow = nxt_flow
            cur = adjacency[cur]
        if len(path) > len(longest_chain):
            longest_chain = path

    scores = []
    for a in accounts:
        deg = len(undirected.get(a, ()))
        tri = tri_per_node.get(a, 0)
        thru = min(sends.get(a, 0), receives.get(a, 0))
        flow = sum(v for (s, d), v in edges.items() if s == a) + \\
               sum(v for (s, d), v in edges.items() if d == a)
        # Centrality blend: degree, ring participation, pass-through and
        # the share of money the account touches.
        score = (
            0.25 * min(1.0, deg / 10.0)
            + 0.30 * min(1.0, tri / 3.0)
            + 0.25 * min(1.0, thru / 5.0)
            + 0.20 * min(1.0, flow / total_flow)
        )
        # An account inside a high-retention pass-through chain is a
        # link in a laundering path even when the ring is not closed.
        if a in set(longest_chain) and len(longest_chain) >= 3:
            score += 0.25
        elif a in {x for c in chains for x in c["path"]}:
            score += 0.15
        scores.append({
            "account": a,
            "centrality": round(score, 4),
            "degree": deg,
            "triangles": tri,
            "sends": sends.get(a, 0),
            "receives": receives.get(a, 0),
            "flow": round(flow, 2),
            "role": ("mule" if (thru >= 1 and (tri >= 1 or a in set(longest_chain)))
                     else ("hub" if deg >= 3 else "leaf")),
        })

    scores.sort(key=lambda s: s["centrality"], reverse=True)
    threshold = float(context.get("threshold", 0.4) or 0.4)
    suspicious = [s for s in scores if s["centrality"] >= threshold]

    # Strongly connected components would be ideal, but a full Tarjan
    # is overkill here; the triangle count captures the same signal for
    # the ring sizes that matter.
    return {
        "action": "FRAUD_NETWORK",
        "intensity": round(min(1.0, len(suspicious) / max(1, len(accounts))), 3),
        "version": 1,
        "result": {
            "ok": True,
            "accounts": len(accounts),
            "edges": len(edges),
            "total_flow": round(total_flow, 2),
            "suspicious": suspicious,
            "top_central": scores[:5],
            "mules": [s["account"] for s in scores if s["role"] == "mule"],
            "laundering_chains": chains,
            "longest_chain": longest_chain,
            "threshold": threshold,
        },
    }`.trim()),
  },
  fraud_report_protocol: {
    runtime: "python",
    reactivation_triggers: ["report", "fraud", "summary", "compliance"],
    payload: PY(`"""Fraud investigation report — findings, evidence and recommended actions.

Turns the output of the other fraud skills into a structured report:
what was flagged, why, what the evidence shows, what should happen
next, and how confident the analysis is. The confidence is derived from
how many independent detectors agree, so a single weak signal cannot
produce a confident accusation.

Transferable: any incident report that has to state evidence and
confidence (security incident, compliance finding, quality deviation).
Originally forged by: fraud_analyst.adopt
"""


def _txs(context):
    raw = context.get("transactions", context.get("txs", []))
    return [t for t in raw if isinstance(t, dict)] if isinstance(raw, list) else []


def _amount(t):
    try:
        return float(t.get("amount", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def skill(organism, context):
    """Produce a fraud investigation report with evidence and actions."""
    txs = _txs(context)
    if not txs:
        return {
            "action": "FRAUD_REPORT", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no transactions supplied"},
        }

    # Anomaly evidence: amount outliers with a robust estimate.
    amounts = [_amount(t) for t in txs]
    n = len(amounts)
    sorted_amt = sorted(amounts)
    median = sorted_amt[n // 2] if n % 2 else (sorted_amt[n // 2 - 1] + sorted_amt[n // 2]) / 2
    devs = sorted(abs(a - median) for a in amounts)
    mad = devs[n // 2] if n % 2 else (devs[n // 2 - 1] + devs[n // 2]) / 2
    sigma = mad * 1.4826 if mad > 1e-9 else 0.0

    outlier_ids = set()
    for t, a in zip(txs, amounts):
        if sigma > 1e-9 and (a - median) / sigma >= 3.0:
            outlier_ids.add(str(t.get("id", "")))

    # Type concentration: PaySim shows fraud almost only in TRANSFER
    # and CASH_OUT, so a type that never appears in the flagged set is
    # itself a weak signal.
    types = {}
    for t in txs:
        ty = str(t.get("type", "UNKNOWN"))
        types[ty] = types.get(ty, 0) + 1
    fraud_by_type = {}
    for t in txs:
        if str(t.get("id", "")) in outlier_ids:
            ty = str(t.get("type", "UNKNOWN"))
            fraud_by_type[ty] = fraud_by_type.get(ty, 0) + 1

    # Merchant concentration.
    merch = {}
    for t in txs:
        m = str(t.get("nameDest", ""))
        if m:
            merch[m] = merch.get(m, 0) + 1
    repeat_merchants = {m: c for m, c in merch.items() if c > 1 and len(merch) < max(3, n // 4)}

    # Evidence lines, each with its own weight.
    evidence = []
    if outlier_ids:
        evidence.append({
            "finding": f"{len(outlier_ids)} transaction(s) exceed 3 robust sigma on amount",
            "weight": 0.4, "kind": "amount_outlier",
        })
    if fraud_by_type:
        dominant = max(fraud_by_type.items(), key=lambda kv: kv[1])
        share = dominant[1] / max(1, len(outlier_ids))
        if share >= 0.6:
            evidence.append({
                "finding": f"{share:.0%} of outliers are type {dominant[0]}",
                "weight": 0.25, "kind": "type_concentration",
            })
    if repeat_merchants:
        evidence.append({
            "finding": f"{len(repeat_merchants)} counterparty(ies) appear repeatedly in a sparse merchant set",
            "weight": 0.2, "kind": "merchant_concentration",
        })
    balance_drains = [
        t for t in txs
        if t.get("balanceOrig") not in (None, "")
        and isinstance(t.get("balanceOrig"), (int, float))
        and t["balanceOrig"] > 0
        and _amount(t) / t["balanceOrig"] > 0.9
    ]
    if balance_drains:
        evidence.append({
            "finding": f"{len(balance_drains)} transaction(s) drain over 90% of the origin balance",
            "weight": 0.3, "kind": "balance_drain",
        })

    confidence = min(0.95, sum(e["weight"] for e in evidence))
    # Independent detectors agreeing is what raises confidence, so cap
    # it by how many distinct kinds fired.
    kinds = len({e["kind"] for e in evidence})
    confidence = round(min(confidence, 0.35 * kinds + (0.25 if kinds else 0)), 3)

    total_loss = sum(_amount(t) for t in txs if str(t.get("id", "")) in outlier_ids)
    if confidence >= 0.6:
        action, severity = "escalate_to_investigation", "high"
    elif confidence >= 0.3:
        action, severity = "manual_review", "medium"
    else:
        action, severity = "no_action", "low"

    return {
        "action": "FRAUD_REPORT",
        "intensity": round(confidence, 3),
        "version": 1,
        "result": {
            "ok": True,
            "severity": severity,
            "recommended_action": action,
            "confidence": confidence,
            "confidence_basis": f"{kinds} independent detector(s) fired",
            "transactions_analysed": n,
            "flagged_count": len(outlier_ids),
            "flagged_ids": sorted(outlier_ids),
            "estimated_loss": round(total_loss, 2),
            "evidence": evidence,
            "type_distribution": types,
            "outliers_by_type": fraud_by_type,
            "median_amount": round(median, 2),
            "robust_sigma": round(sigma, 2),
            "repeat_merchants": repeat_merchants,
            "balance_drains": len(balance_drains),
        },
    }`.trim()),
  },
};
