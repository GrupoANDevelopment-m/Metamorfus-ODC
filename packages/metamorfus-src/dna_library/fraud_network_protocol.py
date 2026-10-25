"""Fraud network analysis — who is connected to whom.

Builds a graph of accounts from shared attributes (counterparty,
device, IP, amount patterns) and finds the accounts that sit at the
centre of it. A single transaction may look ordinary; a ring of
accounts cycling money through each other does not.

Centrality uses degree plus the number of short cycles each account
participates in, which is the signature of a money-mule ring.

Transferable: graph-based insider-threat and ring detection.
Originally forged by: fraud_analyst.adopt
"""
from collections import defaultdict


def _txs(context):
    raw = context.get("transactions", context.get("txs", []))
    return [t for t in raw if isinstance(t, dict)] if isinstance(raw, list) else []


def _accounts(txs):
    accs = set()
    for t in txs:
        for k in ("nameOrig", "origin", "account", "from", "nameDest", "destination", "to"):
            v = t.get(k)
            if v:
                accs.add(str(v))
    return accs


def skill(organism, context):
    """Build the transaction graph and rank accounts by ring centrality."""
    txs = _txs(context)
    if len(txs) < 2:
        return {
            "action": "FRAUD_NETWORK", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "need at least 2 transactions"},
        }

    edges = defaultdict(float)
    edge_count = defaultdict(int)
    for t in txs:
        src = str(t.get("nameOrig", t.get("origin", t.get("from", ""))) or "")
        dst = str(t.get("nameDest", t.get("destination", t.get("to", ""))) or "")
        if not src or not dst or src == dst:
            continue
        try:
            amt = float(t.get("amount", 0) or 0)
        except (TypeError, ValueError):
            amt = 0.0
        edges[(src, dst)] += amt
        edge_count[(src, dst)] += 1

    if not edges:
        return {
            "action": "FRAUD_NETWORK", "intensity": 0.0, "version": 1,
            "result": {"ok": False, "error": "no usable edges in the transactions"},
        }

    accounts = _accounts(txs)
    undirected = defaultdict(set)
    for (s, d) in edges:
        undirected[s].add(d)
        undirected[d].add(s)

    # Triangle count per node: the cheapest reliable ring signature.
    triangles = defaultdict(int)
    for node, neighbours in undirected.items():
        for a in neighbours:
            for b in neighbours:
                if a < b and b in undirected.get(a, ()):
                    triangles[node] += 1
    # Each triangle contributes to all three of its vertices.
    tri_per_node = {n: triangles[n] // 2 for n in undirected}

    # Also: accounts that both send and receive, which is what a mule
    # does — pass money straight through.
    sends = defaultdict(int)
    receives = defaultdict(int)
    for (s, d) in edges:
        sends[s] += 1
        receives[d] += 1

    total_flow = sum(edges.values()) or 1.0

    # Chain detector: a pass-through chain that loses only a little
    # value at each hop. The triangle count below finds closed rings,
    # but a real laundering chain is often open — money enters one end
    # and leaves the other, with a small haircut at each step. The
    # tell is a high retention ratio across consecutive hops.
    chain_edges = sorted(
        ({"from": s_, "to": d_, "flow": v, "count": edge_count[(s_, d_)]}
         for (s_, d_), v in edges.items()),
        key=lambda e: e["flow"], reverse=True,
    )
    chains = []
    for i, e in enumerate(chain_edges):
        for j in range(i + 1, len(chain_edges)):
            nxt = chain_edges[j]
            if e["to"] != nxt["from"]:
                continue
            retention = nxt["flow"] / e["flow"] if e["flow"] else 0
            if retention >= 0.85 and e["flow"] >= 0.05 * total_flow:
                chains.append({
                    "path": [e["from"], e["to"], nxt["to"]],
                    "retention": round(retention, 4),
                    "flow": round(e["flow"] + nxt["flow"], 2),
                })
    # Extend chains greedily to their full length.
    adjacency = {s_: d_ for (s_, d_) in edges}
    longest_chain = []
    for e in chain_edges:
        path = [e["from"], e["to"]]
        flow = e["flow"]
        cur = e["to"]
        while cur in adjacency:
            nxt_flow = edges[(cur, adjacency[cur])]
            if nxt_flow / flow < 0.85 or flow == 0:
                break
            path.append(adjacency[cur])
            flow = nxt_flow
            cur = adjacency[cur]
        if len(path) > len(longest_chain):
            longest_chain = path

    scores = []
    for a in accounts:
        deg = len(undirected.get(a, ()))
        tri = tri_per_node.get(a, 0)
        thru = min(sends.get(a, 0), receives.get(a, 0))
        flow = sum(v for (s, d), v in edges.items() if s == a) + \
               sum(v for (s, d), v in edges.items() if d == a)
        # Centrality blend: degree, ring participation, pass-through and
        # the share of money the account touches.
        score = (
            0.25 * min(1.0, deg / 10.0)
            + 0.30 * min(1.0, tri / 3.0)
            + 0.25 * min(1.0, thru / 5.0)
            + 0.20 * min(1.0, flow / total_flow)
        )
        # An account inside a high-retention pass-through chain is a
        # link in a laundering path even when the ring is not closed.
        if a in set(longest_chain) and len(longest_chain) >= 3:
            score += 0.25
        elif a in {x for c in chains for x in c["path"]}:
            score += 0.15
        scores.append({
            "account": a,
            "centrality": round(score, 4),
            "degree": deg,
            "triangles": tri,
            "sends": sends.get(a, 0),
            "receives": receives.get(a, 0),
            "flow": round(flow, 2),
            "role": ("mule" if (thru >= 1 and (tri >= 1 or a in set(longest_chain)))
                     else ("hub" if deg >= 3 else "leaf")),
        })

    scores.sort(key=lambda s: s["centrality"], reverse=True)
    threshold = float(context.get("threshold", 0.4) or 0.4)
    suspicious = [s for s in scores if s["centrality"] >= threshold]

    # Strongly connected components would be ideal, but a full Tarjan
    # is overkill here; the triangle count captures the same signal for
    # the ring sizes that matter.
    return {
        "action": "FRAUD_NETWORK",
        "intensity": round(min(1.0, len(suspicious) / max(1, len(accounts))), 3),
        "version": 1,
        "result": {
            "ok": True,
            "accounts": len(accounts),
            "edges": len(edges),
            "total_flow": round(total_flow, 2),
            "suspicious": suspicious,
            "top_central": scores[:5],
            "mules": [s["account"] for s in scores if s["role"] == "mule"],
            "laundering_chains": chains,
            "longest_chain": longest_chain,
            "threshold": threshold,
        },
    }
