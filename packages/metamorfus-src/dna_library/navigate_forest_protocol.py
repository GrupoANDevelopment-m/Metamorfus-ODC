def skill(organism, context):
    """Read trails, find bearings, return home.

    Transferable: any outdoor profession (surveyor, ranger, hiker).
    Originally forged by: lumberjack.adopt
    """
    destination = context.get("destination", "")
    return {
        "action": "NAVIGATE_FOREST",
        "intensity": 0.5,
        "required_attributes": {"agility": 30},
        "version": 1,
        "params": {"destination": destination}
    }