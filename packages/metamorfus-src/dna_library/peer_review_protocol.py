def skill(organism, context):
    """Review a colleague's claim for rigor.

    NOT transferable: peer review is a social artifact of academic
    science. A lumberjack doesn't peer-review trees.
    Originally forged by: scientist.adopt
    """
    claim = context.get("claim", "")
    return {
        "action": "PEER_REVIEW",
        "intensity": 0.5,
        "required_attributes": {"cpu": 30},
        "version": 1,
        "params": {"claim": claim}
    }