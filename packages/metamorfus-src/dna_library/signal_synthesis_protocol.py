"""Signal synthesis across multiple technical indicators.

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
    }
