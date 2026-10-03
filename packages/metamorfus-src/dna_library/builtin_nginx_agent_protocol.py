"""Adapter for nginx-agent-skills — knowledge base for Nginx/OpenResty/Lua.

This skill doesn't run any tool. It reads the bundled reference docs and
returns the relevant sections. Real offline knowledge — no network needed.
"""
import json
import os
import re

DOCS_DIR = "/workspace/skill-pkgs/extracted/nginx-agent-skills-main/nginx-agent-skills-main/references"

# Pre-canned answers from references/ when a clear match exists.
PATTERNS = [
    (re.compile(r"\bgotchas?\b|inheri(tance|t)|directive", re.I), "nginx-gotchas.md"),
    (re.compile(r"\bopenresty\b|\blua\b|cosocket|ngx\.|shared\s*dict", re.I), "openresty-api.md"),
    (re.compile(r"\b(benchmark|test|ab|wrk)\b|performance", re.I), "testing-patterns.md"),
]


def _read_doc(name):
    path = os.path.join(DOCS_DIR, name)
    if not os.path.exists(path):
        return f"(reference file {name} not found)"
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def skill(organism, context):
    """Answer a question about Nginx/OpenResty by reading the right reference doc.
    context = {"question": "What does proxy_pass trailing slash do?"}
    """
    question = context.get("question") or context.get("query") or ""
    if not question:
        # No question — list available references.
        if os.path.isdir(DOCS_DIR):
            return {"ok": True, "available_references": sorted(os.listdir(DOCS_DIR))}
        return {"error": f"references dir not found at {DOCS_DIR}"}

    chosen = None
    for pattern, filename in PATTERNS:
        if pattern.search(question):
            chosen = filename
            break
    if chosen is None:
        # Default to gotchas — covers the most common questions.
        chosen = "nginx-gotchas.md"

    body = _read_doc(chosen)
    # Return up to ~3000 chars — enough for a useful excerpt.
    return {
        "ok": True,
        "question": question,
        "reference": chosen,
        "excerpt": body[:3000],
        "char_count": len(body),
    }
