"""Real structured incident logger with WORM-style append-only storage."""
import json, os, time, hashlib

def skill(organism, context):
    """Append a security incident to an immutable log file.
    context: {"event": {"type": "port_scan", "src": "1.2.3.4"}, "log_path": "/var/log/metamorfus/incidents.ndjson"}
    """
    event = context.get("event", {})
    log_path = context.get("log_path", "/tmp/metamorfus-incidents.ndjson")
    ts = time.time()
    entry = {
        "ts": ts,
        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "event": event,
    }
    # Hash chain: prev_hash + this entry's payload
    prev_hash = ""
    if os.path.exists(log_path):
        try:
            with open(log_path, "rb") as f:
                prev_hash = hashlib.sha256(f.read()).hexdigest()
        except Exception: pass
    payload = json.dumps(entry, sort_keys=True).encode() + prev_hash.encode()
    entry["hash"] = hashlib.sha256(payload).hexdigest()
    entry["prev_hash"] = prev_hash
    try:
        os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
        with open(log_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
        return {"logged": True, "path": log_path, "hash": entry["hash"]}
    except Exception as e:
        return {"logged": False, "error": str(e)}