def skill(organism, context):
    """Form a falsifiable hypothesis from an observation.

    Transferable: any deductive profession can use this.
    Originally forged by: scientist.adopt
    """
    observation = context.get("observation", "")
    return {
        "action": "FORM_HYPOTHESIS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 25},
        "version": 1,
        "params": {"observation": observation, "falsifiable": True}
    }