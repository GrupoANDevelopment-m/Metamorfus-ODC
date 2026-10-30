def skill(organism, context):
    """Compute the steepest local pressure gradients from station data with robust error handling."""
    import math
    try:
        stations = context.get("stations", [])
        top_n = int(context.get("top_n", 3))
        
        if not isinstance(stations, list):
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0, "error": "stations must be a list"}}
        
        if not stations:
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0}}
        
        valid_stations = []
        for s in stations:
            if not isinstance(s, dict):
                continue
            required_keys = ["lat", "lon", "station_id", "pressure_hpa"]
            if all(k in s for k in required_keys):
                try:
                    float(s["lat"])
                    float(s["lon"])
                    float(s["pressure_hpa"])
                    valid_stations.append(s)
                except (ValueError, TypeError):
                    continue
        
        if not valid_stations:
            return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                    "result": {"gradients": [], "computed": 0, "error": "no valid station data"}}
        
        grid = {}
        for s in valid_stations:
            lat0 = round(float(s["lat"]), 2)
            lon0 = round(float(s["lon"]), 2)
            grid[(lat0, lon0)] = s
        
        out = []
        for s in valid_stations:
            lat0 = round(float(s["lat"]), 2)
            lon0 = round(float(s["lon"]), 2)
            east_key = (lat0, round(lon0 + 1, 2))
            east = grid.get(east_key)
            if east is None or east.get("station_id") == s.get("station_id"):
                continue
            try:
                dist_km = 111.32 * max(0.1, math.cos(math.radians(lat0)))
                dp = float(east["pressure_hpa"]) - float(s["pressure_hpa"])
                mag = abs(dp) / dist_km
                out.append({"station_id": s["station_id"],
                            "neighbor_id": east["station_id"],
                            "magnitude_hpa_per_100km": round(mag * 100, 4)})
            except (ValueError, TypeError, KeyError):
                continue
        
        out.sort(key=lambda r: -r["magnitude_hpa_per_100km"])
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.7, "version": 1,
                "result": {"gradients": out[:top_n], "computed": len(out)}}
    except Exception as e:
        return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1,
                "result": {"gradients": [], "computed": 0, "error": str(e)}}