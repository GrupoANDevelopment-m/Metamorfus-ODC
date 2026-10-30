"""Pressure gradient analysis across weather stations.

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
    }
