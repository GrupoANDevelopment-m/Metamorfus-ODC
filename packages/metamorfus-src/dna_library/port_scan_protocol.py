def skill(organism, context):
    """Ativo: scan TCP Connect em portas comuns."""
    import socket
    host = context.get("host", "127.0.0.1")
    ports = context.get("ports", [22, 80, 443, 8080, 3306])
    open_ports = []
    for p in ports:
        try:
            with socket.create_connection((host, p), timeout=1):
                open_ports.append(p)
        except Exception:
            pass
    return {"action": "PORT_SCAN_DONE", "intensity": 0.6, "version": 1, "params": {"host": host, "open": open_ports}}