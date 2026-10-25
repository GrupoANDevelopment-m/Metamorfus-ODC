"""Archaeological stratigraphy — sequence, superposition and phasing.

Orders archaeological contexts by their recorded stratigraphic
relationships (above/below, fills, cuts), detects the contradictions
that indicate a recording error, and computes a Harris matrix of the
accepted order.

Transferable: any dependency ordering over recorded observations with
conflict detection (build dependency graphs, ETL lineage, incident
timeline reconstruction).
Originally forged by: archaeologist.adopt
"""
import re


def _contexts(context):
    raw = context.get("contexts", context.get("units", []))
    if isinstance(raw, dict):
        raw = [{"id": k, **v} for k, v in raw.items()]
    if not isinstance(raw, list):
        return []
    out = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        cid = c.get("id", c.get("context"))
        if cid is None:
            continue
        out.append({
            "id": str(cid),
            "type": str(c.get("type", "deposit")).lower(),
            "above": [str(x) for x in (c.get("above", c.get("later_than", [])) or [])],
            "below": [str(x) for x in (c.get("below", c.get("earlier_than", [])) or [])],
            "date": c.get("date", c.get("period")),
            "description": c.get("description", ""),
        })
    return out


def skill(organism, context):
    """Order contexts, detect contradictions, and build the sequence."""
    ctxs = _contexts(context)
    if not ctxs:
        return {
            "action": "STRATIGRAPHY", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need a list of contexts"},
        }

    ids = {c["id"] for c in ctxs}
    edges = []          # (later, earlier)
    conflicts = []

    for c in ctxs:
        for a in c["above"]:
            if a not in ids:
                conflicts.append({"type": "dangling_reference", "context": c["id"], "references": a})
                continue
            edges.append((c["id"], a))
        for b in c["below"]:
            if b not in ids:
                conflicts.append({"type": "dangling_reference", "context": c["id"], "references": b})
                continue
            edges.append((b, c["id"]))

    # A cycle means two contexts claim to be above each other.
    adj = {}
    for later, earlier in edges:
        adj.setdefault(later, set()).add(earlier)

    def has_path(src, dst, seen=None):
        seen = seen or set()
        if src in seen:
            return False
        seen.add(src)
        for nxt in adj.get(src, ()):
            if nxt == dst:
                return True
            if has_path(nxt, dst, seen):
                return True
        return False

    for later, earlier in set(edges):
        if has_path(earlier, later):
            conflicts.append({
                "type": "cycle",
                "contexts": [later, earlier],
                "detail": f"{later} is recorded above {earlier} and vice versa",
            })

    # Also flag a context that says it is above something it is
    # explicitly recorded below.
    for c in ctxs:
        for a in c["above"]:
            for b in c["below"]:
                if a == b:
                    conflicts.append({
                        "type": "self_contradiction",
                        "context": c["id"],
                        "detail": f"{c['id']} is both above and below {a}",
                    })

    # Topological order of the acyclic part.
    indeg = {i: 0 for i in ids}
    for later, earlier in set(edges):
        indeg[later] = indeg.get(later, 0) + 1
    ready = sorted([i for i, d in indeg.items() if d == 0])
    order = []
    adj_list = {}
    for later, earlier in set(edges):
        adj_list.setdefault(later, set()).add(earlier)
    # `indeg` above counts incoming edges from "later" nodes; for Kahn's
    # algorithm over "is later than" we need out-degree zero first.
    outdeg = {i: 0 for i in ids}
    for later, earlier in set(edges):
        outdeg[earlier] = outdeg.get(earlier, 0) + 1
    ready = sorted([i for i in ids if outdeg[i] == 0])
    while ready:
        node = ready.pop(0)
        order.append(node)
        for later in [l for l, e in set(edges) if e == node]:
            outdeg[later] -= 1
            if outdeg[later] == 0:
                ready.append(later)
        ready.sort()

    # Phase grouping: contexts not related by a stratigraphic edge are
    # contemporaneous.
    phases = []
    assigned = set()
    for cid in order:
        if cid in assigned:
            continue
        group = [cid]
        assigned.add(cid)
        for other in order:
            if other in assigned:
                continue
            if not has_path(cid, other) and not has_path(other, cid):
                group.append(other)
                assigned.add(other)
        phases.append(group)

    return {
        "action": "STRATIGRAPHY",
        "intensity": round(min(1.0, len(conflicts) / max(1, len(ctxs))), 3),
        "version": 1,
        "result": {
            "ok": not conflicts,
            "contexts": len(ctxs),
            "sequence": order,                 # earliest first
            "phases": phases,
            "conflicts": conflicts,
            "relationship_count": len(set(edges)),
            "earliest": order[0] if order else None,
            "latest": order[-1] if order else None,
        },
    }
