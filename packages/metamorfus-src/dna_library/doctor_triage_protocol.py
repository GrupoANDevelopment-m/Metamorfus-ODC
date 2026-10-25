"""Clinical triage — assign an acuity level from vitals and complaint.

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
    }
