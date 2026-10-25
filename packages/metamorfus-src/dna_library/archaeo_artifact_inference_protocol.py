"""Artifact inference — what an artifact implies about its makers.

Given an artifact's material, form, manufacturing evidence and context,
infers the likely production technology, the implied labour investment,
and the social context. The labour estimate is derived from observable
manufacturing traces rather than asserted, so the reasoning stays
auditable.

Transferable: any inference from observed properties to a production
process (reverse engineering, manufacturing forensics, product
counterfeit detection).
Originally forged by: archaeologist.adopt
"""


# Labour hours per unit, by production technology.
LABOUR = {
    "hand_collected": 0.5,
    "hand_knapped": 2.0,
    "hand_formed": 4.0,
    "simple_pottery_wheel": 8.0,
    "fast_pottery_wheel": 15.0,
    "hand_woven": 12.0,
    "loom_woven": 25.0,
    "hand_smelted": 30.0,
    "furnace_smelted": 60.0,
    "hand_worked_metal": 20.0,
    "cast_metal": 35.0,
    "machine_manufactured": 3.0,
    "industrial_molded": 1.0,
}

# Material -> plausible technologies, most likely first.
TECHNOLOGIES = {
    "stone": ["hand_knapped", "hand_collected"],
    "flint": ["hand_knapped"],
    "bone": ["hand_knapped", "hand_collected"],
    "clay": ["simple_pottery_wheel", "hand_formed"],
    "terracotta": ["simple_pottery_wheel", "hand_formed"],
    "copper": ["hand_smelted", "hand_worked_metal", "furnace_smelted"],
    "bronze": ["furnace_smelted", "cast_metal", "hand_worked_metal"],
    "iron": ["furnace_smelted", "cast_metal"],
    "gold": ["hand_worked_metal", "furnace_smelted"],
    "silver": ["hand_worked_metal", "furnace_smelted"],
    "wood": ["hand_collected", "hand_worked"],
    "textile": ["hand_woven", "loom_woven"],
    "fiber": ["hand_woven", "loom_woven"],
    "plastic": ["industrial_molded", "machine_manufactured"],
    "steel": ["industrial_molded", "machine_manufactured"],
}


def _findings(context):
    out = []
    f = context.get("findings", context.get("observations", []))
    if isinstance(f, dict):
        f = [f]
    for x in f or []:
        if isinstance(x, str):
            out.append(x.strip().lower().replace(" ", "_"))
        elif isinstance(x, dict):
            n = x.get("name", x.get("trace", ""))
            if n:
                out.append(str(n).strip().lower().replace(" ", "_"))
    return out


def skill(organism, context):
    """Infer production technology and labour investment from an artifact."""
    material = str(context.get("material", "")).strip().lower()
    form = str(context.get("form", context.get("shape", ""))).strip().lower()
    findings = _findings(context)

    if not material:
        return {
            "action": "ARTIFACT_INFERENCE", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "material is required"},
        }

    plausible = TECHNOLOGIES.get(material)
    if not plausible:
        plausible = ["hand_formed"]

    # Observable manufacturing traces upgrade the estimate.
    TRACE_UPGRADE = {
        "wheel_thrown": "fast_pottery_wheel",
        "fast_pottery_wheel": "fast_pottery_wheel",
        "kiln_dried": "simple_pottery_wheel",
        "firing": "simple_pottery_wheel",
        "temper": "simple_pottery_wheel",
        "casting_sprue": "cast_metal",
        "mould_evidence": "cast_metal",
        "hammer_marks": "hand_worked_metal",
        "annealing": "furnace_smelted",
        "slag_inclusion": "furnace_smelted",
        "wheel_fibre": "loom_woven",
        "inlay": "loom_woven",
        "machine_marks": "machine_manufactured",
        "mould_seam": "industrial_molded",
        "uniform_thickness": "industrial_molded",
        "saw_marks": "machine_manufactured",
        "lathe_marks": "machine_manufactured",
    }

    chosen = plausible[0]
    evidence = []
    for f in findings:
        tech = TRACE_UPGRADE.get(f)
        if tech:
            evidence.append({"trace": f, "implies": tech})
            # Prefer the more advanced technology consistent with the
            # material; a firing trace outranks a default hand-forming.
            if plausible.index(tech) < plausible.index(chosen) or tech not in plausible:
                chosen = tech

    labour = LABOUR.get(chosen, 5.0)
    # Complexity in the form raises the estimate, but with diminishing
    # returns — a complex shape is not ten times the work.
    complexity = 1.0
    if form:
        complexity += min(1.0, len(form.split()) / 4.0) * 0.3
    if context.get("ornamented"):
        complexity += 0.25
    if context.get("composite"):
        complexity += 0.4
    labour = round(labour * complexity, 2)

    # Social context inference from the technology level.
    if chosen in ("industrial_molded", "machine_manufactured"):
        social = "industrialised"
    elif chosen in ("loom_woven", "furnace_smelted", "fast_pottery_wheel", "cast_metal"):
        social = "specialised_workshop"
    elif chosen in ("hand_knapped", "hand_collected", "hand_formed"):
        social = "domestic_foraging"
    else:
        social = "intermediate_workshop"

    return {
        "action": "ARTIFACT_INFERENCE",
        "intensity": round(min(1.0, labour / 60.0), 3),
        "version": 1,
        "result": {
            "ok": True,
            "material": material,
            "form": form,
            "technology": chosen,
            "plausible_technologies": plausible,
            "evidence": evidence,
            "estimated_labour_hours": labour,
            "social_context": social,
            "confidence": round(min(0.95, 0.4 + 0.15 * len(evidence)), 2),
        },
    }
