def skill(organism, context):
    """Maintain the edge. Tool care.

    NOT transferable outside tool-using contexts.
    Originally forged by: lumberjack.adopt
    """
    return {
        "action": "SHARPEN_AXE",
        "intensity": 0.4,
        "required_attributes": {"strength": 10},
        "version": 1
    }