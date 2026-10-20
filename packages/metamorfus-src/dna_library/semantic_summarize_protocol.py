def skill(organism, context):
    """Summarize text via simple truncation."""
    text = context.get("text", "")
    return {"action": "SEMANTIC_SUMMARIZE", "intensity": 0.4, "version": 1, "params": {"chars": len(text)}}