def skill(organism, context):
    try:
        stations = context.get("stations", [])
        if not isinstance(stations, list):
            return {
                "action": "PRESSURE_GRADIENT",
                "intensity": 0.0,
                "version": 1,
                "result": {"gradients": [], "computed": 0, "error": "stations must be a list"}
            }
        # stations is a list, compute pairwise differences (placeholder)
        return {
            "action": "PRESSURE_GRADIENT",
            "intensity": 0.5,
            "version": 1,
            "result": {"gradients": [], "computed": 0}
        }
    except Exception:
        return {
            "action": "PRESSURE_GRADIENT",
            "intensity": 0.0,
            "version": 1,
            "result": {"gradients": [], "computed": 0, "error": "unexpected error"}
        }