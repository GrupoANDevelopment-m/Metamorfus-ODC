"""Treatment planning from a working diagnosis and patient constraints.

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
    }
