def skill(organism, context):
    """Read sky, wind, pressure to predict weather.

    Transferable: anyone under the open sky (farmer, sailor, soldier).
    Originally forged by: lumberjack.adopt
    """
    return {
        "action": "READ_WEATHER",
        "intensity": 0.3,
        "required_attributes": {"cpu": 10},
        "version": 1
    }