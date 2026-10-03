"""Adapter for Archify — generate validated technical diagrams.

Wraps the Node CLI at /workspace/skill-pkgs/extracted/archify-main/archify-main/bin/archify.mjs.
"""
import json
import subprocess
import os
import shutil

DEFAULT_PATH = "/workspace/skill-pkgs/extracted/archify-main/archify-main/bin/archify.mjs"
BIN = os.environ.get("ARCHIFY_BIN") or (DEFAULT_PATH if os.path.exists(DEFAULT_PATH) else shutil.which("archify"))


def skill(organism, context):
    """Generate, validate, or guide an Archify diagram.
    context = {"action": "doctor" | "demo" | "guide" | "validate" | "preview" | "compare",
               "scenario": "...", "ir_file": "...", "output_dir": "...", "quality": "showcase"}
    """
    if not BIN:
        return {"error": "archify not found", "hint": f"node {DEFAULT_PATH}"}

    action = context.get("action", "doctor")
    args = ["node", BIN]

    if action == "doctor":
        args.append("doctor")
    elif action == "demo":
        args.append("demo")
        if "output_dir" in context:
            args.append(context["output_dir"])
    elif action == "guide":
        args.append("guide")
        args.append(context.get("scenario", "architecture"))
        if context.get("json"):
            args.append("--json")
    elif action == "validate":
        args.append("validate")
        args.append(context.get("ir_type", "architecture"))
        args.append(context.get("ir_file", ""))
        if context.get("quality"):
            args.extend(["--quality", context["quality"]])
        if context.get("json"):
            args.append("--json")
    elif action == "preview":
        args.append("preview")
        args.append(context.get("ir_type", "architecture"))
        args.append(context.get("ir_file", ""))
        args.append(context.get("output_dir", "/tmp/archify-output"))
        if context.get("quality"):
            args.extend(["--quality", context["quality"]])
    elif action == "compare":
        args.append("compare")
        args.append(context.get("ir_type", "architecture"))
        args.append(context.get("base", ""))
        args.append(context.get("head", ""))
        args.append(context.get("output_dir", "/tmp/archify-delta"))
        if context.get("json"):
            args.append("--json")
    else:
        return {"error": f"unknown action: {action}"}

    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=context.get("timeoutMs", 60_000) // 1000)
        return {
            "ok": proc.returncode == 0,
            "stdout": proc.stdout.strip()[:4000],
            "stderr": proc.stderr.strip()[:1000],
            "exitCode": proc.returncode,
            "action": action,
        }
    except subprocess.TimeoutExpired:
        return {"error": "archify timed out"}
    except Exception as e:
        return {"error": f"archify failed: {type(e).__name__}: {e}"}
