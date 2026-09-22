/// <reference lib="webworker" />

import { INITIAL_FILE_SYSTEM } from '../constants';
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.mjs";

let pyodide: any = null;
let isReady = false;

// Global driver states for keeping track
let currentCycle = 0;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    try {
      (self as any).api_proxy_url = self.location.origin + '/api/chat';
      (self as any).logForgeAnalytic = (phase: string, success: boolean) => {
        postMessage({ type: 'FORGE_ANALYTIC', payload: { phase, success } });
      };
      postMessage({ type: 'LOG', payload: { message: 'Initializing Python Runtime in Web Worker...', source: 'SYSTEM' } });
      
      postMessage({ type: 'LOG', payload: { message: 'Loading Pyodide...', source: 'SYSTEM' } });
      pyodide = await loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
        stdout: (text: string) => { postMessage({ type: 'LOG', payload: { message: text, source: 'PYTHON' } }); },
        stderr: (text: string) => { postMessage({ type: 'LOG', payload: { message: text, source: 'PYTHON_ERR' } }); }
      });
      
      postMessage({ type: 'LOG', payload: { message: 'Loading packages (micropip, sqlite3)...', source: 'SYSTEM' } });
      await pyodide.loadPackage(["micropip", "sqlite3"]);
      postMessage({ type: 'LOG', payload: { message: 'Loaded micropip, sqlite3', source: 'SYSTEM' }});
      
      // IDBFS is disabled to prevent infinite loading in restricted iframes
      postMessage({ type: 'LOG', payload: { message: 'Writing Initial FS...', source: 'SYSTEM' } });
      try { pyodide.FS.mkdir('/home/pyodide'); } catch(e) {}
      writeFileSystem(pyodide, INITIAL_FILE_SYSTEM, '/home/pyodide');
      if (payload) {
          pyodide.FS.writeFile('/secrets.json', JSON.stringify(payload));
      }
      
      postMessage({ type: 'LOG', payload: { message: 'Running driver code...', source: 'SYSTEM' } });      
      // Driver code exactly as from Simulation.tsx
      const driverCode = `
import sys
import random
import os
import asyncio
import json

project_path = '/home/pyodide/odc-cognitive-ecosystem'

if os.path.exists(project_path):
    if project_path not in sys.path:
        sys.path.append(project_path)
else:
    print(f"SYSTEM ERROR: Path not found! CWD is {os.getcwd()}")

try:
    from config.secure_config import SecureConfig
    from economy.core import EconomicLedger
    from kernel.odc import ODCKernel
    from ecosystem.organism import Organism
    from ecosystem.governance import EcosystemGovernance
    from ecosystem.environment import Entropy, Market
    from ecosystem.sensorium import Sensorium
    from memory.storage import SoulStone
    from network.swarm import SwarmNetwork
    from network.mcp import MCP
    import main 
except ImportError as e:
    print(f"SYSTEM CRITICAL IMPORT ERROR: {e}")
    raise e

# Global State
organisms = []
governance = None
soul_stone = None
entropy = None
market = None
swarm = None
sensorium = None
cycle_count = 0

async def init_system():
    print("PYTHON: init_system started")
    global organisms, governance, cycle_count, soul_stone, entropy, market, swarm, sensorium
    cycle_count = 0
    print("PYTHON: SecureConfig init")
    config = SecureConfig()
    
    organisms = []
    print("PYTHON: SoulStone init")
    soul_stone = SoulStone()
    print("PYTHON: Entropy init")
    entropy = Entropy()
    market = Market()
    swarm = SwarmNetwork()
    sensorium = Sensorium() 
    
    print("PYTHON: get_living_organisms")
    existing_ids = soul_stone.get_living_organisms()
    ledger = EconomicLedger()
    kernel = ODCKernel(ledger, entropy, market, sensorium)
    
    if existing_ids and len(existing_ids) > 0:
        print(f"Resurrecting {len(existing_ids)} organisms...")
        for org_id in existing_ids:
            data = soul_stone.load(org_id)
            if data:
                org = Organism(kernel=kernel, economy=ledger, purpose="Adapt")
                org.id = data['id']
                org.energy = data['energy']
                org.generation = data['generation']
                org.economy.balance = data['balance']
                
                from autonomy.executor import CognitiveExecutor
                org.executor = CognitiveExecutor()
                
                if data['dna_code']:
                    try:
                        org.dna.import_library(json.loads(data['dna_code']))
                    except:
                        pass
                organisms.append(org)
    else:
        organism = Organism(kernel=kernel, economy=ledger, purpose="Adapt")
        organism.id = 1
        soul_stone.save(organism)
        organisms.append(organism)

    governance = EcosystemGovernance()
    return f"Initialized {len(organisms)} organisms."

def set_global_instruction(text):
    main.GLOBAL_INSTRUCTION = text
    return True

async def step(current_cycle_input):
    global organisms, governance, cycle_count, soul_stone, entropy, market, swarm, sensorium
    
    cycle_count = current_cycle_input
    market.fluctuate(cycle_count)
    
    sensorium.perceive() 
    remote_nodes = swarm.sync_state(cycle_count)
    new_borns = []
    
    for org in organisms:
        if getattr(org, 'alive', True):
            org.instruction = main.GLOBAL_INSTRUCTION
            org.kernel.apply_metabolism(org, cycle_count)
            
            if hasattr(org, 'executor'):
                history = soul_stone.recall(org.id)
                swarm_context = {"nodes": len(organisms) + len(remote_nodes)}
                env_context = sensorium.get_data()
                await org.executor.deliberate(org, cycle_count, market.get_prices(), history, swarm_context, env_context)
            
            # Repro
            if org.energy > 200 and org.attributes.get('cpu', 0) < 60:
                child = org.reproduce()
                if child:
                    existing_ids = [o.id for o in organisms] + [o.id for o in new_borns]
                    child.id = (max(existing_ids) if existing_ids else 0) + 1
                    new_borns.append(child)
                    org.energy -= 100 
                    org.action = f"MITOSIS -> {child.id}"
                    soul_stone.save(org)

            # Persist
            if soul_stone:
                if cycle_count % 50 == 0:
                    soul_stone.save(org)
                if hasattr(org, 'action') and org.action != "IDLE":
                     soul_stone.remember(org.id, cycle_count, org.action)
            
            if not hasattr(org, 'action'):
                org.action = "IDLE"

    if new_borns:
        for baby in new_borns:
            soul_stone.save(baby)
        organisms.extend(new_borns)
        
    organisms = governance.step(organisms)
    
    state = []
    for org in organisms:
        state.append({
            "id": getattr(org, 'id', 0),
            "energy": getattr(org, 'energy', 0),
            "status": "ALIVE" if getattr(org, 'alive', True) else "DEAD",
            "action": getattr(org, 'action', "Processing"),
            "instruction": getattr(org, 'instruction', ""),
            "attributes": getattr(org, 'attributes', {}),
            "is_remote": False
        })
        
    mind_state = { "dna_library": {}, "last_thought": None, "active_dream": None, "plan_queue": [] }
    if organisms and len(organisms) > 0:
        main_org = organisms[0]
        if hasattr(main_org, 'dna'):
             for k, v in main_org.dna.library.items():
                 mind_state["dna_library"][k] = v.get('active', 1)
        if hasattr(main_org, 'last_thought'):
             mind_state["last_thought"] = main_org.last_thought
        if hasattr(main_org, 'active_dream'):
             mind_state["active_dream"] = main_org.active_dream
        if hasattr(main_org, 'plan_queue') and main_org.plan_queue:
             try: mind_state["plan_queue"] = [dict(step) for step in main_org.plan_queue]
             except: pass
        
    return {"organisms": state, "mind_state": mind_state}
`;

      await pyodide.runPythonAsync(driverCode);
      
      postMessage({ type: 'LOG', payload: { message: 'Running init_system...', source: 'SYSTEM' } });
      const res = await pyodide.runPythonAsync("await init_system()");
      postMessage({ type: 'LOG', payload: { message: `init_system result: ${res}`, source: 'SYSTEM' } });
      
      postMessage({ type: 'LOG', payload: { message: 'Running initial step(0)...', source: 'SYSTEM' } });
      const payloadProxy = await pyodide.runPythonAsync("await step(0)");
      const resultObj = payloadProxy.toJs({ dict_converter: Object.fromEntries });
      payloadProxy.destroy();

      postMessage({ type: 'LOG', payload: { message: 'Initialization complete.', source: 'SYSTEM' } });
      isReady = true;
      postMessage({ type: 'INIT_COMPLETE', payload: resultObj });

    } catch (err: any) {
      postMessage({ type: 'ERROR', payload: err.message || err.toString() });
    }
  }

  else if (type === 'SECRETS') {
      if (!pyodide) return;
      pyodide.FS.writeFile('/secrets.json', JSON.stringify(payload));
  }
  
  else if (type === 'INSTRUCTION') {
      if (!isReady || !pyodide) return;
      try { pyodide.runPython(`set_global_instruction("${payload}")`); } catch(e) {}
  }

  else if (type === 'STEP') {
    if (!isReady || !pyodide) return;
    try {
      const cycle = payload.cycle;
      if (payload.sensorData) {
          pyodide.FS.writeFile('/sensor_data.json', JSON.stringify(payload.sensorData));
      }

      const payloadProxy = await pyodide.runPythonAsync(`await step(${cycle})`);
      const resultObj = payloadProxy.toJs({ dict_converter: Object.fromEntries });
      payloadProxy.destroy();

      // FS Sync disabled because IDBFS is disabled

      postMessage({ type: 'STEP_COMPLETE', payload: { ...resultObj, cycle } });
    } catch (err: any) {
      postMessage({ type: 'ERROR', payload: `Execution Error: ${err.message}` });
    }
  }
};

function writeFileSystem(py: any, nodes: any[], parentPath: string = '/home/pyodide') {
    nodes.forEach(node => {
      const path = `${parentPath}/${node.name}`;
      if (node.type === 'folder') {
        try { py.FS.mkdir(path); } catch (e) {}
        if (node.children) {
          writeFileSystem(py, node.children, path);
        }
      } else if (node.type === 'file' && node.content !== undefined) {
        try { py.FS.writeFile(path, node.content); } catch (e) {}
      }
    });
}
