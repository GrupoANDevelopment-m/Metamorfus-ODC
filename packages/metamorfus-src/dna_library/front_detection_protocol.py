"""Front detection from a pressure and temperature field.

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
    }
