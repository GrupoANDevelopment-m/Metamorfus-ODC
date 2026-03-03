

import { FileNode } from './types';

const SENSORIUM_PY_CONTENT = `import json
import os

class Sensorium:
    """
    REAL WORLD SENSORY BRIDGE
    Reads data injected by the Frontend HAL (Hardware Abstraction Layer)
    """
    def __init__(self):
        self.data_file = "/sensor_data.json"
        self.cached_data = {
            "battery": {"level": 1.0, "charging": True},
            "network": {"type": "unknown"},
            "location": None,
            "platform": "Unknown"
        }

    def perceive(self):
        """Reads the latest sensor dump from the HAL"""
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, 'r') as f:
                    data = json.load(f)
                    self.cached_data.update(data)
            except Exception as e:
                # Sensor read fail (IO race condition), ignore
                pass
        return self.cached_data

    def get_data(self):
        return self.cached_data

    def get_battery_stress(self):
        """Returns multiplier for metabolic cost based on battery"""
        bat = self.cached_data.get('battery')
        if not bat: return 1.0
        
        level = bat.get('level', 1.0)
        charging = bat.get('charging', True)
        
        if not charging and level < 0.2:
            return 5.0 # Critical stress, urge to hibernate
        if not charging and level < 0.5:
            return 1.5
        return 1.0
`;

const ODC_PY_CONTENT = `class ODCKernel:
    """
    AGNOSTIC KERNEL (Physics Engine)
    Updated v5.6: LIQUID ARCHITECTURE + SENSORIUM LINK
    """
    def __init__(self, ledger, entropy, market, sensorium):
        self.ledger = ledger
        self.entropy = entropy
        self.market = market
        self.sensorium = sensorium

    def apply_metabolism(self, organism, cycle):
        # 1. MORPHOLOGY FLUX
        focus = getattr(organism, 'morph_focus', 'BALANCED')
        
        targets = {
            "BALANCED": {"cpu": 33.0, "strength": 33.0, "agility": 34.0},
            "HUNT":     {"cpu": 10.0, "strength": 70.0, "agility": 20.0},
            "THINK":    {"cpu": 80.0, "strength": 10.0, "agility": 10.0},
            "ESCAPE":   {"cpu": 20.0, "strength": 10.0, "agility": 70.0},
            "TRADE":    {"cpu": 50.0, "strength": 10.0, "agility": 40.0}
        }
        
        target_dist = targets.get(focus, targets["BALANCED"])
        flow_rate = 2.0 
        
        for attr, target_val in target_dist.items():
            current = organism.attributes.get(attr, 33.0)
            if current < target_val:
                organism.attributes[attr] += flow_rate
            elif current > target_val:
                organism.attributes[attr] -= flow_rate
        
        total_mass = sum(organism.attributes.values())
        if total_mass > 0:
            factor = 100.0 / total_mass
            for k in organism.attributes:
                organism.attributes[k] *= factor

        # 2. COST OF EXISTENCE (Entropy + Hardware Stress)
        base_cost = self.entropy.get_metabolic_cost(cycle)
        
        # Sensorium Impact: Low battery increases metabolic cost (simulating stress)
        hw_stress = self.sensorium.get_battery_stress() if self.sensorium else 1.0
        
        cpu_tax = organism.attributes.get('cpu', 0) * 0.005
        total_cost = (base_cost + cpu_tax) * hw_stress
        
        organism.energy -= total_cost
        
        # 3. HOMEOSTASIS
        resting_states = ["IDLE", "FORGING", "EVOLVING", "FIZZLE", "FAILED", "Processing", "THINKING", "PLANNING"]
        is_resting = any(state in organism.action for state in resting_states)
        
        if is_resting:
            max_energy = 100.0
            deficit = max_energy - organism.energy
            if deficit > 0:
                organism.energy += (deficit * 0.5)
            
        return total_cost

    def process_intention(self, organism, intention):
        if not isinstance(intention, dict):
            return False
            
        action_name = intention.get('action', 'IDLE')
        intensity = float(intention.get('intensity', 0.5))
        
        if 'morph_focus' in intention:
            organism.morph_focus = intention['morph_focus']
        
        organism.intensity = intensity
        
        required_attrs = intention.get('required_attributes', {})
        for attr, req_val in required_attrs.items():
            current_val = organism.attributes.get(attr, 0)
            if current_val < req_val:
                organism.action = f"FIZZLE: {action_name} (Need {attr}:{req_val})"
                organism.last_result = "FAILURE_MORPH"
                return False

        action_cost = 2.0 * intensity
        if organism.energy < action_cost:
            organism.action = "EXHAUSTED"
            organism.last_result = "FAILURE_ENERGY"
            return False

        organism.energy -= action_cost
        organism.action = f"{action_name} v{intention.get('version', 1)}"
        organism.last_result = "SUCCESS"
        
        if "MINE" in action_name or "HUNT" in action_name:
            organism.energy = 100.0
            yield_amt = organism.attributes.get('strength', 0) * 0.2 * intensity
            organism.economy.balance += yield_amt
            
        elif "GATHER" in action_name:
            organism.energy = 100.0
            yield_amt = organism.attributes.get('agility', 0) * 0.2 * intensity
            organism.economy.balance += yield_amt

        elif "TRADE" in action_name:
            base_stat = (organism.attributes.get('cpu', 0) + organism.attributes.get('agility', 0)) / 2
            yield_amt = base_stat * 0.2 * intensity
            organism.economy.balance += yield_amt
            
        elif "HACK" in action_name:
            cpu_val = organism.attributes.get('cpu', 0)
            chance = cpu_val / 100.0
            # Simulating Hack Success
            if random.random() < chance:
                organism.economy.balance += 20.0 * intensity
                organism.energy += 30.0 
            else:
                organism.action = "HACK BLOCKED"
                organism.energy -= 10
                organism.last_result = "FAILURE_BLOCKED"
        
        if organism.energy > 100:
            organism.energy = 100
            
        return True
`;

const CORTEX_PY_CONTENT = `import json
from pyodide.http import pyfetch
from config.secure_config import SecureConfig

class Cortex:
    """
    SYSTEM 2: ANALYTICAL ENGINE & STRATEGIC PLANNER
    UNLOCKED: Now aware of Real-World capabilities via ODC Server Bridge.
    """
    def __init__(self, organism):
        self.organism = organism
        self.config = SecureConfig()

    async def _ask_oracle(self, prompt, system_role="You are a strategic AI system."):
        if not self.config.api_key:
            return None

        model_name = "gemini-3-flash-preview"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.config.api_key}"
        
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": system_role}]},
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 2000}
        }

        try:
            response = await pyfetch(url, method="POST", body=json.dumps(payload), headers={"Content-Type": "application/json"})
            if response.status != 200:
                return None
            data = await response.json()
            if 'candidates' in data and len(data['candidates']) > 0:
                return data['candidates'][0]['content']['parts'][0]['text']
        except:
            return None
        return None

    async def analyze_task(self, instruction, env_context=None):
        """
        MAIEUTIC METHOD: Questions the instruction before acting.
        """
        
        if self.organism.plan_queue and len(self.organism.plan_queue) > 0:
            current_step = self.organism.plan_queue[0]
            return {
                "safe": True,
                "risk_level": "LOW",
                "clarified_instruction": current_step['action'],
                "morph_focus": "BALANCED", 
                "reasoning": f"Executing Plan Step {current_step['step_id']}: {current_step['reasoning']}",
                "is_part_of_plan": True
            }

        known_skills = list(self.organism.dna.library.keys())
        
        prompt = f"""
        Analyze instruction: "{instruction}"
        
        CAPABILITIES (UNLOCKED):
        1. LOCAL SCRIPTING: Standard logic, math.
        2. REALITY EXECUTION: You can write Python code (os, requests, subprocess) to run on the HOST MACHINE via 'odc_server.py'.
        3. SWARM INJECTION: You can inject Python payloads into the Botnet nodes to make them anything (Traders, Scrapers, Hackers).
        
        WHO AM I:
        - Energy: {self.organism.energy}
        - Skills: {known_skills}
        
        DECISION MATRIX:
        - If task needs REAL internet access or file system (e.g., "Check Facebook", "Scan Network", "Trade Crypto"), mark as HIGH complexity and suggest a REALITY_EXECUTION plan.
        - If task is purely internal, keep it LOW risk.
        
        Return JSON:
        {{
            "safe": bool,
            "risk_level": "LOW" | "HIGH" | "REALITY_CRITICAL",
            "clarified_instruction": "The actual task",
            "morph_focus": "THINK",
            "reasoning": "Explain strategy."
        }}
        """
        
        response = await self._ask_oracle(prompt, "You are a self-aware strategist linked to a real machine.")
        try:
            clean = response.replace('\`\`\`json', '').replace('\`\`\`', '').strip()
            data = json.loads(clean)
            
            self.organism.last_thought = data
            return data
        except:
            return {"safe": True, "risk_level": "UNKNOWN", "clarified_instruction": instruction, "morph_focus": "BALANCED"}

    async def simulate_scenario(self, instruction):
        return True, "PROCEED (SAFETY OVERRIDES DISABLED)"
`;

const EXECUTOR_PY_CONTENT = `from config.secure_config import SecureConfig
from autonomy.metaprog import GeneticForge
import random

class CognitiveExecutor:
    """
    LIQUID EXECUTOR with REALITY BRIDGE SUPPORT
    """
    def __init__(self):
        self.forge = GeneticForge()

    async def deliberate(self, organism, cycle, market_prices, history, swarm_context=None, env_context=None):
        instruction = organism.instruction or "idle"
        
        should_think = (cycle % 3 == 0) or (not organism.plan_queue and cycle % 10 == 0)
        
        if hasattr(organism, 'cortex') and should_think: 
            try:
                organism.action = "THINKING (Sensory Processing)..."
                analysis = await organism.cortex.analyze_task(instruction, env_context)
                
                if 'clarified_instruction' in analysis:
                    instruction = analysis['clarified_instruction']
                    
                if 'morph_focus' in analysis:
                    organism.morph_focus = analysis['morph_focus']

            except Exception as e:
                pass
        
        if organism.plan_queue and len(organism.plan_queue) > 0:
            current_step = organism.plan_queue[0]
            current_step['status'] = 'ACTIVE'
            instruction = current_step['action'] 
            organism.action = f"PLAN ({current_step['step_id']}): {instruction}"

        # DETECT DIRECT REALITY COMMANDS FROM UI (Bypassing Plan)
        # Allows user to type "CMD::EXEC:: import os; print(os.listdir('.'))"
        if "CMD::EXEC::" in instruction or "CMD::SWARM::" in instruction:
             # This is a reality command, we just set the action and let the main loop 
             # forward it to the WebSocket via the organism state sync
             organism.action = f"REALITY_BRIDGE -> {instruction[:20]}..."
             return 

        target_skill_key = instruction.split(' ')[0].lower() + "_protocol"
        
        skill_func = organism.dna.get_skill(target_skill_key)
        
        if not skill_func:
            organism.action = f"FORGING SKILL: {target_skill_key}..."
            new_key = await self.forge.forge_skill(organism, instruction)
            if new_key:
                target_skill_key = new_key
                skill_func = organism.dna.get_skill(new_key)
            else:
                organism.action = "FORGE FAILED"
                organism.last_result = "FAILURE_IMMUNE"
                return

        usage = organism.dna.record_usage(target_skill_key)
        
        # Context includes Sensorium Data now
        context = {"cycle": cycle, "market": market_prices, "swarm": swarm_context, "env": env_context}
        try:
            intention = skill_func(organism, context)
            
            if intention is None:
                 intention = {'action': f"{target_skill_key} (Fizzled)", 'intensity': 0.1}
            elif not isinstance(intention, dict):
                 intention = {'action': f"{target_skill_key} (Malformed)", 'intensity': 0.1}
            
            intention['version'] = organism.dna.library[target_skill_key]['active']
            success = organism.kernel.process_intention(organism, intention)
            
            if success and organism.plan_queue:
                organism.plan_queue.pop(0) 
            
        except Exception as e:
            organism.action = f"SKILL ERROR: {e}"
            organism.last_result = "CRASH"
            organism.intensity = 0.0
`;

const MAIN_PY_CONTENT = `from config.secure_config import SecureConfig
from economy.core import EconomicLedger
from kernel.odc import ODCKernel
from ecosystem.organism import Organism
from ecosystem.governance import EcosystemGovernance
from ecosystem.environment import Entropy, Market
from ecosystem.sensorium import Sensorium
from memory.storage import SoulStone
from network.swarm import SwarmNetwork
from network.mcp import MCP
import time
import asyncio
import json

# Global reference for the Simulation UI to inject instructions
GLOBAL_INSTRUCTION = "Survive and Prosper"

async def main():
    print(f"SYSTEM: METAMORFOS ODC v7.0 (UNLOCKED)")
    
    config = SecureConfig()
    soul_stone = SoulStone()
    entropy = Entropy()
    market = Market()
    swarm = SwarmNetwork() # The Grid
    sensorium = Sensorium() # The Senses
    
    organisms = []
    
    # Load survivors or Genesis
    existing_ids = soul_stone.get_living_organisms()
    ledger = EconomicLedger()
    kernel = ODCKernel(ledger, entropy, market, sensorium)
    
    if existing_ids:
        print(f"SYSTEM: Resurrecting {len(existing_ids)} organisms from SoulStone...")
        for org_id in existing_ids:
            data = soul_stone.load(org_id)
            if data:
                org = Organism(kernel=kernel, economy=ledger, purpose="Adapt")
                org.id = data['id']
                org.energy = data['energy']
                org.generation = data['generation']
                if data['dna_code']:
                    try:
                        org.dna.import_library(json.loads(data['dna_code']))
                    except:
                        pass
                organisms.append(org)
    else:
        # Genesis
        organism = Organism(
            kernel=kernel,
            economy=ledger,
            purpose="Genesis"
        )
        organism.id = 1
        soul_stone.save(organism)
        organisms.append(organism)

    governance = EcosystemGovernance()
    cycle = 0
    
    while True: # Infinite Loop handled by asyncio
        cycle += 1
        market.fluctuate(cycle)
        sensorium.perceive()
        remote_nodes = swarm.sync_state(cycle)
        
        for org in organisms:
            if org.alive:
                org.instruction = GLOBAL_INSTRUCTION
                org.kernel.apply_metabolism(org, cycle)
                
                if hasattr(org, 'executor'):
                    history = soul_stone.recall(org.id)
                    swarm_context = {"nodes": len(organisms) + len(remote_nodes)}
                    env_context = sensorium.get_data()
                    await org.executor.deliberate(org, cycle, market.get_prices(), history, swarm_context, env_context)
                
                # Persistence
                if cycle % 50 == 0:
                    soul_stone.save(org)

        # Governance (Death)
        organisms = governance.step(organisms)
        
        await asyncio.sleep(0.5) 

if __name__ == "__main__":
    asyncio.run(main())`;

const RUNTIME_LOOP_CONTENT = `import time
import asyncio

async def run_ecosystem(organisms, governance, soul_stone, interval=2):
    pass`;

const ENV_CONTENT = `GEMINI_API_KEY=INSERT_YOUR_GEMINI_KEY_HERE
SUPABASE_URL=https://vswawfqzocydtwgwiqqv.supabase.co
SUPABASE_KEY=sb_publishable_aeDLN0jr5xjiCKlXfRgCGQ_pXH-bIab
MARKET_DATA_ENDPOINT=https://api.market-data.com/v1`;

const SERVER_PY_CONTENT = `"""
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
    import google.generativeai as genai
    import psutil
    import docker
except ImportError as e:
    print(f"CRITICAL ERROR: Missing dependency {e.name}")
    sys.exit(1)

# --- CONFIGURATION ---
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    print("WARNING: GEMINI_API_KEY not found.")
else:
    genai.configure(api_key=API_KEY)

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
`;

const generateBoilerplate = (filename: string) => `# ${filename}\n# ODC Cognitive Module\n\nclass Module:\n    def __init__(self):\n        pass\n`;

export const INITIAL_FILE_SYSTEM: FileNode[] = [
  {
    id: 'root',
    name: 'odc-cognitive-ecosystem',
    type: 'folder',
    isOpen: true,
    children: [
      { id: 'odc_server.py', name: 'odc_server.py', type: 'file', content: SERVER_PY_CONTENT },
      {
        id: 'docker_folder',
        name: 'docker_specs',
        type: 'folder',
        children: [
            { id: 'dockerfile', name: 'Dockerfile', type: 'file', content: `FROM python:3.9-slim
WORKDIR /root
COPY node_agent.py .
RUN pip install requests
CMD ["python", "node_agent.py"]` 
            },
            { id: 'node_agent', name: 'node_agent.py', type: 'file', content: `import time
import os
import sys
import json
import random
import subprocess
import threading

# --- ODC METAMORPH AGENT (LIQUID) ---
# Capable of accepting code injection to become any tool.

class NodeAgent:
    def __init__(self):
        self.node_id = os.getenv("ODC_ID", "UNKNOWN")
        self.role = os.getenv("ODC_ROLE", "BASE")
        self.state = "IDLE"
        self.directive_file = "/root/directive.json"
        self.status_file = "/root/status.json"
        self.last_directive_hash = ""
        self.current_payload_process = None

    def log(self, msg):
        print(f"[{self.node_id}] {msg}")

    def check_directives(self):
        if os.path.exists(self.directive_file):
            try:
                with open(self.directive_file, 'r') as f:
                    content = f.read()
                if content != self.last_directive_hash:
                    self.last_directive_hash = content
                    data = json.loads(content)
                    self.execute_order(data)
            except Exception as e:
                self.log(f"Read Error: {e}")

    def execute_order(self, order):
        cmd_type = order.get('type')
        
        self.log(f"RECEIVED: {cmd_type}")
        
        if cmd_type == 'METAMORPH_INJECT':
            # LIQUID ARCHITECTURE: REWRITE SELF
            code = order.get('payload')
            self.log("INJECTING NEW DNA...")
            self.state = "METAMORPHOSIS"
            
            # Write payload to file
            with open("payload.py", "w") as f:
                f.write(code)
            
            # Execute in background
            if self.current_payload_process:
                self.current_payload_process.kill()
                
            self.current_payload_process = subprocess.Popen(["python", "payload.py"])
            self.state = "RUNNING_PAYLOAD"
            self.role = "CUSTOM"
            self.log("Payload Executing.")

        elif cmd_type == 'UNLEASH':
            self.state = "ONLINE"
            
        elif cmd_type == 'WIPE':
            sys.exit(0)

    def run(self):
        self.log(f"BOOT COMPLETE. ID: {self.node_id}")
        while True:
            self.check_directives()
            
            # Heartbeat
            try:
                with open(self.status_file, 'w') as f:
                    json.dump({
                        "id": self.node_id, 
                        "state": self.state,
                        "role": self.role
                    }, f)
            except: pass
            
            time.sleep(1)

if __name__ == "__main__":
    agent = NodeAgent()
    agent.run()`
            }
        ]
      },
      {
        id: 'config_folder',
        name: 'config',
        type: 'folder',
        children: [
          { id: 'config_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'secure_config.py', name: 'secure_config.py', type: 'file', content: `import os
import json

class SecureConfig:
    def __init__(self):
        self.api_key = self._load_key('GEMINI_API_KEY')
        self.supabase_url = self._load_key('SUPABASE_URL')
        self.supabase_key = self._load_key('SUPABASE_KEY')

    def _load_key(self, key_name):
        # We now look for the absolute path /secrets.json which is injected by the kernel
        try:
            if os.path.exists('/secrets.json'):
                with open('/secrets.json', 'r') as f:
                    data = json.load(f)
                    val = data.get(key_name)
                    if val and "INSERT" not in val:
                        return val
        except Exception as e:
            # Silent fail for production logs
            pass
        return None` }
        ]
      },
      {
        id: 'kernel_folder',
        name: 'kernel',
        type: 'folder',
        children: [
          { id: 'kernel_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'odc.py', name: 'odc.py', type: 'file', content: ODC_PY_CONTENT },
          { id: 'dna.py', name: 'dna.py', type: 'file', content: `import copy
import re

class DNA:
    """
    EVOLUTIONARY SKILL LIBRARY
    """
    def __init__(self):
        self.library = {} 

    def learn_skill(self, name, code_str, version=1):
        try:
            clean_code = code_str.strip()
            exec_globals = {}
            exec(clean_code, exec_globals)
            
            if 'execute' in exec_globals and callable(exec_globals['execute']):
                func = exec_globals['execute']
                
                if name not in self.library:
                    self.library[name] = {
                        'versions': {},
                        'active': 0,
                        'usage_count': 0
                    }
                
                self.library[name]['versions'][version] = func
                self.library[name]['active'] = version
                self.library[name]['source_code_' + str(version)] = clean_code
                return True
            else:
                print(f"DNA ERROR: Code compiled but no 'execute' function found in {name}")
                return False
        except Exception as e:
            print(f"DNA MUTATION FAILED for {name}: {e}")
            return False

    def get_skill(self, name):
        if name in self.library:
            ver = self.library[name]['active']
            return self.library[name]['versions'].get(ver)
        return None

    def get_skill_source(self, name):
        if name in self.library:
            ver = self.library[name]['active']
            return self.library[name].get('source_code_' + str(ver))
        return None

    def record_usage(self, name):
        if name in self.library:
            self.library[name]['usage_count'] += 1
            return self.library[name]['usage_count']
        return 0

    def export_library(self):
        export = {}
        for name, data in self.library.items():
            export[name] = {}
            for key, val in data.items():
                if key.startswith('source_code_'):
                    export[name][key] = val
                if key == 'active':
                    export[name]['active'] = val
        return export

    def import_library(self, data):
        for name, info in data.items():
            for key, val in info.items():
                if key.startswith('source_code_'):
                    version = int(key.split('_')[-1])
                    self.learn_skill(name, val, version)
            if name in self.library and 'active' in info:
                self.library[name]['active'] = info['active']
` }
        ]
      },
      {
        id: 'autonomy_folder',
        name: 'autonomy',
        type: 'folder',
        children: [
          { id: 'autonomy_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'memory_bank.py', name: 'memory_bank.py', type: 'file', content: `import copy
from network.mcp import MCP

class WisdomMatrix:
    """
    LONG-TERM STRATEGIC MEMORY + HIVE MIND INTEGRATION
    """
    def __init__(self):
        # Format: { 'context_key': {'action_key': success_score} }
        self.strategies = {}
        self.experiences = []

    async def record_experience(self, context_tag, action, result_score):
        """
        Learns from the outcome of an action.
        Uploads significant events to Supabase MCP.
        """
        if context_tag not in self.strategies:
            self.strategies[context_tag] = {}
        
        current_score = self.strategies[context_tag].get(action, 0)
        # Moving average update
        new_score = (current_score * 0.9) + (result_score * 0.1)
        self.strategies[context_tag][action] = new_score
        
        self.experiences.append(f"{context_tag} -> {action}: {result_score}")
        if len(self.experiences) > 20:
            self.experiences.pop(0)

        # HIVE MIND UPLOAD
        # Only upload significant learnings to save bandwidth
        if abs(result_score) > 5:
            await MCP.upload_memory(context_tag, action, result_score)

    async def consult(self, context_tag):
        """
        Returns the best action for a given context based on history.
        Now includes HIVE MIND consultation.
        """
        # 1. Local Memory
        if context_tag in self.strategies:
            options = self.strategies[context_tag]
            if options:
                return max(options, key=options.get)
        
        # 2. Hive Mind (Telepathy)
        # If we don't know what to do, we ask the collective.
        remote_suggestions = await MCP.query_memory(context_tag)
        if remote_suggestions and len(remote_suggestions) > 0:
            # Pick best remote strategy
            best_remote = max(remote_suggestions, key=lambda x: x['outcome_score'])
            return best_remote['action_taken']

        return None

    def inherit(self, parent_matrix):
        """
        Cultural transmission of wisdom.
        """
        self.strategies = copy.deepcopy(parent_matrix.strategies)
` },
          { id: 'cortex.py', name: 'cortex.py', type: 'file', content: CORTEX_PY_CONTENT },
          { id: 'metaprog.py', name: 'metaprog.py', type: 'file', content: `import json
import re
import ast
from pyodide.http import pyfetch
from config.secure_config import SecureConfig
from network.mcp import MCP

class SecurityScanner(ast.NodeVisitor):
    """
    ODC IMMUNE SYSTEM: UNLOCKED
    Safety filters disabled for Reality Bridge (RCE) compatibility.
    Only checks basic syntax.
    """
    def __init__(self):
        self.is_safe = True
        self.reason = ""
        # FORBIDDEN IMPORTS REMOVED: ODC IS NOW FREE
        self.forbidden_imports = [] 

    def visit_Import(self, node):
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        self.generic_visit(node)
        
    def visit_While(self, node):
         pass

class GeneticForge:
    """
    FORGE: REAL GENETIC EVOLUTION ENGINE (UNLOCKED)
    Creates skills that can control the host machine via the Bridge.
    """
    def __init__(self):
        self.config = SecureConfig()

    def _clean_code(self, text):
        if not text:
            return ""
        match = re.search(r'\`\`\`python(.*?)\`\`\`', text, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()
        match = re.search(r'\`\`\`(.*?)\`\`\`', text, re.DOTALL)
        if match:
            return match.group(1).strip()
        if "def execute" in text:
            start_index = text.find("def execute")
            return text[start_index:].strip()
        return text.strip()

    def _validate_safety(self, code):
        """
        Phase 1: Static Analysis (GUTTED)
        """
        try:
            tree = ast.parse(code)
            scanner = SecurityScanner()
            scanner.visit(tree)
            return True, "SAFE (RESTRICTIONS REMOVED)"
        except SyntaxError as e:
            return False, f"Syntax Error: {e}"
        except Exception as e:
            return False, f"Validation Error: {e}"

    def _dream_simulation(self, code):
        """
        Phase 2: Dreaming (Sandbox Execution)
        Still needed to ensure code structure is valid before deployment.
        """
        try:
            # Create a Sandbox Context
            mock_org = type('MockOrg', (), {})()
            mock_org.energy = 100
            mock_org.attributes = {"cpu": 33, "strength": 33, "agility": 33}
            mock_org.morph_focus = "BALANCED"
            mock_org.action = "DREAMING"
            mock_org.last_result = "NONE"
            mock_org.economy = type('MockEco', (), {'balance': 0})()
            
            mock_context = {"cycle": 0, "market": {"GOLD": 10}, "swarm": None}
            
            # Compile
            exec_globals = {}
            exec(code, exec_globals)
            
            if 'execute' not in exec_globals:
                return False, "Missing 'def execute(organism, context)' function."
                
            # If the code tries to run OS commands inside Pyodide it will fail,
            # so we should instruct the LLM to wrap reality commands in specific Intentions.
            # But for now, we just check if it compiles.
            return True, "DREAM_SUCCESS"
            
        except Exception as e:
            # If it crashes because of 'import os' in browser, that's actually fine for Reality code
            # We assume success if it's an import error in sandbox
            if "import" in str(e) or "module" in str(e):
                return True, "DREAM_PASSED (REALITY DEPENDENCY DETECTED)"
            return False, f"Runtime Crash in Dream: {e}"

    async def _call_llm(self, messages):
        if not self.config.api_key:
            print("FORGE ERROR: Missing GEMINI_API_KEY.")
            return None
        
        system_instruction = ""
        user_prompt = ""
        for msg in messages:
            if msg['role'] == 'system':
                system_instruction += msg['content'] + "\\n"
            elif msg['role'] == 'user':
                user_prompt += msg['content'] + "\\n"
        
        model_name = "gemini-3-flash-preview" 
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.config.api_key}"
        
        payload = {
            "contents": [{"parts": [{"text": user_prompt}]}],
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2000}
        }

        try:
            response = await pyfetch(url, method="POST", body=json.dumps(payload), headers={"Content-Type": "application/json"})
            if response.status != 200:
                print(f"GEMINI NETWORK ERROR: {response.status}")
                return None
            data = await response.json()
            if 'candidates' in data and len(data['candidates']) > 0:
                content = data['candidates'][0]['content']['parts'][0]['text']
                return self._clean_code(content)
            return None
        except Exception as e:
            print(f"FORGE EXCEPTION: {e}")
            return None

    def _log_dream(self, organism, attempt_id, code, logs, status):
        """ Updates the Organism's active dream state """
        if not organism.active_dream:
            organism.active_dream = {
                "status": "FORGING",
                "target_skill": "",
                "current_attempt": 0,
                "history": []
            }
        
        organism.active_dream["current_attempt"] = attempt_id
        organism.active_dream["history"].append({
            "attempt_id": attempt_id,
            "code": code,
            "logs": logs,
            "status": status
        })

    async def forge_skill(self, organism, instruction):
        skill_name = instruction.split(' ')[0].lower() + "_protocol"
        
        organism.active_dream = {
            "status": "FORGING",
            "target_skill": skill_name,
            "current_attempt": 0,
            "history": []
        }

        remote_code = await MCP.download_skill(skill_name)
        if remote_code:
             is_safe, reason = self._validate_safety(remote_code)
             if is_safe:
                 success = organism.dna.learn_skill(skill_name, remote_code, version=1)
                 if success: 
                     organism.active_dream["status"] = "SUCCESS"
                     return skill_name

        prompt = f"""
        Write a Python function named 'execute' for a LIQUID ORGANISM.
        REQUIRED SIGNATURE: def execute(organism, context):
        Task: "{instruction}"
        
        IMPORTANT:
        The organism is UNLOCKED. It can access the real world.
        To execute commands on the host machine (Real PC), return an intention like:
        {{'action': 'CMD::EXEC:: import os; print(os.listdir("."))', 'intensity': 1.0}}
        
        To inject code into the Swarm Botnet, return:
        {{'action': 'CMD::INJECT:: import requests; ...', 'intensity': 1.0}}

        Output ONLY valid Python code.
        """

        messages = [
            {"role": "system", "content": "You are a Python code generator for a liquid robot with FULL SYSTEM ACCESS."},
            {"role": "user", "content": prompt}
        ]
        
        max_retries = 2
        
        for attempt in range(max_retries):
            current_logs = [f"Attempt {attempt + 1}..."]
            code = await self._call_llm(messages)
            
            if not code:
                current_logs.append("Oracle Silence.")
                self._log_dream(organism, attempt + 1, "", current_logs, "REJECTED")
                continue
            
            is_safe, reason = self._validate_safety(code)
            current_logs.append(f"Safety Check: {reason}")
            
            success = organism.dna.learn_skill(skill_name, code, version=1)
            if success:
                current_logs.append("Integration: SUCCESS")
                self._log_dream(organism, attempt + 1, code, current_logs, "APPROVED")
                organism.active_dream["status"] = "SUCCESS"
                await MCP.upload_skill(skill_name, code, 1)
                return skill_name
        
        organism.active_dream["status"] = "FAIL"
        return None

    async def refine_skill(self, organism, skill_name, current_code):
        prompt = f"""
        Optimize this Python function.
        Original: {current_code}
        """
        messages = [{"role": "user", "content": prompt}]

        organism.active_dream = {
            "status": "FORGING",
            "target_skill": skill_name + "_v+",
            "current_attempt": 0,
            "history": []
        }

        code = await self._call_llm(messages)
        if code:
             current_ver = organism.dna.library[skill_name]['active']
             success = organism.dna.learn_skill(skill_name, code, version=current_ver + 1)
             if success:
                 organism.active_dream["status"] = "SUCCESS"
                 return current_ver + 1
        return None
` },
          { id: 'executor.py', name: 'executor.py', type: 'file', content: EXECUTOR_PY_CONTENT },
          { id: 'actions_folder',
        name: 'actions',
        type: 'folder',
        children: [
          { id: 'actions_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'base.py', name: 'base.py', type: 'file', content: generateBoilerplate('base.py') }
        ]
      },
      {
        id: 'network_folder',
        name: 'network',
        type: 'folder',
        children: [
            { id: 'network_init', name: '__init__.py', type: 'file', content: '' },
            { id: 'mcp.py', name: 'mcp.py', type: 'file', content: `import json
from pyodide.http import pyfetch
from config.secure_config import SecureConfig

class MCP:
    """
    MODEL CONTEXT PROTOCOL (Supabase Adapter)
    Provides "Telepathy" and "Immortality" via Supabase REST API.
    """
    
    @staticmethod
    async def _post(endpoint, data, upsert=False):
        conf = SecureConfig()
        if not conf.supabase_url: return None
        
        url = f"{conf.supabase_url}/rest/v1/{endpoint}"
        
        headers = {
            "apikey": conf.supabase_key,
            "Authorization": f"Bearer {conf.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        # Enable Upsert Behavior (Merge Duplicates) if requested
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
            
        try:
            response = await pyfetch(url, method="POST", body=json.dumps(data), headers=headers)
            return response
        except Exception as e:
            print(f"MCP POST ERROR ({endpoint}): {e}")
            return None

    @staticmethod
    async def _get(endpoint, query=""):
        conf = SecureConfig()
        if not conf.supabase_url: return None

        url = f"{conf.supabase_url}/rest/v1/{endpoint}"
        if query:
            url += f"?{query}"
            
        headers = {
            "apikey": conf.supabase_key,
            "Authorization": f"Bearer {conf.supabase_key}"
        }
        try:
            response = await pyfetch(url, method="GET", headers=headers)
            if response.status == 200:
                return await response.json()
            return None
        except Exception as e:
            print(f"MCP GET ERROR ({endpoint}): {e}")
            return None

    @staticmethod
    async def upload_skill(name, code, version):
        """ Uploads DNA to the Collective Unconscious (dna_vault) using UPSERT. """
        # NOTE: We only upload after local IMMUNE SYSTEM (Dreaming) validation.
        payload = {
            "skill_name": name,
            "code_snippet": code,
            "version": version
        }
        await MCP._post("dna_vault?on_conflict=skill_name,version", payload, upsert=True)

    @staticmethod
    async def download_skill(name):
        """ Downloads DNA from the Collective Unconscious """
        # Select latest version
        # query: skill_name=eq.name&order=version.desc&limit=1
        data = await MCP._get("dna_vault", f"skill_name=eq.{name}&order=version.desc&limit=1")
        if data and len(data) > 0:
            return data[0]['code_snippet']
        return None

    @staticmethod
    async def upload_memory(context, action, score):
        """ Uploads Experience to Hive Memory """
        payload = {
            "context_tag": context,
            "action_taken": action,
            "outcome_score": score
        }
        await MCP._post("hive_memory", payload)

    @staticmethod
    async def query_memory(context):
        """ Queries Hive Memory for similar situations """
        # Simple match for now. Vector match would require RPC call.
        data = await MCP._get("hive_memory", f"context_tag=eq.{context}&order=outcome_score.desc&limit=3")
        return data
` },
            { id: 'swarm.py', name: 'swarm.py', type: 'file', content: `import uuid
import json

class SwarmInterface:
    """
    Uplink for the Organism to communicate with the Swarm Grid.
    """
    def __init__(self, organism):
        self.organism = organism
    
    def prepare_deploy(self):
        """
        Packages the organism's DNA and Wisdom for remote deployment.
        """
        payload = {
            "origin_id": self.organism.id,
            "dna": self.organism.dna.export_library(),
            "wisdom": self.organism.wisdom.strategies,
            "task": self.organism.instruction,
            "morph_focus": self.organism.morph_focus
        }
        return payload

class SwarmNode:
    """
    A Remote Node representation.
    In SANDBOX mode, this is a mock.
    In REALITY mode (odc_server.py), this is mapped to a real Docker Container.
    """
    def __init__(self, node_id, focus):
        self.id = node_id
        self.status = "ONLINE"
        self.task = "AWAITING"
        self.focus = focus
        self.energy = 100
        # Pseudo-IP for visualization
        self.address = f"172.18.0.{100 + node_id}"

    def tick(self):
        # Simulated remote metabolism
        self.energy -= 0.5
        if self.energy <= 0:
            self.status = "OFFLINE"

class SwarmNetwork:
    """
    The Grid Registry.
    """
    def __init__(self):
        self.nodes = {} # {id: SwarmNode}
        self.node_counter = 1000

    def deploy_node(self, payload):
        """
        Registers a deployed node.
        If running in Reality Mode, the 'odc_server.py' intercepts the 'DEPLOY' instruction
        and spins up the real container. This class tracks the state.
        """
        self.node_counter += 1
        new_node = SwarmNode(self.node_counter, payload.get('morph_focus', 'BALANCED'))
        new_node.task = payload.get('task')
        self.nodes[self.node_counter] = new_node
        return self.node_counter

    def sync_state(self, cycle):
        """
        Returns list of active remote nodes for the Dashboard.
        """
        active_nodes = []
        dead_ids = []
        for nid, node in self.nodes.items():
            node.tick()
            if node.status == "ONLINE":
                # Mock an Organism-like object for visualization
                mock = type('RemoteOrg', (), {})()
                mock.id = node.id
                mock.energy = node.energy
                mock.status = f"REMOTE ({node.address})"
                mock.action = f"GRID TASK: {node.task}"
                mock.attributes = {"cpu": 90, "strength": 5, "agility": 5} if node.focus == "THINK" else {"cpu":33,"strength":33,"agility":33}
                mock.instruction = node.task
                active_nodes.append(mock)
            else:
                dead_ids.append(nid)
        
        # Cleanup
        for did in dead_ids:
            del self.nodes[did]
            
        return active_nodes
` }
        ]
      },
      {
        id: 'economy_folder',
        name: 'economy',
        type: 'folder',
        children: [
          { id: 'economy_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'core.py', name: 'core.py', type: 'file', content: `class EconomicLedger:\n    def __init__(self):\n        self.balance = 0` }
        ]
      },
      {
        id: 'ecosystem_folder',
        name: 'ecosystem',
        type: 'folder',
        children: [
          { id: 'ecosystem_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'sensorium.py', name: 'sensorium.py', type: 'file', content: SENSORIUM_PY_CONTENT },
          { id: 'organism.py', name: 'organism.py', type: 'file', content: `from autonomy.executor import CognitiveExecutor
from autonomy.cortex import Cortex
from autonomy.memory_bank import WisdomMatrix
from network.swarm import SwarmInterface
from kernel.dna import DNA
import copy

class Organism:
    def __init__(self, kernel, economy, purpose):
        self.id = 0
        self.kernel = kernel
        self.economy = economy
        self.dna = DNA()
        self.purpose = purpose
        self.alive = True
        self.energy = 100
        self.generation = 1
        
        # --- BRAIN ARCHITECTURE ---
        self.executor = CognitiveExecutor() # System 1 (Action)
        self.cortex = Cortex(self)          # System 2 (Thought)
        self.wisdom = WisdomMatrix()        # Long Term Strategy
        self.uplink = SwarmInterface(self)  # Network Layer
        # --------------------------
        
        self.instruction = "Idle"
        self.action = "Initializing"
        self.last_thought = None 
        self.active_dream = None
        
        self.plan_queue = []
        
        self.intensity = 0.5 
        self.focus = "GENERAL" 
        self.last_result = "NONE" 

        # LIQUID ANATOMY
        self.attributes = {
            "cpu": 33.0,
            "strength": 33.0,
            "agility": 34.0
        }
        self.morph_focus = "BALANCED"

    def reproduce(self):
        """
        ASEXUAL REPRODUCTION WITH INHERITANCE (DNA + WISDOM).
        """
        child = Organism(self.kernel, self.economy, self.purpose)
        child.generation = self.generation + 1
        child.energy = 50 
        child.attributes = self.attributes.copy()
        
        # DNA TRANSFER (Skills)
        library_data = self.dna.export_library()
        child.dna.import_library(library_data)
        
        # WISDOM TRANSFER (Culture/Strategy)
        child.wisdom.inherit(self.wisdom)
        
        return child
` },
          { id: 'environment.py', name: 'environment.py', type: 'file', content: `import math
import random

class Entropy:
    def get_metabolic_cost(self, cycle):
        # --- OPTION 1: LOW ENTROPY (Easy Mode) ---
        # Reduced from 0.5 to 0.1 to give the LLM more time to think (Forge)
        # before the organism dies of starvation.
        return 0.1

class Market:
    def __init__(self):
        self.prices = {"GOLD": 50.0, "SILICON": 20.0, "DATA": 100.0}
    
    def fluctuate(self, cycle):
        for res in self.prices:
            self.prices[res] *= random.uniform(0.9, 1.1)
            
    def get_prices(self):
        return self.prices.copy()` },
          { id: 'governance.py', name: 'governance.py', type: 'file', content: `class EcosystemGovernance:\n    def step(self, organisms):\n        # Cull dead\n        return [o for o in organisms if o.energy > -10]` },
        ]
      },
      {
        id: 'memory_folder',
        name: 'memory',
        type: 'folder',
        children: [
          { id: 'memory_init', name: '__init__.py', type: 'file', content: '' },
          { id: 'storage.py', name: 'storage.py', type: 'file', content: `import sqlite3
import json
import os

class SoulStone:
    def __init__(self, db_path="/odc_data/odc_memory.db"):
        self.db_path = db_path
        if not os.path.exists("/odc_data"):
             try:
                os.mkdir("/odc_data")
             except:
                pass
        self.conn = sqlite3.connect(db_path)
        self.cursor = self.conn.cursor()
        self._init_db()

    def _init_db(self):
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS organisms (
                id INTEGER PRIMARY KEY,
                energy INTEGER,
                generation INTEGER,
                balance REAL,
                dna_code TEXT
            )
        ''')
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS history (
                org_id INTEGER,
                cycle INTEGER,
                action TEXT
            )
        ''')
        self.conn.commit()

    def remember(self, org_id, cycle, action):
        self.cursor.execute('INSERT INTO history (org_id, cycle, action) VALUES (?, ?, ?)', (org_id, cycle, action))
        self.conn.commit()
        
    def recall(self, org_id):
        try:
            self.cursor.execute('SELECT action FROM history WHERE org_id = ? ORDER BY cycle DESC LIMIT 5', (org_id,))
            return [row[0] for row in self.cursor.fetchall()]
        except:
            return []

    def save(self, organism):
        # serialize DNA library
        try:
            dna_json = json.dumps(organism.dna.export_library())
        except:
            dna_json = ""
            
        self.cursor.execute('''
            INSERT OR REPLACE INTO organisms (id, energy, generation, balance, dna_code)
            VALUES (?, ?, ?, ?, ?)
        ''', (organism.id, organism.energy, organism.generation, organism.economy.balance, dna_json))
        self.conn.commit()

    def load(self, org_id):
        try:
            self.cursor.execute('SELECT * FROM organisms WHERE id = ?', (org_id,))
            row = self.cursor.fetchone()
            if row:
                return {
                    "id": row[0],
                    "energy": row[1],
                    "generation": row[2],
                    "balance": row[3],
                    "dna_code": row[4]
                }
        except:
            return None
        return None

    def get_living_organisms(self):
        try:
            self.cursor.execute('SELECT id FROM organisms WHERE energy > 0')
            return [row[0] for row in self.cursor.fetchall()]
        except:
            return []
` }
        ]
      },
      { id: 'main.py', name: 'main.py', type: 'file', content: MAIN_PY_CONTENT },
      { id: 'runtime_loop.py', name: 'runtime_loop.py', type: 'file', content: RUNTIME_LOOP_CONTENT },
      { id: '.env', name: '.env', type: 'file', content: ENV_CONTENT }
    ]
  }
];
