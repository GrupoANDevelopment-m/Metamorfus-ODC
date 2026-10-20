def skill(organism, context):
    """Compute load-bearing requirements.

    NOT transferable outside building contexts.
    Originally forged by: architect.adopt
    """
    span = context.get("span_meters", 0)
    return {
        "action": "STRUCTURAL_ANALYSIS",
        "intensity": 0.8,
        "required_attributes": {"cpu": 60},
        "version": 1,
        "params": {"span_meters": span}
    }