"""Adapter for Playwright Python SDK — cross-browser automation.

Uses the official `playwright` Python package (sync API) for simplicity.
"""
import json


def skill(organism, context):
    """Run a Playwright action.
    context = {"action": "screenshot" | "extract_text" | "evaluate" | "open",
               "url": "...", "selector": "...", "code": "..."}
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {
            "error": "playwright not installed",
            "hint": "pip install playwright && playwright install chromium",
        }

    action = context.get("action", "screenshot")
    url = context.get("url", "")
    if not url:
        return {"error": "url is required"}

    browser_name = context.get("browser", "chromium")

    try:
        with sync_playwright() as p:
            browser = getattr(p, browser_name).launch(headless=context.get("headless", True))
            context_b = browser.new_context()
            page = context_b.new_page()
            page.goto(url, timeout=context.get("timeoutMs", 30_000))

            if action == "screenshot":
                path = context.get("path", "/tmp/playwright-shot.png")
                page.screenshot(path=path, full_page=context.get("full_page", False))
                result = {"screenshot": path}
            elif action == "extract_text":
                sel = context.get("selector", "body")
                text = page.locator(sel).inner_text(timeout=10_000) if sel != "body" else page.locator("body").inner_text()
                result = {"text": text[:5000]}
            elif action == "evaluate":
                js = context.get("code", "1+1")
                result = {"value": page.evaluate(js)}
            elif action == "title":
                result = {"title": page.title()}
            else:
                browser.close()
                return {"error": f"unknown action: {action}"}

            browser.close()
            return {"ok": True, "url": url, "action": action, **result}
    except Exception as e:
        return {"error": f"playwright failed: {type(e).__name__}: {e}"}
