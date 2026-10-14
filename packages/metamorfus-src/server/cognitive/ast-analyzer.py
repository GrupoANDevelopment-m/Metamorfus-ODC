#!/usr/bin/env python3
"""AST-based signal type detection for Python skills.

Parses the skill's source code with ast (no execution), then
emits a structured JSON report of what signals the skill
computes. More robust than regex matching because it understands
Python's structure.

Signals detected:
  - IMPORTS: statistics, math, time, datetime, itertools
  - FUNCTION CALLS: statistics.mean, time.localtime, json.loads
  - DATA STRUCTURES: dict, set, list, default dict
  - CONTROL FLOW: for/while/if (used to infer detection strategies)
  - RETURN SHAPE: what the skill returns (flagged list, score, etc.)

Real-world refs:
  - Python ast: https://docs.python.org/3/library/ast.html
  - bandit: https://github.com/PyCQA/bandit (uses ast for security)
  - mypy: https://github.com/python/mypy (uses ast for types)
"""
import ast
import json
import sys
import os
import re
from collections import Counter


# Map ast nodes / import names to signal types
IMPORT_SIGNALS = {
    "statistics": "statistical",
    "math": "statistical",
    "statistics.mean": "statistical",
    "statistics.median": "statistical",
    "statistics.stdev": "statistical",
    "time": "temporal",
    "datetime": "temporal",
    "calendar": "temporal",
    "collections": "graph",
    "collections.Counter": "categorical",
    "collections.defaultdict": "graph",
    "itertools": "pattern",
    "re": "pattern",
    "json": "graph",
    "hashlib": "pattern",
}

RETURN_SHAPE_SIGNALS = {
    "flagged": "anomaly",
    "flagged_count": "anomaly",
    "anomaly_score": "anomaly",
    "outliers": "anomaly",
    "anomalies": "anomaly",
    "rsi": "statistical",
    "mean": "statistical",
    "stdev": "statistical",
    "variance": "statistical",
    "percentile": "statistical",
    "gradients": "magnitude",
    "magnitude": "magnitude",
    "score": "anomaly",
    "hubs": "graph",
    "nodes": "graph",
    "edges": "graph",
    "merchant": "categorical",
    "category": "categorical",
    "hour": "temporal",
    "timestamp": "temporal",
    "sequence": "temporal",
    "trend": "temporal",
    "pattern": "pattern",
    "match": "pattern",
    "regex": "pattern",
}


def analyze_source(path: str) -> dict:
    if not os.path.isfile(path):
        return {"error": f"file not found: {path}", "signal_types": []}
    try:
        with open(path, "r") as f:
            src = f.read()
    except Exception as e:
        return {"error": str(e), "signal_types": []}

    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return {"error": f"parse error: {e}", "signal_types": []}

    signals = Counter()
    details = {
        "imports": [],
        "function_calls": [],
        "control_flow": {"for": 0, "while": 0, "if": 0, "try": 0},
        "return_keys": [],
    }

    for node in ast.walk(tree):
        # 1. Imports
        if isinstance(node, ast.Import):
            for alias in node.names:
                details["imports"].append(alias.name)
                # Check full name (e.g., "statistics" or "statistics.mean")
                top = alias.name.split(".")[0]
                if alias.name in IMPORT_SIGNALS:
                    signals[IMPORT_SIGNALS[alias.name]] += 1
                elif top in IMPORT_SIGNALS:
                    signals[IMPORT_SIGNALS[top]] += 1
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                full = f"{node.module or ''}.{alias.name}" if node.module else alias.name
                details["imports"].append(full)
                if full in IMPORT_SIGNALS:
                    signals[IMPORT_SIGNALS[full]] += 1
                elif alias.name in IMPORT_SIGNALS:
                    signals[IMPORT_SIGNALS[alias.name]] += 1

        # 2. Function calls
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name):
                    full = f"{node.func.value.id}.{node.func.attr}"
                    details["function_calls"].append(full)
                    if full in IMPORT_SIGNALS:
                        signals[IMPORT_SIGNALS[full]] += 1
            elif isinstance(node.func, ast.Name):
                details["function_calls"].append(node.func.id)

        # 3. Control flow
        elif isinstance(node, ast.For):
            details["control_flow"]["for"] += 1
        elif isinstance(node, ast.While):
            details["control_flow"]["while"] += 1
        elif isinstance(node, ast.If):
            details["control_flow"]["if"] += 1
        elif isinstance(node, ast.Try):
            details["control_flow"]["try"] += 1

        # 4. Return values — extract dict keys
        elif isinstance(node, ast.Return):
            if isinstance(node.value, ast.Dict):
                for key in node.value.keys:
                    if isinstance(key, ast.Constant) and isinstance(key.value, str):
                        details["return_keys"].append(key.value)
                        if key.value in RETURN_SHAPE_SIGNALS:
                            signals[RETURN_SHAPE_SIGNALS[key.value]] += 2  # weight return shape higher

    # Heuristic boost: if many if-statements and categorical names, it's probably a rule-based detector
    if details["control_flow"]["if"] >= 3:
        signals["pattern"] += 1
    if details["control_flow"]["for"] >= 2 and "flagged" in details["return_keys"]:
        signals["anomaly"] += 1
    if any(k in details["return_keys"] for k in ["rsi", "stdev", "mean", "variance"]):
        signals["statistical"] += 1

    return {
        "path": path,
        "signal_types": sorted(signals.keys()),
        "signal_counts": dict(signals),
        "details": details,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: ast-analyzer.py <skill.py> [<skill.py> ...]"}))
        sys.exit(1)
    results = [analyze_source(p) for p in sys.argv[1:]]
    print(json.dumps(results, indent=2))