"""Real RSI (Relative Strength Index) calculator."""
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
    }