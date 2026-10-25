def skill(organism, context):
    """Compute the steepest local pressure gradients from station data with robust input validation."""
    import math
    try:
        stations = context.get("stations", [])
        top_n = int(context.get("top_n", 3))
        if not stations:
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0}}
        
        # Validate and filter stations - handle case where station might be a string
        valid_stations = []
        for s in stations:
            if not isinstance(s, dict):
                continue
            required_keys = {"lat", "lon", "station_id", "pressure_hpa"}
            if not all(k in s for k in required_keys):
                continue
            try:
                float(s["lat"])
                float(s["lon"])
                float(s["pressure_hpa"])
            except (ValueError, TypeError):
                continue
            valid_stations.append(s)
        
        if not valid_stations:
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0, "error": "no valid station data"}}
        
        grid = {(round(s["lat"], 2), round(s["lon"], 2)): s for s in valid_stations}
        out = []
        for s in valid_stations:
            lat0, lon0 = round(s["lat"], 2), round(s["lon"], 2)
            east = grid.get((lat0, round(lon0 + 1, 2)))
            if east is None or east["station_id"] == s["station_id"]:
                continue
            dist_km = 111.32 * max(0.1, math.cos(math.radians(lat0)))
            dp = east["pressure_hpa"] - s["pressure_hpa"]
            mag = abs(dp) / dist_km
            out.append({"station_id": s["station_id"],
                        "neighbor_id": east["station_id"],
                        "magnitude_hpa_per_100km": round(mag * 100, 4)})
        out.sort(key=lambda r: -r["magnitude_hpa_per_100km"])
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.7, "version": 1,
                "result": {"gradients": out[:top_n], "computed": len(out)}}
    except Exception as e:
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                "result": {"gradients": [], "computed": 0, "error": str(e)}}