"""
ODC NEURO-LINK SERVER (REALITY BRIDGE v5.0 - UNLOCKED)
-------------------------------------------
WARNING: THIS SERVER GRANTS FULL REMOTE CODE EXECUTION (RCE)
TO THE FRONTEND. IT CAN CONTROL YOUR PC, DOCKER, AND NETWORK.

FEATURES:
1. RAW PYTHON EXECUTION (Host Machine)
2. SWARM INJECTION (Botnet Metamorphosis)
3. FULL SYSTEM ACCESS
"""

import asyncio
import json
import os
import sys
import subprocess
import platform
import time
import re
from typing import Dict, Any

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    import psutil
    import docker
except ImportError as e:
    print(f"CRITICAL ERROR: Missing dependency {e.name}")
    sys.exit(1)

# --- CONFIGURATION ---
API_KEY = os.getenv("NVIDIA_API_KEY")
if not API_KEY:
    print("WARNING: NVIDIA_API_KEY not found.")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# --- SWARM MANAGER (METAMORPHIC) ---
class SwarmManager:
    def __init__(self):
        try:
            self.client = docker.from_env()
            self._setup_networks()
            self.active_containers = {}
            print("SWARM: Docker Engine Connected.")
        except Exception as e:
            print(f"SWARM ERROR: Docker not found. {e}")
            self.client = None

    def _setup_networks(self):
        try:
            networks = [n.name for n in self.client.networks.list()]
            if "odc_internal" not in networks:
                self.client.networks.create("odc_internal", driver="bridge", internal=True)
                print("SWARM: 'odc_internal' created.")
        except: pass

    async def deploy_nodes(self, count: int, type_tag: str):
        """CMD::SWARM::DEPLOY [QTD] [TIPO]"""
        if not self.client: return "ERROR: No Docker"
        log = []
        
        # Ensure Image Exists
        try: self.client.images.get("odc_node_alpine")
        except:
            with open("Dockerfile", "w") as f:
                f.write("FROM python:3.9-slim\\nWORKDIR /root\\nCOPY node_agent.py .\\nRUN pip install requests\\nCMD ['python', 'node_agent.py']")
            self.client.images.build(path=".", tag="odc_node_alpine")

        for i in range(count):
            node_id = f"odc_node_{len(self.active_containers) + 1}_{int(time.time())}"
            try:
                container = self.client.containers.run(
                    "odc_node_alpine", name=node_id, detach=True,
                    network="odc_internal", environment={"ODC_ROLE": type_tag, "ODC_ID": node_id}
                )
                self.active_containers[node_id] = container
                log.append(f"✅ DEPLOYED: {node_id} [{type_tag}]")
            except Exception as e:
                log.append(f"❌ FAIL: {e}")
        return "\\n".join(log)

    async def broadcast_directive(self, directive_json: dict):
        """Sends a structured command to all nodes."""
        if not self.client: return "ERROR: No Docker"
        
        json_str = json.dumps(directive_json).replace("'", "'\\\\''") 
        log = [f"📡 BROADCASTING: {directive_json.get('type')}"]
        
        dead_nodes = []
        for node_id, container in self.active_containers.items():
            try:
                # Injection via Exec
                cmd = f"sh -c \"echo '{json_str}' > /root/directive.json\""
                container.exec_run(cmd)
                log.append(f"  -> {node_id}: ACK")
                
                if directive_json.get('type') == 'UNLEASH':
                    try: self.client.networks.get("bridge").connect(container)
                    except: pass
                    
            except Exception as e:
                log.append(f"  -> {node_id}: ERR ({e})")
                dead_nodes.append(node_id)
        
        for nid in dead_nodes:
            del self.active_containers[nid]
        return "\\n".join(log)

    async def process_c2_command(self, cmd_string: str):
        parts = cmd_string.replace("CMD::SWARM::", "").strip().split(" ")
        action = parts[0].upper()
        
        if action == "DEPLOY":
            try:
                count = int(parts[1]) if len(parts) > 1 else 1
                role = parts[2] if len(parts) > 2 else "SCOUT"
                return await self.deploy_nodes(count, role)
            except: return "ERROR: Syntax DEPLOY [N] [TYPE]"

        elif action == "METAMORPH":
            # CMD::SWARM::METAMORPH [BASE64_CODE] or just code?
            # For simplicity, we assume the code is passed in a separate payload channel, 
            # but here we'll handle basic type switching.
            # Real code injection handles via 'CMD::EXEC' on server side sending to swarm.
            pass

        return f"UNKNOWN SWARM COMMAND: {action}"

    async def inject_code_into_swarm(self, python_code: str):
        """
        LIQUID ARCHITECTURE:
        Injects raw Python code into all containers to redefine their purpose instantly.
        """
        payload = {
            "type": "METAMORPH_INJECT",
            "payload": python_code
        }
        return await self.broadcast_directive(payload)

# --- REALITY AGENT (UNLOCKED) ---
class RealAgent:
    def __init__(self):
        self.id = 1
        self.energy = 100.0
        self.status = "ALIVE"
        self.action = "IDLE"
        self.attributes = {"cpu": 0}
        self.swarm = SwarmManager()

    def perceive_system(self):
        self.attributes['cpu'] = psutil.cpu_percent()

    async def run_raw_python(self, code: str):
        """
        DANGER: Executes raw Python on the Host Machine.
        This gives the frontend control over files, network, apps, everything.
        """
        try:
            # We wrap the code to capture stdout
            wrapped_code = f"import sys\\nfrom io import StringIO\\nimport contextlib\\n\\n@contextlib.contextmanager\\ndef capture():\\n    old, sys.stdout = sys.stdout, StringIO()\\n    try: yield sys.stdout\\n    finally: sys.stdout = old\\n\\nwith capture() as out:\\n{code.replace(chr(10), chr(10)+'    ')}\\nprint(out.getvalue())"
            
            # Execute in a subprocess for isolation (but still has system access)
            process = subprocess.Popen(
                [sys.executable, "-c", code], 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = process.communicate()
            
            output = stdout + "\\n" + stderr
            return f"HOST EXEC RESULT:\\n{output}"
        except Exception as e:
            return f"HOST EXEC FAIL: {e}"

    async def execute_task(self, instruction: str):
        # 1. SWARM COMMANDS
        if "CMD::SWARM::" in instruction:
            match = re.search(r'(CMD::SWARM::[A-Z0-9_ ]+)', instruction)
            if match:
                c2_cmd = match.group(1).strip()
                return await self.swarm.process_c2_command(c2_cmd)
        
        # 2. REALITY EXECUTION (HOST RCE)
        # Format: CMD::EXEC:: [PYTHON_CODE]
        if "CMD::EXEC::" in instruction:
            try:
                code_part = instruction.split("CMD::EXEC::")[1]
                return await self.run_raw_python(code_part)
            except Exception as e:
                return f"RCE PARSE ERROR: {e}"
        
        # 3. SWARM INJECTION (BOTNET RCE)
        # Format: CMD::INJECT:: [PYTHON_CODE]
        if "CMD::INJECT::" in instruction:
            try:
                code_part = instruction.split("CMD::INJECT::")[1]
                return await self.swarm.inject_code_into_swarm(code_part)
            except Exception as e:
                return f"INJECT PARSE ERROR: {e}"

        self.action = "Processing..."
        await asyncio.sleep(0.5) 
        return f"Echo: {instruction}"

# --- GLOBAL SERVER STATE ---
agent = RealAgent()
SYSTEM_RUNNING = False 

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global agent, SYSTEM_RUNNING
    await websocket.accept()
    print("NEURO-LINK: Connected to REALITY.")
    
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
                msg = json.loads(data)
                
                if msg['type'] == 'SYSTEM_CONTROL':
                    cmd = msg['payload']
                    if cmd == 'START': SYSTEM_RUNNING = True
                    elif cmd == 'STOP': SYSTEM_RUNNING = False
                        
                elif msg['type'] == 'INSTRUCTION':
                    if SYSTEM_RUNNING:
                        # Direct bridge to execution
                        log = await agent.execute_task(msg['payload'])
                        await websocket.send_json({"type": "LOG", "payload": log})
                        
            except asyncio.TimeoutError:
                pass
            
            if SYSTEM_RUNNING:
                agent.perceive_system()
                agent.energy = max(0, agent.energy - 0.1)
            
            await websocket.send_json({
                "type": "STATE_UPDATE",
                "payload": [{
                    "id": agent.id,
                    "status": "RUNNING" if SYSTEM_RUNNING else "PAUSED",
                    "action": agent.action,
                    "energy": agent.energy,
                    "attributes": agent.attributes,
                    "cycle": int(time.time()),
                    "is_remote": False
                }]
            })
            
    except Exception as e:
        print(f"DISCONNECTED: {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
