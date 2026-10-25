"""Differential diagnosis from presenting findings.

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
    }
