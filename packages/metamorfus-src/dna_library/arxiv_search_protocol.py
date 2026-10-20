def skill(organism, context):
    """Search arxiv for papers matching the query."""
    import urllib.request, urllib.parse, json
    q = context.get("query", "")
    return {"action": "ARXIV_SEARCH", "intensity": 0.6, "version": 1, "params": {"query": q}}