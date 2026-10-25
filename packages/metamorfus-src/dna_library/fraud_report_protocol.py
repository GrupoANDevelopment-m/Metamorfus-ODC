"""Fraud investigation report — findings, evidence and recommended actions.

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
    }
