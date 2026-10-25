"""Structural load calculation for beams, columns and plates.

Implements the standard closed-form checks: bending stress, shear
stress, and a combined von Mises criterion against an allowable stress.
The section is described as a rectangle or an I-section so results are
computable without a solver.

Transferable: any structural sanity check (construction, mechanical
design, load rating of shelves and racks).
Originally forged by: engineer.adopt
"""
import math


def _section(context):
    s = context.get("section", {}) or {}
    kind = str(s.get("type", "rectangle")).lower()
    if kind in ("i", "ibeam", "i-beam"):
        return {
            "type": "i",
            "depth": float(s.get("depth", s.get("h", 0.3))),
            "width": float(s.get("width", s.get("bf", 0.15))),
            "flange_t": float(s.get("flange_t", s.get("tf", 0.02))),
            "web_t": float(s.get("web_t", s.get("tw", 0.01))),
        }
    return {
        "type": "rectangle",
        "depth": float(s.get("depth", s.get("h", 0.2))),
        "width": float(s.get("width", s.get("b", 0.1))),
    }


def _properties(sec):
    """Second moment of area (I) and section modulus (Z)."""
    if sec["type"] == "i":
        d, bf, tf, tw = sec["depth"], sec["width"], sec["flange_t"], sec["web_t"]
        h = d - 2 * tf
        I = (bf * d ** 3 - (bf - tw) * h ** 3) / 12.0
        Z = I / (d / 2.0) if d else 0.0
        A = 2 * bf * tf + tw * h
    else:
        b, d = sec["width"], sec["depth"]
        I = b * d ** 3 / 12.0
        Z = b * d ** 2 / 6.0
        A = b * d
    return I, Z, A


def skill(organism, context):
    """Check a member against bending, shear and combined stress."""
    loads = context.get("loads", {}) or {}
    try:
        moment = float(loads.get("moment", loads.get("bending_moment", loads.get("M", 0))))  # N*m
        shear = float(loads.get("shear", loads.get("V", 0)))  # N
        axial = float(loads.get("axial", loads.get("N", 0)))  # N
    except (TypeError, ValueError):
        return {
            "action": "LOAD_CALC", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "loads must be numeric"},
        }

    mat = context.get("material", {}) or {}
    E = float(mat.get("E", 200e9))            # Pa
    yield_strength = float(mat.get("yield", mat.get("yield_strength", 250e6)))  # Pa
    G = float(mat.get("G", E / (2 * 1.3)))    # Pa
    allowable = float(mat.get("allowable", yield_strength / 1.5))

    sec = _section(context)
    I, Z, A = _properties(sec)
    if Z <= 0 or A <= 0:
        return {
            "action": "LOAD_CALC", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "section has no usable geometry"},
        }

    bending_stress = moment / Z
    # Rectangular section shear: tau = 1.5 V / A
    shear_stress = 1.5 * shear / A
    axial_stress = axial / A
    # von Mises for a plane-stress state with a shear component.
    vm = math.sqrt(bending_stress ** 2 + 3 * shear_stress ** 2 + axial_stress ** 2)
    util = vm / allowable if allowable else 0.0

    # Deflection of a simply supported beam: 5 w L^4 / (384 E I)
    length = float(loads.get("length", loads.get("L", 0)) or 0)
    w = float(loads.get("distributed", loads.get("w", 0)) or 0)
    deflection = (5 * w * length ** 4 / (384 * E * I)) if (length and w and I) else 0.0
    max_deflection = float(mat.get("max_deflection", length / 360) if length else 0.0)

    checks = {
        "bending": {"value": round(bending_stress, 2), "utilisation": round(bending_stress / allowable, 3) if allowable else None},
        "shear": {"value": round(shear_stress, 2), "utilisation": round(shear_stress / allowable, 3) if allowable else None},
        "axial": {"value": round(axial_stress, 2), "utilisation": round(axial_stress / allowable, 3) if allowable else None},
    }
    ok = util <= 1.0 and (not max_deflection or deflection <= max_deflection)

    return {
        "action": "LOAD_CALC",
        "intensity": round(min(1.0, util), 3),
        "version": 1,
        "result": {
            "ok": ok,
            "utilisation": round(util, 3),
            "von_mises_pa": round(vm, 2),
            "allowable_pa": allowable,
            "section_properties": {
                "I_m4": round(I, 10),
                "Z_m3": round(Z, 8),
                "area_m2": round(A, 6),
                "type": sec["type"],
            },
            "checks": checks,
            "deflection_m": round(deflection, 8),
            "max_deflection_m": max_deflection,
            "governing": max(checks.items(), key=lambda kv: kv[1]["utilisation"] or 0)[0],
        },
    }
