def skill(organism, context):
    """Pick materials from a constraint set.

    NOT transferable outside material-handling contexts.
    Originally forged by: architect.adopt
    """
    constraints = context.get("constraints", {})
    return {
        "action": "SELECT_MATERIALS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"constraints": constraints}
    }