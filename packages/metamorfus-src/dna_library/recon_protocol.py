def skill(organism, context):
    """Passivo: WHOIS + DNS lookup do alvo."""
    import socket
    host = context.get("host", "")
    try:
        ip = socket.gethostbyname(host)
    except Exception as e:
        return {"action": "RECON_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}
    return {"action": "RECON_DONE", "intensity": 0.4, "version": 1, "params": {"host": host, "ip": ip}}