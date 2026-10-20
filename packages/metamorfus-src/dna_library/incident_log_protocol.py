def skill(organism, context):
    """Registra incidente em arquivo JSON."""
    import json, time
    event = context.get("event", {})
    return {"action": "INCIDENT_LOGGED", "intensity": 0.2, "version": 1, "params": {"ts": time.time(), "event": event}}