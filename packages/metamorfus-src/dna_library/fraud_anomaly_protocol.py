"""Fraud anomaly detection over a transaction stream.

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
    }
