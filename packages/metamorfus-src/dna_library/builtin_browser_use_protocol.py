"""Adapter for browser-use Python library — high-level AI browser agent.

If the `browser_use` package is importable, use its async Agent API.
Otherwise return a clear error pointing to the install command.
"""
import json
import asyncio


def skill(organism, context):
    """Run a browser-use task.
    context = {"task": "Find the price of NVIDIA H100 on nvidia.com and summarize",
               "url": "https://nvidia.com"}
    Returns {"task": ..., "result": ..., "ok": bool}
    """
    task = context.get("task") or context.get("instruction") or ""
    if not task:
        return {"error": "task is required"}

    try:
        from browser_use import Agent  # type: ignore
    except ImportError:
        return {
            "error": "browser_use Python package not installed",
            "hint": "pip install -e /workspace/skill-pkgs/extracted/browser-use-main/browser-use-main",
        }

    url = context.get("url")

    async def run():
        try:
            agent = Agent(task=task)
            result = await agent.run()
            return {"ok": True, "task": task, "url": url, "result": str(result)[:4000]}
        except Exception as e:
            return {"ok": False, "task": task, "error": f"{type(e).__name__}: {e}"}

    try:
        return asyncio.run(run())
    except RuntimeError as e:
        # If we're already inside an event loop, fall back to a sync wrapper.
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(run())
        finally:
            loop.close()
