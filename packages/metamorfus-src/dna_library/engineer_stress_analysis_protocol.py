"""Stress analysis of a member under combined loading with safety factors.

Takes a set of load cases, applies partial safety factors, computes
each case's von Mises utilisation, and reports the critical case and
whether the member passes with a stated margin.

Transferable: load rating, factor of safety checks, anything that
combines several load cases into a pass/fail with a margin.
Originally forged by: engineer.adopt
"""
import math


def _num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def skill(organism, context):
    """Evaluate multiple load cases and report the governing one."""
    cases = context.get("cases", context.get("load_cases", []))
    if isinstance(cases, dict):
        cases = [{"name": k, **v} for k, v in cases.items()]
    if not isinstance(cases, list) or not cases:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of load cases"},
        }

    mat = context.get("material", {}) or {}
    E = _num(mat.get("E", 200e9), 200e9)
    yield_strength = _num(mat.get("yield", mat.get("yield_strength", 250e6)), 250e6)
    safety_factor = _num(mat.get("safety_factor", 1.5), 1.5)
    allowable = yield_strength / safety_factor if safety_factor else yield_strength

    sec = context.get("section", {}) or {}
    depth = _num(sec.get("depth", sec.get("h", 0.2)), 0.2)
    width = _num(sec.get("width", sec.get("b", 0.1)), 0.1)
    I = width * depth ** 3 / 12.0
    Z = width * depth ** 2 / 6.0
    A = width * depth
    if Z <= 0 or A <= 0:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "section has no usable geometry"},
        }

    results = []
    for i, case in enumerate(cases):
        if not isinstance(case, dict):
            continue
        moment = _num(case.get("moment", case.get("M", 0)))
        shear = _num(case.get("shear", case.get("V", 0)))
        axial = _num(case.get("axial", case.get("N", 0)))
        factor = _num(case.get("factor", 1.0), 1.0)

        sb = abs(moment) * factor / Z
        sv = 1.5 * abs(shear) * factor / A
        sa = abs(axial) * factor / A
        vm = math.sqrt(sb ** 2 + 3 * sv ** 2 + sa ** 2)
        results.append({
            "name": case.get("name", f"case_{i}"),
            "factor": factor,
            "von_mises_pa": round(vm, 2),
            "bending_pa": round(sb, 2),
            "shear_pa": round(sv, 2),
            "axial_pa": round(sa, 2),
            "utilisation": round(vm / allowable, 3) if allowable else None,
        })

    if not results:
        return {
            "action": "STRESS_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable load cases"},
        }

    results.sort(key=lambda r: r["utilisation"] or 0, reverse=True)
    governing = results[0]
    margin = 1.0 - governing["utilisation"] if governing["utilisation"] is not None else 0.0

    return {
        "action": "STRESS_ANALYSIS",
        "intensity": round(min(1.0, governing["utilisation"] or 0), 3),
        "version": 1,
        "result": {
            "ok": (governing["utilisation"] or 0) <= 1.0,
            "cases_evaluated": len(results),
            "governing_case": governing,
            "margin": round(margin, 3),
            "safety_factor": safety_factor,
            "allowable_pa": allowable,
            "all_cases": results,
        },
    }
