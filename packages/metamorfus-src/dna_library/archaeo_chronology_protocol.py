"""Chronology — dates, periods and the consistency of a timeline.

Normalises dates in several formats, orders them, groups them into
periods, and checks for temporal impossibilities: an object dated
before the context that contains it, a deposit that post-dates what it
is supposed to underlie.

Transferable: any timeline validation over recorded dates (audit logs,
incident timelines, supply-chain lead times).
Originally forged by: archaeologist.adopt
"""
import re

# Radiocarbon era boundaries (years before present) for coarse periods.
PERIODS = [
    (0, 3000, "Holocene"),
    (3000, 5000, "Mesolithic"),
    (5000, 10000, "Neolithic"),
    (10000, 40000, "Upper Palaeolithic"),
]

# Calendar conversions for calibrated ranges: (year, +/- uncertainty).
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _parse_date(value):
    """Return (year, uncertainty, raw) for a range of date formats."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return (float(value), 0.0, str(value))
    s = str(value).strip()
    if not s:
        return None

    # "1200-1500 AD"
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(bce?|bc|ad|ce)?$", s, re.I)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        era = (m.group(3) or "").lower()
        if era.startswith("b"):
            a, b = -a, -b
        return ((a + b) / 2.0, abs(b - a) / 2.0, s)

    # "1500 BP" / "1500 b.p."
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*bp\b", s, re.I)
    if m:
        y = -float(m.group(1))
        return (y, 0.0, s)

    # "1500 BC"
    m = re.match(r"^(-?\d+(?:\.\d+)?)\s*(bce?|bc)\b", s, re.I)
    if m:
        y = -float(m.group(1))
        return (y, 0.0, s)

    # "12 Mar 1500" / "Mar 1500" / "1500"
    m = re.match(r"^(\d{1,2})\s+([a-z]{3})[a-z]*\s+(-?\d+)$", s, re.I)
    if m:
        return (float(m.group(3)), 0.0, s)
    m = re.match(r"^([a-z]{3})[a-z]*\s+(-?\d+)$", s, re.I)
    if m:
        return (float(m.group(2)), 0.0, s)
    m = re.match(r"^(-?\d{1,4})$", s)
    if m:
        return (float(m.group(1)), 0.0, s)

    return None


def _period(year):
    for lo, hi, name in PERIODS:
        if lo <= abs(year) < hi:
            return name
    return "unclassified"


def skill(organism, context):
    """Build and validate a chronology from dated contexts."""
    items = context.get("items", context.get("contexts", []))
    if isinstance(items, dict):
        items = [{"id": k, **v} for k, v in items.items()]
    if not isinstance(items, list) or not items:
        return {
            "action": "CHRONOLOGY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a list of dated items"},
        }

    dated = []
    undated = []
    for it in items:
        if not isinstance(it, dict):
            continue
        raw = it.get("date", it.get("year", it.get("dated")))
        parsed = _parse_date(raw)
        rec = {
            "id": str(it.get("id", it.get("context", f"item{len(dated)}"))),
            "raw_date": raw,
            "contains": [str(x) for x in (it.get("contains", it.get("above", [])) or [])],
            "within": [str(x) for x in (it.get("within", it.get("below", [])) or [])],
            "material": it.get("material", ""),
        }
        if parsed is None:
            undated.append(rec)
        else:
            rec.update({"year": parsed[0], "uncertainty": parsed[1], "period": _period(parsed[0])})
            dated.append(rec)

    if not dated:
        return {
            "action": "CHRONOLOGY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no parsable dates found", "undated": undated},
        }

    dated.sort(key=lambda r: r["year"])
    by_id = {r["id"]: r for r in dated}
    problems = []

    # An object dated earlier than the context holding it is a problem.
    for rec in dated:
        for child in rec["contains"]:
            if child not in by_id:
                continue
            c = by_id[child]
            if c["year"] > rec["year"] + rec["uncertainty"] + c["uncertainty"]:
                problems.append({
                    "type": "object_predates_container",
                    "detail": f"{child} is dated {c['year']:g} but sits in {rec['id']} dated {rec['year']:g}",
                    "context": rec["id"], "object": child,
                })

    # A context cannot be later than the context it is within.
    for rec in dated:
        for parent in rec["within"]:
            if parent not in by_id:
                continue
            p = by_id[parent]
            if rec["year"] < p["year"] - rec["uncertainty"] - p["uncertainty"]:
                problems.append({
                    "type": "context_predates_its_container",
                    "detail": f"{rec['id']} ({rec['year']:g}) is older than {parent} ({p['year']:g}) it should be inside",
                    "context": rec["id"], "container": parent,
                })

    by_period = {}
    for r in dated:
        by_period.setdefault(r["period"], []).append(r["id"])

    span = dated[-1]["year"] - dated[0]["year"]
    # Dating precision: how tight the errors are relative to the span.
    avg_unc = sum(r["uncertainty"] for r in dated) / len(dated)
    precision = round(max(0.0, 1.0 - (avg_unc / span if span else 1.0)), 3)

    return {
        "action": "CHRONOLOGY",
        "intensity": round(min(1.0, len(problems) / max(1, len(dated))), 3),
        "version": 1,
        "result": {
            "ok": not problems,
            "dated": len(dated),
            "undated": len(undated),
            "timeline": [{"id": r["id"], "year": r["year"], "period": r["period"],
                          "uncertainty": r["uncertainty"], "raw": r["raw_date"]} for r in dated],
            "span_years": round(span, 2),
            "periods": by_period,
            "problems": problems,
            "precision": precision,
            "undated_items": undated,
        },
    }
