
import React, { useEffect, useState, useRef } from 'react';
import { Play, Pause, RefreshCw, Activity, Terminal as TerminalIcon, Send, Sparkles, Server, Globe, Cloud, Network, AlertTriangle } from 'lucide-react';
import { EcosystemLog, OrganismState, SimulationMode, MindState, SystemConfig } from '../types';
import { INITIAL_FILE_SYSTEM } from '../constants';

// Declare global pyodide type and Navigator extensions
declare global {
  interface Window {
    loadPyodide: (config: any) => Promise<any>;
  }
  interface Navigator {
    connection?: any;
    getBattery?: () => Promise<any>;
  }
}

interface SimulationProps {
  isActive: boolean;
  config: SystemConfig;
  onMindUpdate?: (state: MindState) => void;
}

const Simulation: React.FC<SimulationProps> = ({ isActive, config, onMindUpdate }) => {
  // Mode State
  const [mode, setMode] = useState<SimulationMode>(SimulationMode.BROWSER);
  
  // Browser (Pyodide) State
  const [pyodide, setPyodide] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  
  // Local Kernel (WebSocket) State
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Shared State
  const [isRunning, setIsRunning] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [organisms, setOrganisms] = useState<OrganismState[]>([]);
  const [logs, setLogs] = useState<EcosystemLog[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Instruction State
  const [prompt, setPrompt] = useState("");
  const [currentInstruction, setCurrentInstruction] = useState("Survive and Prosper");
  
  // Sensor State Cache
  const [sensorData, setSensorData] = useState<any>({
      location: null,
      battery: null,
      network: null,
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown'
  });
  
  // Ref to track if we've initialized to prevent double-init in StrictMode
  const initialized = useRef(false);
  
  // Lock for file system sync operations
  const isSyncing = useRef(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, source: EcosystemLog['source']) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, source }].slice(-50));
  };

  // --- SENSORIUM: REAL WORLD DATA COLLECTION ---
  const gatherRealWorldData = async () => {
    const data: any = {
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        cores: navigator.hardwareConcurrency || 1,
    };

    // 1. Battery
    try {
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            data.battery = {
                level: battery.level, // 0.0 to 1.0
                charging: battery.charging
            };
        }
    } catch (e) {}

    // 2. Network (Experimental)
    try {
        if (navigator.connection) {
            data.network = {
                type: navigator.connection.effectiveType, // '4g', '3g', etc
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt
            };
        }
    } catch (e) {}

    // 3. Geolocation (Only if permitted, non-blocking)
    // We update this asynchronously via state, here we just read the cached state if needed
    // or we assume the geolocation hook handles it.
    if (sensorData.location) {
        data.location = sensorData.location;
    }

    return data;
  };

  // Geolocation Effect
  useEffect(() => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setSensorData((prev: any) => ({
                    ...prev, 
                    location: { lat: pos.coords.latitude, lng: pos.coords.longitude }
                }));
            }, 
            (err) => {
                // Permission denied or error, ignore silent
            }
        );
    }
  }, []);

  // --- BROWSER MODE: FILESYSTEM HELPERS ---

  const safeSyncFS = async (py: any) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    
    return new Promise<void>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                isSyncing.current = false;
                console.warn("FS Sync Timeout");
                resolve();
            }
        }, 3000);

        try {
            py.FS.syncfs(false, (err: any) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                isSyncing.current = false;
                if (err) {
                    console.error("FS Sync Error:", err);
                }
                resolve();
            });
        } catch (e) {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            console.error("FS Sync Exception:", e);
            isSyncing.current = false;
            resolve();
        }
    });
  };

  const writeFileSystem = (py: any, nodes: any[], parentPath: string = '/home/pyodide') => {
    nodes.forEach(node => {
      // Use explicit absolute paths to avoid confusion
      const path = `${parentPath}/${node.name}`;
      
      if (node.type === 'folder') {
        try {
          py.FS.mkdir(path);
        } catch (e) {
          // Folder might exist, ignore
        }
        if (node.children) {
          writeFileSystem(py, node.children, path);
        }
      } else if (node.type === 'file' && node.content !== undefined) {
        try {
            py.FS.writeFile(path, node.content);
        } catch (e) {
            console.error(`Failed to write file ${path}:`, e);
        }
      }
    });
  };
  
  // --- SECRET INJECTION ---
  const updateSecrets = async (py: any, cfg: SystemConfig) => {
      if (!py) return;
      try {
        const secrets = JSON.stringify({
            NVIDIA_API_KEY: cfg.nvidiaApiKey,
            SUPABASE_URL: cfg.supabaseUrl,
            SUPABASE_KEY: cfg.supabaseKey,
            MARKET_ENDPOINT: "https://api.market-data.com/v1"
        });
        
        py.FS.writeFile('/secrets.json', secrets);
        addLog('System Configuration Updated (Secrets Injected).', 'SYSTEM');
        await py.runPythonAsync("await init_system()");
        
      } catch (e: any) {
          addLog(`Config Update Failed: ${e.message}`, 'SYSTEM');
      }
  };
  
  useEffect(() => {
      if (isReady && pyodide) {
          updateSecrets(pyodide, config);
      }
  }, [config, isReady, pyodide]);

  // --- FETCH SKILL SOURCE CODE ---
  const fetchSkillSource = async (skillName: string) => {
    if (mode === SimulationMode.BROWSER && pyodide) {
        try {
           const code = await pyodide.runPythonAsync(`
skill = organisms[0].dna.get_skill_source("${skillName}")
skill if skill else "No source found"
           `);
           return code;
        } catch (e) {
            return "Error retrieving DNA source.";
        }
    }
    return "Source viewing only available in Sandbox Mode currently.";
  };

  // --- INITIALIZATION ---

  useEffect(() => {
    async function initPython() {
      if (initialized.current) return;
      initialized.current = true;

      try {
        addLog('Initializing Python Runtime (Pyodide)...', 'SYSTEM');
        const pyPromise = window.loadPyodide({
          indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/"
        });
        const pyTimeout = new Promise<any>((_, reject) => 
            setTimeout(() => reject(new Error("Pyodide Download Timeout")), 30000)
        );
        const py = await Promise.race([pyPromise, pyTimeout]);
        
        const pkgPromise = py.loadPackage(["micropip", "sqlite3"]);
        const pkgTimeout = new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error("Package Download Timeout")), 30000)
        );
        await Promise.race([pkgPromise, pkgTimeout]);
        addLog('Loading dependencies (micropip, sqlite3)...', 'SYSTEM');
        
        addLog('Mounting Persistent Storage (IndexedDB)...', 'SYSTEM');
        try { py.FS.mkdir('/odc_data'); } catch(e) {}
        try {
            py.FS.mount(py.FS.filesystems.IDBFS, {}, '/odc_data');
            await new Promise<void>((resolve) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        addLog('Storage Sync Timeout. Proceeding without persistent storage.', 'SYSTEM');
                        resolve();
                    }
                }, 3000);

                py.FS.syncfs(true, (err: any) => {
                    if (resolved) return;
                    resolved = true;
                    clearTimeout(timeout);
                    if (err) {
                        addLog(`Storage Sync Error: ${err}. Proceeding without persistence.`, 'SYSTEM');
                    } else {
                        addLog('Storage Synchronized.', 'SYSTEM');
                    }
                    resolve();
                });
            });
        } catch (e) {
            addLog(`IDBFS Mount Error: ${e}. Proceeding without persistence.`, 'SYSTEM');
        }
        
        addLog('Mounting ODC File System...', 'SYSTEM');
        try { py.FS.mkdir('/home/pyodide'); } catch(e) {}
        
        writeFileSystem(py, INITIAL_FILE_SYSTEM, '/home/pyodide');
        
        // Initial Secret Write
        const secrets = JSON.stringify({
            NVIDIA_API_KEY: config.nvidiaApiKey,
            SUPABASE_URL: config.supabaseUrl,
            SUPABASE_KEY: config.supabaseKey,
            MARKET_ENDPOINT: "https://api.market-data.com/v1"
        });
        py.FS.writeFile('/secrets.json', secrets);

        // --- PRE-LOAD DRIVER CODE ---
        addLog('Loading ODC Kernel Drivers...', 'SYSTEM');
        
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
    global organisms, governance, cycle_count, soul_stone, entropy, market, swarm, sensorium
    cycle_count = 0
    config = SecureConfig()
    
    if not config.api_key:
        print("SYSTEM CHECK: Failed to load API Key. Check /secrets.json")
    
    organisms = []
    
    soul_stone = SoulStone()
    entropy = Entropy()
    market = Market()
    swarm = SwarmNetwork()
    sensorium = Sensorium() # Initialize Real World Sensors
    
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
        # Genesis
        organism = Organism(
            kernel=kernel,
            economy=ledger,
            purpose="Adapt"
        )
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
    
    # 1. READ REAL WORLD DATA
    sensorium.perceive() 
    
    # Sync Swarm State
    remote_nodes = swarm.sync_state(cycle_count)
    
    new_borns = []
    
    for org in organisms:
        if getattr(org, 'alive', True):
            org.instruction = main.GLOBAL_INSTRUCTION
            
            # Metabolism (Now affected by Sensorium Battery data)
            org.kernel.apply_metabolism(org, cycle_count)
            
            # Cognition
            if hasattr(org, 'executor'):
                history = soul_stone.recall(org.id)
                swarm_context = {"nodes": len(organisms) + len(remote_nodes)}
                # Pass sensor data to the brain
                env_context = sensorium.get_data()
                await org.executor.deliberate(org, cycle_count, market.get_prices(), history, swarm_context, env_context)
            
            # Reproduction Strategy
            
            # A) Local Mitose
            if org.energy > 200 and org.attributes.get('cpu', 0) < 60:
                child = org.reproduce()
                if child:
                    existing_ids = [o.id for o in organisms] + [o.id for o in new_borns]
                    child.id = (max(existing_ids) if existing_ids else 0) + 1
                    new_borns.append(child)
                    org.energy -= 100 
                    org.action = f"MITOSIS -> {child.id}"
                    soul_stone.save(org)

            # B) Network Deployment
            elif org.energy > 150 and org.attributes.get('cpu', 0) >= 60:
                 if "DEPLOY" in org.action or "EXPAND" in org.instruction.upper():
                    deployment_packet = org.uplink.prepare_deploy()
                    if deployment_packet:
                        node_id = swarm.deploy_node(deployment_packet)
                        org.energy -= 120 
                        org.action = f"UPLINK -> NODE_{node_id}"
                        await MCP.upload_memory(f"DEPLOYMENT_EVENT", f"Node_{node_id} deployed", 10)
                        print(f"NETWORK: Node {node_id} deployed to Cloud Grid.")
            
            # Persistence
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
        
    for node in remote_nodes:
        state.append({
            "id": getattr(node, 'id', 0),
            "energy": getattr(node, 'energy', 0),
            "status": getattr(node, 'status', "REMOTE"),
            "action": getattr(node, 'action', "COMPUTING"),
            "instruction": getattr(node, 'instruction', ""),
            "attributes": getattr(node, 'attributes', {}),
            "is_remote": True
        })
        
    mind_state = {
        "dna_library": {},
        "last_thought": None,
        "active_dream": None,
        "plan_queue": []
    }
    
    if organisms and len(organisms) > 0:
        main_org = organisms[0]
        if hasattr(main_org, 'dna'):
             for k, v in main_org.dna.library.items():
                 mind_state["dna_library"][k] = v.get('active', 1)
        if hasattr(main_org, 'last_thought'):
             mind_state["last_thought"] = main_org.last_thought
        if hasattr(main_org, 'active_dream'):
             mind_state["active_dream"] = main_org.active_dream
        if hasattr(main_org, 'plan_queue'):
             mind_state["plan_queue"] = main_org.plan_queue
        
    return {"organisms": state, "mind_state": mind_state}
`;
      
        // Run driver code with timeout
        const runPromise = py.runPythonAsync(driverCode);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Python Kernel Initialization Timeout")), 15000)
        );
        await Promise.race([runPromise, timeoutPromise]);

        (window as any).getSkillSource = async (name: string) => {
            return await fetchSkillSource(name);
        };

        setPyodide(py);
        setIsReady(true);
        setIsLoading(false);
        setInitError(null);
        addLog('Environment Ready. Swarm Network Initialized.', 'SYSTEM');

      } catch (error: any) {
        const errMsg = error.message || "Unknown Initialization Error";
        addLog(`Critical Error: ${errMsg}`, 'SYSTEM');
        setInitError(errMsg);
        setIsLoading(false);
      }
    }

    initPython();
  }, []);

  const handleModeChange = (newMode: SimulationMode) => {
    setIsRunning(false);
    setMode(newMode);
    
    if (newMode === SimulationMode.LOCAL) {
        addLog('Initiating NEURO-LINK Protocol...', 'NETWORK');
        addLog('Attempting to connect to ws://localhost:8000/ws ...', 'NETWORK');
        connectWebSocket();
    } else {
        if (socket) {
            socket.close();
            setSocket(null);
        }
        setIsConnected(false);
        addLog('Returned to Sandbox Mode.', 'SYSTEM');
    }
  };

  const connectWebSocket = () => {
    try {
        const ws = new WebSocket('ws://localhost:8000/ws');
        ws.onopen = () => {
            addLog('NEURO-LINK ESTABLISHED. Connected to Reality Bridge.', 'NETWORK');
            setIsConnected(true);
        };
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'STATE_UPDATE') {
                    setOrganisms(data.payload);
                    if (data.payload[0]) setCycle(data.payload[0].cycle);
                    const serverStatus = data.payload[0]?.status;
                    if (serverStatus === "PAUSED" && isRunning) setIsRunning(false);
                    if (data.logs) addLog(data.logs, 'NETWORK');
                } else if (data.type === 'LOG') {
                    addLog(data.payload, 'NETWORK');
                }
            } catch (e) {
                console.error("Malformed WS Message", e);
            }
        };
        ws.onclose = () => {
            addLog('NEURO-LINK DROPPED. Is odc_server.py running?', 'NETWORK');
            setIsConnected(false);
            setIsRunning(false);
        };
        ws.onerror = () => {
             addLog('Connection Error. Ensure Local Server is active.', 'NETWORK');
        };
        setSocket(ws);
    } catch (e) {
        addLog(`WebSocket Error: ${e}`, 'NETWORK');
    }
  };

  // --- RUNTIME LOOP (BROWSER MODE) ---
  const setupBrowserSimulation = async () => {
    if (!pyodide) return;
    try {
      addLog('Booting ODC Kernel v5.5 (Browser Sandbox)...', 'SYSTEM');
      const result = await pyodide.runPythonAsync("await init_system()");
      addLog(result, 'SYSTEM');
      
      const payloadProxy = await pyodide.runPythonAsync("await step(0)");
      const payload = payloadProxy.toJs({ dict_converter: Object.fromEntries });
      payloadProxy.destroy();
      
      await safeSyncFS(pyodide);
      setOrganisms(payload.organisms);
      setCycle(0);
      
      if (onMindUpdate && payload.mind_state) {
          onMindUpdate(payload.mind_state);
      }
      
    } catch (e: any) {
      addLog(`Runtime Error: ${e.message}`, 'SYSTEM');
      setIsRunning(false);
    }
  };

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    if (mode === SimulationMode.BROWSER && isRunning && pyodide && isReady) {
      intervalId = setInterval(async () => {
        try {
          const nextCycle = cycle + 1;
          
          // 1. GATHER REAL SENSORS
          const sensors = await gatherRealWorldData();
          // 2. INJECT INTO VIRTUAL FS
          try {
              pyodide.FS.writeFile('/sensor_data.json', JSON.stringify(sensors));
          } catch(e) { console.error("Sensor Inject Fail", e); }
          
          // 3. STEP
          const payloadProxy = await pyodide.runPythonAsync(`await step(${nextCycle})`);
          const payload = payloadProxy.toJs({ dict_converter: Object.fromEntries });
          payloadProxy.destroy();
          await safeSyncFS(pyodide);
          
          setOrganisms(payload.organisms);
          setCycle(nextCycle);
          
          if (onMindUpdate && payload.mind_state) {
            onMindUpdate(payload.mind_state);
          }

        } catch (e: any) {
          addLog(`Execution Error: ${e.message}`, 'SYSTEM');
          setIsRunning(false);
        }
      }, 3000); 
    }

    return () => clearInterval(intervalId);
  }, [isRunning, pyodide, isReady, cycle, mode, sensorData]); // Added sensorData dependency to ensure fresh location

  const handleToggleRun = async () => {
    if (mode === SimulationMode.BROWSER) {
        if (!isRunning && cycle === 0) {
          await setupBrowserSimulation();
        }
        setIsRunning(!isRunning);
    } else {
        if (!isConnected) {
            connectWebSocket();
        } else if (socket) {
            const cmd = isRunning ? "STOP" : "START";
            addLog(`SENDING SYS_CONTROL: ${cmd}`, 'SYSTEM');
            socket.send(JSON.stringify({ type: "SYSTEM_CONTROL", payload: cmd }));
            setIsRunning(!isRunning);
        }
    }
  };

  const handleReset = async () => {
    setIsRunning(false);
    setCycle(0);
    setOrganisms([]);
    setLogs([]);
    
    if (mode === SimulationMode.BROWSER && pyodide) {
        try {
            pyodide.runPython("import os; os.remove('/odc_data/odc_memory.db')");
            await safeSyncFS(pyodide);
            addLog('Persistence Layer Wiped.', 'SYSTEM');
        } catch(e) {}
    } else if (mode === SimulationMode.LOCAL && socket && isConnected) {
        addLog('SENDING SYS_CONTROL: RESET', 'SYSTEM');
        socket.send(JSON.stringify({ type: "SYSTEM_CONTROL", payload: "RESET" }));
    }
    
    addLog('System Reset.', 'SYSTEM');
  };

  const handleSendInstruction = async () => {
      if(!prompt.trim()) return;
      const instruction = prompt.trim();
      setCurrentInstruction(instruction);
      setPrompt("");
      
      addLog(`COMMAND: ${instruction}`, 'GOVERNANCE');

      if (mode === SimulationMode.BROWSER && pyodide) {
           try {
              pyodide.runPython(`set_global_instruction("${instruction}")`);
          } catch(e) { console.error(e); }
      } else if (mode === SimulationMode.LOCAL && socket && isConnected) {
          socket.send(JSON.stringify({ type: "INSTRUCTION", payload: instruction }));
      } else {
          addLog("Instruction ignored: Not connected or system offline.", 'SYSTEM');
      }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-odc-bg text-odc-accent flex-col gap-4">
        <Activity className="animate-spin" size={48} />
        <div className="font-mono">Loading Python Runtime & IDBFS...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-odc-bg text-odc-text p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
            <h2 className="text-xl md:text-2xl font-bold font-mono text-odc-accent flex items-center gap-2">
                <TerminalIcon className="" />
                ODC LIQUID KERNEL
            </h2>
            <p className="text-odc-muted text-xs md:text-sm mt-1 flex items-center gap-2">
               v6.2 Hive Mind (Sensorium Active):
               <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${mode === SimulationMode.BROWSER ? 'bg-blue-900/50 text-blue-300' : 'bg-red-900/50 text-red-300 animate-pulse'}`}>
                   {mode === SimulationMode.BROWSER ? 'Browser Sandbox' : 'Local Neuro-Link'}
               </span>
            </p>
        </div>
        
        {/* CONTROLS */}
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <div className="flex bg-black/20 p-1 rounded-lg self-start">
             <button 
                onClick={() => handleModeChange(SimulationMode.BROWSER)}
                className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-2 transition-all ${mode === SimulationMode.BROWSER ? 'bg-odc-accent/20 text-odc-accent' : 'text-odc-muted hover:text-white'}`}
             >
                <Globe size={14} /> Sandbox
             </button>
             <button 
                onClick={() => handleModeChange(SimulationMode.LOCAL)}
                className={`px-3 py-1.5 rounded text-xs font-mono flex items-center gap-2 transition-all ${mode === SimulationMode.LOCAL ? 'bg-red-500/20 text-red-400' : 'text-odc-muted hover:text-white'}`}
             >
                <Server size={14} /> Reality
             </button>
          </div>

          <div className="flex gap-2">
            <button
                disabled={(!isReady && mode === SimulationMode.BROWSER) || (mode === SimulationMode.LOCAL && !isConnected)}
                onClick={handleToggleRun}
                className={`flex-1 md:flex-none justify-center flex items-center gap-2 px-4 py-2 rounded font-semibold transition-all ${
                (!isReady && mode === SimulationMode.BROWSER) || (mode === SimulationMode.LOCAL && !isConnected) ? 'opacity-50 cursor-not-allowed bg-gray-700' :
                isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                }`}
            >
                {isRunning ? <><Pause size={18} /> PAUSE</> : <><Play size={18} /> {mode === SimulationMode.LOCAL ? 'LINK' : 'START'}</>}
            </button>
            <button
                onClick={handleReset}
                className="flex-1 md:flex-none justify-center flex items-center gap-2 px-4 py-2 rounded bg-white/5 hover:bg-white/10 text-odc-text transition-all"
            >
                <RefreshCw size={18} />
            </button>
          </div>
        </div>
      </div>
      
      {/* INIT ERROR ALERT */}
      {initError && (
          <div className="mb-4 bg-red-900/30 border border-red-500/50 p-4 rounded flex items-center gap-4 text-red-200 animate-in slide-in-from-top-2">
              <AlertTriangle className="text-red-500 shrink-0" size={24} />
              <div className="flex-1">
                  <h3 className="font-bold text-sm uppercase mb-1">Initialization Failed</h3>
                  <p className="text-xs font-mono">{initError}</p>
                  <p className="text-xs mt-2 text-odc-muted">Try checking your internet connection or updating the configuration keys.</p>
              </div>
          </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 min-h-0">
        {/* LEFT COLUMN: Visualizer & Controls */}
        <div className="flex flex-col gap-4 h-full min-h-0">
            {/* Prompt Interface */}
            <div className="bg-odc-panel rounded-lg border border-white/10 p-4 shrink-0">
                <div className="text-xs font-mono opacity-50 mb-2 uppercase flex items-center gap-2">
                    <Sparkles size={12} /> 
                    {mode === SimulationMode.LOCAL ? 'REALITY INJECTION PROTOCOL' : 'Liquid Instruction Interface'}
                </div>
                <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={mode === SimulationMode.LOCAL ? "DANGER: Enter shell command or reality directive..." : "Try: 'Expand the swarm' or 'Hunt for resources'..."}
                        className={`flex-1 bg-black/40 border rounded px-3 py-2 text-sm focus:outline-none text-odc-text placeholder-odc-muted font-mono transition-colors ${
                            mode === SimulationMode.LOCAL ? 'border-red-900 focus:border-red-500' : 'border-white/10 focus:border-odc-accent'
                        }`}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendInstruction()}
                    />
                    <button 
                        onClick={handleSendInstruction}
                        className={`p-2 rounded border transition-colors ${
                            mode === SimulationMode.LOCAL ? 'bg-red-900/20 text-red-400 border-red-900' : 'bg-odc-accent/20 text-odc-accent border-odc-accent/30'
                        }`}
                    >
                        <Send size={18} />
                    </button>
                </div>
                <div className="mt-2 text-xs text-odc-muted truncate flex justify-between">
                    <span>Directive: <span className="text-purple-400 font-mono">"{currentInstruction}"</span></span>
                    {mode === SimulationMode.LOCAL && (
                        <span className="text-red-500 font-bold">
                            {isConnected ? "LINKED" : "OFFLINE"}
                        </span>
                    )}
                </div>
            </div>

            {/* Organism View */}
            <div className="bg-odc-panel rounded-lg border border-white/10 p-4 flex-1 overflow-y-auto relative min-h-[200px]">
                <div className="absolute top-0 right-0 p-2 text-xs font-mono opacity-30 flex items-center gap-1">
                    <Network size={10} />
                    ENTITY.VIEWER
                </div>
                
                {organisms.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-odc-muted italic opacity-50 gap-2">
                        {mode === SimulationMode.LOCAL && !isConnected ? (
                            <>
                                <Server size={32} className="opacity-50" />
                                <p>Waiting for Neuro-Link...</p>
                                <p className="text-[10px] text-red-400">Run 'python odc_server.py' locally</p>
                            </>
                        ) : (
                            "Awaiting initialization..."
                        )}
                    </div>
                )}

                {organisms.map(org => {
                    const idStr = org && org.id !== undefined ? String(org.id) : '?';
                    const status = org?.status || 'UNKNOWN';
                    const energy = org?.energy || 0;
                    const action = org?.action || 'No action';
                    const attributes = (org?.attributes || {}) as Record<string, number>;
                    const isRemote = org?.is_remote || false;

                    const isForging = action.includes("FORGING") || action.includes("PROCESSING");
                    const isError = action.includes("ERROR") || action.includes("FAILED");
                    const isPaused = status === 'PAUSED';

                    return (
                    <div key={idStr} className={`p-4 rounded border transition-all duration-500 mb-4 ${
                        isError 
                        ? 'border-red-900 bg-red-900/10' 
                        : isPaused
                        ? 'border-gray-500/30 bg-gray-500/5 opacity-70'
                        : isRemote ? 'border-cyan-500/40 bg-cyan-900/10'
                        : isForging ? 'border-purple-500 bg-purple-500/10'
                        : 'border-odc-accent/30 bg-odc-accent/5'
                    }`}>
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${status === 'ALIVE' || status === 'RUNNING' || status.includes('REMOTE') ? 'bg-green-500 shadow-[0_0_10px_rgba(74,222,128,0.5)]' : isPaused ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
                                <span className={`font-bold font-mono ${isRemote ? 'text-cyan-300' : 'text-odc-text'}`}>
                                    {isRemote ? `SWARM_NODE_${idStr}` : `ODC_INSTANCE_${idStr.padStart(2, '0')}`}
                                </span>
                                {isRemote && <Cloud size={14} className="text-cyan-400" />}
                            </div>
                            <span className="text-xs font-mono px-2 py-1 rounded bg-black/20">{status}</span>
                        </div>

                        <div className="space-y-4">
                            {/* Energy Bar */}
                            <div>
                                <div className="flex justify-between text-xs mb-1 text-odc-muted">
                                    <span>METABOLIC RESERVE</span>
                                    <span className={energy < 20 ? 'text-red-400 font-bold' : ''}>{energy.toFixed(1)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full transition-all duration-300 ${isRemote ? 'bg-cyan-500' : isForging ? 'bg-purple-500' : 'bg-gradient-to-r from-blue-500 to-odc-accent'}`}
                                        style={{ width: `${Math.max(0, energy)}%` }}
                                    ></div>
                                </div>
                            </div>

                            {/* Action Monitor */}
                            <div className={`bg-black/20 p-2 rounded border-l-2 ${isRemote ? 'border-cyan-500' : isForging ? 'border-purple-500' : 'border-odc-accent'}`}>
                                <span className="block text-odc-muted mb-1 text-[10px] uppercase">{isRemote ? 'Swarm Task' : 'Kernel Operation'}</span>
                                <span className={`font-mono text-sm ${isForging ? 'text-purple-300 animate-pulse' : 'text-odc-text'} break-all`}>{action}</span>
                            </div>

                            {/* Attributes Visualization (Liquid Shape) */}
                            <div>
                                <span className="block text-odc-muted mb-2 text-[10px] uppercase border-b border-white/5 pb-1">Current Morphological State</span>
                                <div className="grid grid-cols-3 gap-2">
                                    {Object.entries(attributes).length === 0 ? (
                                         <div className="col-span-3 text-xs text-odc-muted italic">Formless (Base State)</div>
                                    ) : (
                                        Object.entries(attributes).map(([key, val]) => (
                                            <div key={key} className="bg-white/5 rounded p-1.5 flex flex-col items-center">
                                                <span className="text-[10px] font-mono text-odc-muted uppercase mb-1">{key}</span>
                                                <div className="w-full h-1 bg-black/50 rounded-full mb-1">
                                                    <div 
                                                        className={`h-full rounded-full transition-all duration-1000 ${isRemote ? 'bg-cyan-400' : 'bg-odc-accent'}`}
                                                        style={{ width: `${Math.min(100, val as number)}%` }}
                                                    ></div>
                                                </div>
                                                <span className="text-xs font-bold">{Math.round(val as number)}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )})}
            </div>
        </div>

        {/* RIGHT COLUMN: Console */}
        <div className="bg-black/40 rounded-lg border border-white/10 flex flex-col font-mono text-xs h-full min-h-[200px]">
            <div className="px-4 py-2 border-b border-white/5 bg-white/5 text-odc-muted uppercase tracking-wider text-[10px] flex justify-between shrink-0">
                <span>System Logs</span>
                <span>{mode === SimulationMode.LOCAL ? '/var/log/reality' : '/var/log/odc_sys'}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
                {logs.length === 0 && (
                    <div className="text-odc-muted opacity-50 italic">System ready.</div>
                )}
                {logs.map((log, idx) => (
                    <div key={idx} className="flex gap-3 animate-in fade-in duration-300">
                        <span className="text-odc-muted opacity-50 shrink-0">[{log.timestamp}]</span>
                        <span className={`font-bold w-20 shrink-0 ${
                            log.source === 'SYSTEM' ? 'text-blue-400' :
                            log.source === 'GOVERNANCE' ? 'text-purple-400' : 
                            log.source === 'NETWORK' ? 'text-red-400' : 'text-odc-success'
                        }`}>
                            {log.source}
                        </span>
                        <span className="text-gray-300 break-all">{log.message}</span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
      </div>
    </div>
  );
};

export default Simulation;
