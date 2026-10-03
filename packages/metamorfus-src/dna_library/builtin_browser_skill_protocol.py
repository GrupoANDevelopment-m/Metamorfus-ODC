"""Adapter for bsk (BrowserSkill Rust CLI) — drive the user's real browser.

Wraps the bsk CLI which talks to the browser-skill extension. Subprocess
heredoc-style invocation is the official entry point per SKILL.md.
"""
import json
import subprocess
import shutil
import os
import time

BIN = os.environ.get("BSK_BIN") or shutil.which("bsk")


def skill(organism, context):
    """Run a bsk command.
    context = {"action": "session_start" | "session_end" | "snapshot" | "get_html" | "screenshot" | "evaluate" | "tab_borrow" | "tab_return" | "doctor",
               "session_id": "abcd", "url": "...", "code": "...", "selector": "...", "tab_id": "..."}
    """
    if not BIN:
        return {
            "error": "bsk CLI not installed",
            "hint": "cargo install --path /workspace/skill-pkgs/extracted/BrowserSkill-main/BrowserSkill-main/apps/bsk-cli",
        }

    action = context.get("action", "session_start")
    args = [BIN]
    if action == "session_start":
        args.append("session")
        args.append("start")
    elif action == "session_end":
        args.extend(["session", "end", context.get("session_id", "")])
    elif action == "snapshot":
        args.append("snapshot")
    elif action == "get_html":
        args.append("get-html")
    elif action == "screenshot":
        args.append("screenshot")
    elif action == "evaluate":
        args.append("evaluate")
        if "code" in context:
            args.append(context["code"])
    elif action == "tab_borrow":
        args.extend(["tab", "borrow", context.get("tab_id", "")])
    elif action == "tab_return":
        args.extend(["tab", "return"])
    elif action == "doctor":
        args.append("doctor")
    else:
        return {"error": f"unknown action: {action}"}

    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=context.get("timeoutMs", 30_000) // 1000)
        out = proc.stdout.strip()
        # session_start prints a 4-letter session id on stdout
        if action == "session_start" and len(out) >= 4:
            return {"ok": True, "session_id": out[:4], "raw": out[:500]}
        return {
            "ok": proc.returncode == 0,
            "stdout": out[:4000],
            "stderr": proc.stderr.strip()[:1000],
            "exitCode": proc.returncode,
            "action": action,
        }
    except subprocess.TimeoutExpired:
        return {"error": f"bsk timed out after {context.get('timeoutMs', 30000)}ms"}
    except Exception as e:
        return {"error": f"bsk failed: {type(e).__name__}: {e}"}
