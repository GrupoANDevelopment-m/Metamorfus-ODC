"""Forecast synthesis from multiple meteorological signals.

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
    }
