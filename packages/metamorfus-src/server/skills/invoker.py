#!/usr/bin/env python3
"""Skill invoker — invoked by server/skills/runner.mjs.

Reads context from METAMORFUS_CONTEXT_FILE (path to a JSON file)
or METAMORFUS_CONTEXT env var (JSON-encoded). The file approach
is used for large contexts (>~100KB) because the OS env var
size limit (ARG_MAX) is ~128KB on Linux — passing 1000+ txs
as JSON would hit E2BIG.

Imports the skill module from argv[1], calls skill(organism={},
context=parsed_ctx), and prints the result with the
__METAMORFUS_RESULT__ prefix expected by Node.js runner.

If the skill raises, prints a structured error instead of crashing
silently with exit 0.
"""
import json
import os
import sys
import traceback

PREFIX = "__METAMORFUS_RESULT__"

# Size threshold (bytes) — env vars can hold about 128KB on Linux.
# Above this we use a file to avoid E2BIG.
ENV_LIMIT = 65536  # 64KB to be safe


def main():
    if len(sys.argv) < 2:
        print(PREFIX + json.dumps({"error": "invoker: skill path required as argv[1]"}))
        sys.exit(1)
    skill_path = sys.argv[1]

    # Prefer file (handles large contexts); fall back to env var
    ctx_file = os.environ.get("METAMORFUS_CONTEXT_FILE")
    if ctx_file and os.path.isfile(ctx_file):
        try:
            with open(ctx_file, "r") as f:
                raw_ctx = f.read()
        except Exception as e:
            print(PREFIX + json.dumps({"error": f"invoker: cannot read context file: {e}"}))
            sys.exit(1)
    else:
        raw_ctx = os.environ.get("METAMORFUS_CONTEXT", "{}")

    try:
        context = json.loads(raw_ctx)
    except json.JSONDecodeError as e:
        print(PREFIX + json.dumps({"error": f"invoker: bad context JSON: {e}"}))
        sys.exit(1)

    if not isinstance(context, dict):
        print(PREFIX + json.dumps({"error": f"invoker: context must be dict, got {type(context).__name__}"}))
        sys.exit(1)

    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("skill_module", skill_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except Exception as e:
        print(PREFIX + json.dumps({
            "error": f"invoker: failed to load skill module: {e}",
            "traceback": traceback.format_exc(),
        }))
        sys.exit(1)

    if not hasattr(module, "skill"):
        print(PREFIX + json.dumps({"error": "invoker: module has no `skill` function"}))
        sys.exit(1)

    try:
        result = module.skill({}, context)
        print(PREFIX + json.dumps(result, default=str))
        sys.exit(0)
    except Exception as e:
        print(PREFIX + json.dumps({
            "error": f"invoker: skill raised: {e}",
            "traceback": traceback.format_exc(),
        }))
        sys.exit(0)  # exit 0 but include error in JSON so Node can see it


if __name__ == "__main__":
    main()