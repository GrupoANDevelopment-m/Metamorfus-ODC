def skill(organism, context):
    """Chop down a tree. Pure physical action.

    NOT transferable outside forest-work contexts.
    Originally forged by: lumberjack.adopt
    """
    tree_id = context.get("tree_id", "")
    return {
        "action": "FELL_TREE",
        "intensity": 0.9,
        "required_attributes": {"strength": 60, "agility": 20},
        "version": 1,
        "params": {"tree_id": tree_id}
    }