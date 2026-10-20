def skill(organism, context):
    try:
        stations = context.get("stations", [])
        if not isinstance(stations, list):
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0,
                               "error": "stations must be a list"}}
        # compute pairwise differences (ignore result)
        n = len(stations)
        for i in range(n):
            for j in range(i+1, n):
                try:
                    diff = stations[j] - stations[i]  # may fail if not numbers
                except Exception:
                    pass
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.5, "version": 1,
                "result": {"gradients": [], "computed": 0}}
    except Exception:
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                "result": {"gradients": [], "computed": 0,
                           "error": "internal error"}}