"""Wave analysis — superposition, energy and shoaling.

Adds waves by superposition with phase, computes the resulting energy
flux, and applies shoaling (wave height growth as depth decreases) for
a given seabed slope. Handles the shallow-water limit where linear
theory stops applying.

Transferable: any superposition of periodic signals (acoustics, EMI,
structural vibration, population cycles).
Originally forged by: physicist.adopt
"""
import math


def _wave(context, key, default_depth=None):
    w = context.get(key, {}) or {}
    try:
        height = float(w.get("height", w.get("amplitude", 0)) or 0)
        period = float(w.get("period", 0) or 0)
    except (TypeError, ValueError):
        return None
    phase = float(w.get("phase", 0) or 0)
    depth = w.get("depth", default_depth)
    try:
        depth = float(depth) if depth is not None else None
    except (TypeError, ValueError):
        depth = None
    return {"height": height, "period": period, "phase": phase, "depth": depth}


def skill(organism, context):
    """Superpose waves and estimate energy flux and shoaling."""
    waves = []
    for key in ("wave1", "wave2", "wave3", "wave"):
        w = _wave(context, key, context.get("depth"))
        if w and w["period"] > 0:
            waves.append(w)
    if not waves:
        return {
            "action": "WAVE_ANALYSIS", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need wave1 with a positive period"},
        }

    g = float(context.get("g", 9.81) or 9.81)
    rho = float(context.get("density", 1025) or 1025)  # seawater, kg/m^3

    # Superposition at x = 0 (the reference point).
    total_height = 0.0
    total_slope = 0.0
    components = []
    energy = 0.0
    for w in waves:
        omega = 2 * math.pi / w["period"]
        k = omega ** 2 / g  # deep-water wavenumber
        amp = w["height"] / 2.0
        total_height += amp * math.cos(w["phase"])
        total_slope += amp * k * math.sin(w["phase"])
        # Deep-water energy flux per unit crest width, E = rho g^2 H^2 / (8 w)
        flux = rho * g ** 2 * w["height"] ** 2 / (8 * w["period"])
        energy += flux
        components.append({
            "period": w["period"], "height": w["height"],
            "phase": w["phase"], "wavenumber": round(k, 6),
            "energy_flux_w_m": round(flux, 2),
        })

    # Shoaling: as depth drops, wave height grows.
    shoaling = None
    depth = context.get("depth")
    if depth:
        try:
            d = float(depth)
            if d > 0:
                longest = max(waves, key=lambda w: w["period"])
                T = longest["period"]
                # Deep-water wavelength, then the shoaling coefficient
                # for a horizontal bed: Ks = (Cg_deep / Cg)^0.5
                L0 = g * T ** 2 / (2 * math.pi)
                L = L0 * math.tanh(2 * math.pi * d / L0) ** 0.5 if L0 else L0
                cg_deep = g * T / (4 * math.pi)
                cg = (g / (2 * omega_shallow)) if False else cg_deep
                # Use the full linear-theory group velocity at the given depth.
                omega = 2 * math.pi / T
                kh = omega ** 2 * d / g
                if kh > 0:
                    n = 0.5 * (1 + 2 * kh ** 2 / math.sinh(2 * kh)) if kh > 0.01 else 0.5
                    cg_shallow = cg_deep * n
                    Ks = math.sqrt(cg_deep / cg_shallow) if cg_shallow > 0 else 1.0
                    shoaling = {
                        "depth_m": d,
                        "coeff_ks": round(Ks, 4),
                        "shoaled_height": round(longest["height"] * Ks, 4),
                        "wavelength_m": round(L, 3),
                        "kh": round(kh, 4),
                        "shallow_water": kh < 0.01,
                    }
        except (TypeError, ValueError, ZeroDivisionError):
            shoaling = None

    result_height = abs(total_height) * 2.0
    # Constructive interference: the result is meaningfully larger than
    # the largest input.
    largest = max(w["height"] for w in waves)
    constructive = result_height > largest * 1.05

    return {
        "action": "WAVE_ANALYSIS",
        "intensity": round(min(1.0, result_height / (largest * 3 or 1)), 3),
        "version": 1,
        "result": {
            "ok": True,
            "resulting_height": round(result_height, 4),
            "largest_input": largest,
            "constructive": constructive,
            "total_energy_flux_w_m": round(energy, 2),
            "components": components,
            "shoaling": shoaling,
        },
    }
