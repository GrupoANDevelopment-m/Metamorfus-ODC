"""Dimensional analysis and unit checking.

Tracks a quantity through an expression, keeping the unit attached, and
reports whether the result is dimensionless. Catches dimensional
mismatches before they become wrong numbers — the classic source of
physics and engineering errors.

Transferable: any symbolic unit bookkeeping (chemistry, data pipelines
with mixed units, dimensional ML feature checks).
Originally forged by: physicist.adopt
"""
import math
import re

# Base dimensions: length, mass, time, current, temperature, amount, luminosity
BASE = {
    "m": (1, 0, 0, 0, 0, 0, 0), "kg": (0, 1, 0, 0, 0, 0, 0),
    "s": (0, 0, 1, 0, 0, 0, 0), "A": (0, 0, 0, 1, 0, 0, 0),
    "K": (0, 0, 0, 0, 1, 0, 0), "mol": (0, 0, 0, 0, 0, 1, 0),
    "cd": (0, 0, 0, 0, 0, 0, 1),
}

# Derived units expressed as powers of base units.
DERIVED = {
    "N":  (1, 1, -2, 0, 0, 0, 0),
    "J":  (1, 1, -2, 0, 0, 0, 0),
    "W":  (1, 1, -3, 0, 0, 0, 0),
    "Pa": (-1, 1, -2, 0, 0, 0, 0),
    "Hz": (0, 0, -1, 0, 0, 0, 0),
    "V":  (1, 1, -3, -1, 0, 0, 0),
    "C":  (0, 0, 1, 1, 0, 0, 0),
    "Ohm": (1, 1, -3, -2, 0, 0, 0),
    "T":  (0, 1, -2, -1, 0, 0, 0),
    "F":  (-1, -1, 4, 2, 0, 0, 0),
    "g":  (0, 1, 0, 0, 0, 0, 0),
    "min": (0, 0, 1, 0, 0, 0, 0),
    "h": (0, 0, 1, 0, 0, 0, 0),
    "L":  (1, 0, 0, 0, 0, 0, 0),
}

_NAMES = ("length", "mass", "time", "current", "temperature", "amount", "luminosity")


def _parse_unit(unit):
    """Parse a unit string like 'kg*m/s^2' into a base-dimension vector."""
    if not unit or unit in ("1", "-", "dimensionless"):
        return (0,) * 7
    text = unit.replace("**", "^").replace(" ", "")
    total = [0] * 7
    # Split on * and / while remembering which side we are on.
    tokens = re.split(r"([*/])", text)
    sign = 1
    for tok in tokens:
        if tok == "*":
            sign = 1
            continue
        if tok == "/":
            sign = -1
            continue
        if not tok:
            continue
        m = re.match(r"^([A-Za-zΩμ°]+)(?:\^(-?\d+(?:\.\d+)?))?$", tok)
        if not m:
            return None
        name, exp = m.group(1), m.group(2)
        exp = float(exp) if exp else 1.0
        if name in BASE:
            vec = BASE[name]
        elif name in DERIVED:
            vec = DERIVED[name]
        else:
            return None
        for i in range(7):
            total[i] += sign * exp * vec[i]
    return tuple(total)


def _describe(vec):
    if all(abs(x) < 1e-9 for x in vec):
        return "dimensionless"
    parts = []
    for i, v in enumerate(vec):
        if abs(v) < 1e-9:
            continue
        parts.append(_NAMES[i] if abs(v - 1) < 1e-9 else f"{_NAMES[i]}^{v:g}")
    return " * ".join(parts)


def skill(organism, context):
    """Check the dimensions of an expression and its result."""
    unit = context.get("unit", context.get("units", ""))
    value = context.get("value", context.get("result", 1))
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = 0.0

    operands = context.get("operands", [])
    # Optional: a list of {value, unit} to multiply together.
    if operands:
        total = (0,) * 7
        for o in operands:
            if not isinstance(o, dict):
                continue
            v = _parse_unit(o.get("unit", ""))
            if v is None:
                return {
                    "action": "DIMENSIONAL_ANALYSIS", "intensity": 0.0, "version": 1,
                    "result": {"ok": False, "error": f"unrecognised unit in operand: {o.get('unit')!r}"},
                }
            for i in range(7):
                total[i] += v[i]
        dim = total
    else:
        dim = _parse_unit(unit)
        if dim is None:
            return {
                "action": "DIMENSIONAL_ANALYSIS", "intensity": 0.0, "version": 1,
                "result": {"ok": False, "error": f"unrecognised unit: {unit!r}"},
            }

    # Optional expected dimensions to check against.
    expected = context.get("expected_unit", context.get("expected"))
    mismatch = None
    if expected:
        exp_vec = _parse_unit(expected)
        if exp_vec is None:
            mismatch = f"unrecognised expected unit {expected!r}"
        elif any(abs(a - b) > 1e-6 for a, b in zip(dim, exp_vec)):
            mismatch = f"expected {expected} ({_describe(exp_vec)}) but got {_describe(dim)}"

    dimensionless = all(abs(x) < 1e-9 for x in dim)
    result = {
        "ok": mismatch is None,
        "dimensions": {n: round(v, 6) for n, v in zip(_NAMES, dim) if abs(v) > 1e-9},
        "description": _describe(dim),
        "dimensionless": dimensionless,
        "value": value,
    }
    if mismatch:
        result["mismatch"] = mismatch
    if expected:
        result["expected"] = expected

    return {
        "action": "DIMENSIONAL_ANALYSIS",
        "intensity": 0.2 if dimensionless else 0.5,
        "version": 1,
        "result": result,
    }
