"""Adapter for GitHub MCP Server — speak JSON-RPC 2.0 over stdio.

The github-mcp-server is a Go binary that implements the Model Context
Protocol. We spawn it as a subprocess and speak JSON-RPC framed by
Content-Length headers (the LSP/MCP wire format).

Supported actions:
  list_tools              — list available MCP tools
  call_tool               — invoke a tool by name with arguments
  search_code             — convenience wrapper around search_code MCP tool
  list_issues             — convenience wrapper around list_issues MCP tool
"""
import json
import subprocess
import os
import time

DEFAULT_BIN = "/workspace/skill-pkgs/extracted/github-mcp-server-main/github-mcp-server-main/cmd/github-mcp-server/github-mcp-server"
BIN = os.environ.get("GITHUB_MCP_BIN") or (DEFAULT_BIN if os.path.exists(DEFAULT_BIN) else None)


class _MCPClient:
    """Minimal MCP client — JSON-RPC 2.0 over Content-Length-framed stdio."""
    def __init__(self, bin_path, env=None):
        self.bin = bin_path
        self.proc = subprocess.Popen(
            [bin_path, "stdio"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, **(env or {})},
        )
        self._id = 0

    def _send(self, payload):
        body = json.dumps(payload).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        self.proc.stdin.write(header + body)
        self.proc.stdin.flush()

    def _read_message(self, timeout=30):
        # Read headers
        deadline = time.time() + timeout
        header_buf = b""
        while time.time() < deadline:
            ch = self.proc.stdout.read(1)
            if not ch:
                return None
            header_buf += ch
            if header_buf.endswith(b"\r\n\r\n"):
                break
        else:
            raise TimeoutError("MCP: timeout reading headers")
        headers = {}
        for line in header_buf.decode("ascii").split("\r\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        length = int(headers.get("content-length", "0"))
        body = b""
        while len(body) < length:
            chunk = self.proc.stdout.read(length - len(body))
            if not chunk:
                break
            body += chunk
        return json.loads(body.decode("utf-8"))

    def request(self, method, params=None, timeout=30):
        self._id += 1
        req = {"jsonrpc": "2.0", "id": self._id, "method": method}
        if params is not None:
            req["params"] = params
        self._send(req)
        while True:
            msg = self._read_message(timeout=timeout)
            if msg is None:
                raise RuntimeError("MCP: connection closed")
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError(f"MCP error: {msg['error']}")
                return msg.get("result")

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            try: self.proc.kill()
            except Exception: pass


def skill(organism, context):
    """Invoke the GitHub MCP server.
    context = {"action": "list_tools" | "call_tool" | "search_code" | "list_issues",
               "tool": "...", "arguments": {...}, "query": "...", "owner": "...", "repo": "...", "state": "open"}
    """
    if not BIN:
        return {
            "error": "github-mcp-server binary not built",
            "hint": "cd /workspace/skill-pkgs/extracted/github-mcp-server-main/github-mcp-server-main && go build -o ./cmd/github-mcp-server/github-mcp-server ./cmd/github-mcp-server",
        }
    # Check for GITHUB_TOKEN
    if not os.environ.get("GITHUB_TOKEN"):
        return {"error": "GITHUB_TOKEN env var not set — required for GitHub MCP server"}

    action = context.get("action", "list_tools")
    client = _MCPClient(BIN)
    try:
        if action == "list_tools":
            result = client.request("tools/list")
            return {"ok": True, "tools": result.get("tools", [])}
        if action == "call_tool":
            name = context.get("tool")
            args = context.get("arguments", {})
            if not name:
                return {"error": "tool name is required for call_tool"}
            result = client.request("tools/call", {"name": name, "arguments": args})
            return {"ok": True, "result": result}
        if action == "search_code":
            q = context.get("query", "")
            if not q:
                return {"error": "query required for search_code"}
            return {"ok": True, "result": client.request("tools/call", {
                "name": "search_code",
                "arguments": {"q": q, "per_page": context.get("limit", 10)},
            })}
        if action == "list_issues":
            owner = context.get("owner", "")
            repo = context.get("repo", "")
            if not (owner and repo):
                return {"error": "owner and repo required for list_issues"}
            return {"ok": True, "result": client.request("tools/call", {
                "name": "list_issues",
                "arguments": {"owner": owner, "repo": repo, "state": context.get("state", "open")},
            })}
        return {"error": f"unknown action: {action}"}
    except Exception as e:
        return {"error": f"github-mcp failed: {type(e).__name__}: {e}"}
    finally:
        client.close()
