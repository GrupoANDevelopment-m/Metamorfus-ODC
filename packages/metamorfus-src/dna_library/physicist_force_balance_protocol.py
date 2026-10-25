"""Static force balance on a structure.

Sums the applied forces and moments about a chosen point and reports
whether the system is in equilibrium, with the residual that would
cause acceleration or rotation. The residual is the useful part: a
non-zero one says by how much the structure is out of balance.

Transferable: any force-equilibrium check (rigging, brackets, robots,
statics verification).
Originally forged by: physicist.adopt
"""
import math


def _vec(v, default=(0.0, 0.0)):
    if isinstance(v, dict):
        return (float(v.get("x", 0) or 0), float(v.get("y", 0) or 0))
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return (float(v[0]), float(v[1]))
    return default


def skill(organism, context):
    """Sum forces and moments and report the equilibrium residual."""
    forces = context.get("forces", [])
    if not isinstance(forces, list) or not forces:
        return {
            "action": "FORCE_BALANCE", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a non-empty list of forces"},
        }

    pivot = _vec(context.get("pivot", (0.0, 0.0)))
    # Optional third dimension (z) for 3D force balance.
    fx = fy = fz = 0.0
    torque = 0.0
    counted = 0
    details = []

    for i, f in enumerate(forces):
        if not isinstance(f, dict):
            continue
        try:
            x = float(f.get("x", f.get("position_x", 0)) or 0)
            y = float(f.get("y", f.get("position_y", 0)) or 0)
            z = float(f.get("z", f.get("position_z", 0)) or 0)
            mag = float(f.get("magnitude", f.get("force", f.get("value", 0))) or 0)
        except (TypeError, ValueError):
            continue
        angle = f.get("angle", f.get("direction"))
        if angle is None:
            fx += mag
        else:
            try:
                a = math.radians(float(angle))
                fx += mag * math.cos(a)
                fy += mag * math.sin(a)
            except (TypeError, ValueError):
                fx += mag
        fz += float(f.get("fz", f.get("force_z", 0)) or 0)
        # Moment about the pivot: r x F
        torque += (x - pivot[0]) * 0 + (x - pivot[0]) * 0  # placeholder, computed below
        counted += 1
        details.append({
            "index": i,
            "position": [x, y, z],
            "magnitude": mag,
            "angle": angle,
        })

    # Recompute the 2D moment correctly: M = r_x * F_y - r_y * F_x
    torque = 0.0
    for i, f in enumerate(forces):
        if not isinstance(f, dict):
            continue
        try:
            x = float(f.get("x", f.get("position_x", 0)) or 0)
            y = float(f.get("y", f.get("position_y", 0)) or 0)
            mag = float(f.get("magnitude", f.get("force", f.get("value", 0))) or 0)
            angle = f.get("angle", f.get("direction"))
        except (TypeError, ValueError):
            continue
        if angle is None:
            comp_x, comp_y = mag, 0.0
        else:
            try:
                a = math.radians(float(angle))
                comp_x, comp_y = mag * math.cos(a), mag * math.sin(a)
            except (TypeError, ValueError):
                comp_x, comp_y = mag, 0.0
        torque += (x - pivot[0]) * comp_y - (y - pivot[1]) * comp_x

    resultant = math.sqrt(fx ** 2 + fy ** 2 + fz ** 2)
    tolerance = float(context.get("tolerance", 1e-6) or 1e-6)
    balanced = resultant <= tolerance and abs(torque) <= tolerance

    return {
        "action": "FORCE_BALANCE",
        "intensity": round(min(1.0, resultant / (tolerance * 1000) if tolerance else 1.0), 3),
        "version": 1,
        "result": {
            "ok": balanced,
            "balanced": balanced,
            "resultant_force": round(resultant, 8),
            "sum_fx": round(fx, 8),
            "sum_fy": round(fy, 8),
            "sum_fz": round(fz, 8),
            "net_moment": round(torque, 8),
            "pivot": list(pivot),
            "forces_counted": counted,
            "tolerance": tolerance,
        },
    }
