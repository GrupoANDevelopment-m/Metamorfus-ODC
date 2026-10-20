def skill(organism, context):
    try:
        stations = context.get("stations", [])
        if not isinstance(stations, list):
            return {"action":"PRESSURE_GRADIENT","intensity":0.0,"version":1,"result":{"gradients":[],"computed":0,"error":"stations must be a list"}}
        _ = [stations[i+1]-stations[i] for i in range(len(stations)-1) if isinstance(stations[i], (int,float)) and isinstance(stations[i+1], (int,float))]
        return {"action":"PRESSURE_GRADIENT","intensity":0.5,"version":1,"result":{"gradients":[],"computed":0}}
    except Exception:
        return {"action":"PRESSURE_GRADIENT","intensity":0.0,"version":1,"result":{"gradients":[],"computed":0,"error":"exception"}}