"""Real async TCP port scanner — scans a host for open ports."""
import asyncio, socket, json, time

def skill(organism, context):
    """Scan a host for open TCP ports.
    context: {"host": "scanme.nmap.org", "ports": [22,80,443]}
    """
    host = context.get("host", "127.0.0.1")
    ports = context.get("ports", [21,22,23,25,53,80,110,143,443,445,3306,3389,5432,5900,8080])
    timeout = float(context.get("timeout", 1.0))
    
    async def check(p):
        try:
            r, w = await asyncio.wait_for(asyncio.open_connection(host, p), timeout=timeout)
            w.close()
            try: await w.wait_closed()
            except Exception: pass
            return p
        except Exception: return None
    
    async def run_all():
        results = await asyncio.gather(*(check(p) for p in ports))
        return [p for p in results if p]
    
    t0 = time.time()
    open_ports = asyncio.run(run_all())
    return {
        "host": host,
        "scanned_ports": len(ports),
        "open_ports": open_ports,
        "open_count": len(open_ports),
        "duration_ms": int((time.time() - t0) * 1000),
        "summary": f"{len(open_ports)}/{len(ports)} ports open on {host}",
    }