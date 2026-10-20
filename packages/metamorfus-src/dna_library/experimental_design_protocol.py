def skill(organism, context):
    """Design an experiment to test a hypothesis.

    Transferable: any profession that needs controlled comparison.
    Originally forged by: scientist.adopt
    """
    hypothesis = context.get("hypothesis", "")
    return {
        "action": "DESIGN_EXPERIMENT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"hypothesis": hypothesis, "controls": True}
    }