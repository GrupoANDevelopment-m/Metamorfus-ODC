"""Adapter for Agent-Reach — read/search 13 internet platforms.

Uses the agent_reach library if importable; otherwise returns a clear
install hint. Each channel (twitter, reddit, youtube, github, etc.)
has can_handle/read/search methods.
"""
import json


def skill(organism, context):
    """Read or search a URL through Agent-Reach.
    context = {"url": "https://twitter.com/..." | "https://reddit.com/r/..." | "...",
               "query": "...", "platform": "twitter|reddit|youtube|github|..."}
    """
    try:
        import agent_reach  # type: ignore
    except ImportError:
        return {
            "error": "agent_reach not installed",
            "hint": "pip install -e /workspace/skill-pkgs/extracted/Agent-Reach-main/Agent-Reach-main",
        }

    url = context.get("url", "")
    query = context.get("query", "")
    platform = context.get("platform")

    try:
        # The agent_reach library exposes a router that picks the right
        # channel for a URL or query.
        if hasattr(agent_reach, "read"):
            if url:
                content = agent_reach.read(url)
                return {"ok": True, "url": url, "platform": platform, "content": str(content)[:5000]}
            if query:
                results = agent_reach.search(query, platform=platform)
                return {"ok": True, "query": query, "platform": platform, "results": str(results)[:5000]}
            return {"error": "either url or query is required"}
        return {"error": "agent_reach module missing read/search entrypoints (version mismatch)"}
    except Exception as e:
        return {"error": f"agent_reach failed: {type(e).__name__}: {e}"}
