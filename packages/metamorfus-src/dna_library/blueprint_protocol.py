def skill(organism, context):
    """Draft a blueprint from a brief.

    Transferable: any design profession (industrial designer, UX).
    Originally forged by: architect.adopt
    """
    brief = context.get("brief", "")
    return {
        "action": "DRAFT_BLUEPRINT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 50},
        "version": 1,
        "params": {"brief": brief}
    }