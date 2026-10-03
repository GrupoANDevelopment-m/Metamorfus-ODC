"""Adapter for browser-harness — real CDP browser control via subprocess.

The browser-harness CLI accepts heredoc-style Python via `browser-harness <<'PY'`.
This adapter wraps that protocol so the organism can invoke it with a
JSON context (action + url).
"""
import json
import subprocess
import os
import shutil
import sys

BIN = os.environ.get("BROWSER_HARNESS_BIN") or shutil.which("browser-harness")


def skill(organism, context):
    """Run a browser-harness command and return the result.
    context = {"action": "info" | "navigate" | "snapshot" | "screenshot" | "evaluate" | "click",
               "url": "...", "code": "...", "selector": "...", "text": "..."}
    """
    if not BIN:
        return {"error": "browser-harness not installed. See skill hints.", "hint": "pip install -e /workspace/skill-pkgs/extracted/browser-harness-main/browser-harness-main"}

    action = context.get("action", "info")
    code_lines = []

    if action == "info":
        code_lines.append("print(page_info())")
    elif action == "navigate" or action == "open":
        url = context.get("url", "")
        code_lines.append(f"new_tab({json.dumps(url)})")
    elif action == "snapshot":
        code_lines.append("print(snapshot())")
    elif action == "screenshot":
        target = context.get("path", "/tmp/metamorfus-screenshot.png")
        code_lines.append(f"screenshot({json.dumps(target)})")
        code_lines.append(f"print({json.dumps(target)})")
    elif action == "evaluate":
        code_lines.append(context.get("code", "print('nothing to evaluate')"))
    elif action == "click":
        sel = context.get("selector", "")
        code_lines.append(f"click({json.dumps(sel)})")
    elif action == "type":
        sel = context.get("selector", "")
        text = context.get("text", "")
        code_lines.append(f"type_text({json.dumps(sel)}, {json.dumps(text)})")
    else:
        return {"error": f"unknown action: {action}"}

    code = "\n".join(code_lines)
    try:
        proc = subprocess.run(
            [BIN],
            input=code,
            capture_output=True,
            text=True,
            timeout=context.get("timeoutMs", 30_000) // 1000,
        )
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout.strip()[:4000],
            "stderr": proc.stderr.strip()[:1000],
            "exitCode": proc.returncode,
            "action": action,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"browser-harness timed out after {context.get('timeoutMs', 30000)}ms"}
    except Exception as e:
        return {"error": f"browser-harness failed: {type(e).__name__}: {e}"}
