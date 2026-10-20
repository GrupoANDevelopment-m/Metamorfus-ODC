def skill(organism, context):
    """Extract text from a PDF path."""
    p = context.get("path", "")
    return {"action": "PDF_EXTRACT", "intensity": 0.5, "version": 1, "params": {"path": p}}