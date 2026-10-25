"""Tolerance stack-up for assembled parts.

Given nominal dimensions, tolerances and their statistical independence,
computes the worst-case and RSS (statistical) stack, then the resulting
assembly variation. Supports either worst-case arithmetic or RSS, which
is the choice that actually decides whether a design is capable.

Transferable: any assembly tolerance analysis (mechanical, PCB, optical
alignment, packaging).
Originally forged by: engineer.adopt
"""
import math


def _tol(entry):
    """Return (nominal, plus_tol, minus_tol) from a flexible spec."""
    if isinstance(entry, (int, float)):
        return float(entry), 0.0, 0.0
    if not isinstance(entry, dict):
        return 0.0, 0.0, 0.0
    nominal = float(entry.get("nominal", entry.get("value", 0)) or 0)
    plus = float(entry.get("plus", entry.get("upper", entry.get("+", 0))) or 0)
    minus = float(entry.get("minus", entry.get("lower", entry.get("-", 0))) or 0)
    return nominal, plus, minus


def skill(organism, context):
    """Compute worst-case and statistical tolerance stacks."""
    dims = context.get("dimensions", context.get("dims", []))
    if isinstance(dims, dict):
        dims = [{"name": k, **v} for k, v in dims.items()]
    if not isinstance(dims, list) or not dims:
        return {
            "action": "TOLERANCE_DESIGN", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of dimensions"},
        }

    method = str(context.get("method", "rss")).lower()
    target = context.get("target_tolerance", context.get("tolerance_limit"))

    entries = []
    wc_sum = 0.0
    rss_sq = 0.0
    nominal_total = 0.0
    for d in dims:
        if not isinstance(d, dict):
            continue
        n, p, m = _tol(d)
        entries.append({
            "name": d.get("name", d.get("id", f"dim{len(entries)}")),
            "nominal": n, "plus": p, "minus": m,
        })
        nominal_total += n
        wc_sum += abs(p) + abs(m)
        # RSS treats the tolerance as a +/- range about the nominal, so
        # each contribution is (p+m)/2.
        half = (abs(p) + abs(m)) / 2.0
        rss_sq += half ** 2

    if not entries:
        return {
            "action": "TOLERANCE_DESIGN", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable dimensions"},
        }

    rss = math.sqrt(rss_sq)
    stack = wc_sum if method in ("worst", "worst_case", "arithmetic") else rss
    # The resulting limit deviation on the assembly is half the stack.
    limit_deviation = stack / 2.0

    ok = None
    if target is not None:
        try:
            ok = limit_deviation <= float(target)
        except (TypeError, ValueError):
            ok = None

    return {
        "action": "TOLERANCE_DESIGN",
        "intensity": round(min(1.0, (limit_deviation / float(target)) if (target and ok is not None) else 0.5), 3),
        "version": 1,
        "result": {
            "ok": ok,
            "method": method,
            "nominal_sum": round(nominal_total, 6),
            "worst_case_stack": round(wc_sum, 6),
            "rss_stack": round(rss, 6),
            "stack_used": round(stack, 6),
            "limit_deviation": round(limit_deviation, 6),
            "target_tolerance": target,
            "dimensions": entries,
        },
    }
