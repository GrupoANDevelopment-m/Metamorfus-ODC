
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
  
  // Browser (Pyodide) State - NOW EXECUTED VIA WEB WORKER
  const workerRef = useRef<Worker | null>(null);
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
  const [forgeStats, setForgeStats] = useState({
      static_safety: { success: 0, fail: 0 },
      adversarial: { success: 0, fail: 0 }
  });
  const [mindState, setMindState] = useState<any>(null);
  const logsRef = useRef<EcosystemLog[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Worker setup
  const stepPromiseResolveRef = useRef<((value: any) => void) | null>(null);

  useEffect(() => {
    addLog('Booting Web Worker (Quarantine Area)...', 'SYSTEM');
    const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    
    worker.onerror = (err) => {
        console.error("Worker fatal error:", err);
        addLog(`Worker Fatal Error: ${err.message || 'Unknown. Check console.'}`, 'SYSTEM');
        setInitError(err.message || 'Worker failed to load.');
        setIsLoading(false);
    };

    worker.onmessage = (e) => {
        const { type, payload } = e.data;
        
        switch (type) {
            case 'FORGE_ANALYTIC':
                setForgeStats(prev => {
                    const phaseStats = prev[payload.phase as keyof typeof prev] || { success: 0, fail: 0 };
                    return {
                        ...prev,
                        [payload.phase]: {
                            ...phaseStats,
                            [payload.success ? 'success' : 'fail']: phaseStats[payload.success ? 'success' : 'fail'] + 1
                        }
                    };
                });
                break;
            case 'LOG':
                addLog(payload.message, payload.source);
                break;
            case 'INIT_COMPLETE':
                setIsReady(true);
                setIsLoading(false);
                setOrganisms(payload.organisms);
                if (payload.mind_state) {
                    setMindState(payload.mind_state);
                    if (onMindUpdate) onMindUpdate(payload.mind_state);
                }
                addLog('Web Worker Quarantined Pyodide Ready.', 'SYSTEM');
                break;
            case 'STEP_COMPLETE':
                setOrganisms(payload.organisms);
                setCycle(payload.cycle);
                if (payload.mind_state) {
                    setMindState(payload.mind_state);
                    if (onMindUpdate) onMindUpdate(payload.mind_state);
                }
                if (stepPromiseResolveRef.current) {
                    stepPromiseResolveRef.current(true);
                    stepPromiseResolveRef.current = null;
                }
                break;
            case 'ERROR':
                addLog(`Worker Error: ${payload}`, 'SYSTEM');
                if (!isReady) {
                    setInitError(payload);
                    setIsLoading(false);
                } else {
                    setIsRunning(false); // Stop on run error
                }
                if (stepPromiseResolveRef.current) {
                    stepPromiseResolveRef.current(false);
                    stepPromiseResolveRef.current = null;
                }
                break;
        }
    };
    
    worker.postMessage({ 
        type: 'INIT', 
        payload: {
            NVIDIA_API_KEY: config.nvidiaApiKey,
            SUPABASE_URL: config.supabaseUrl,
            SUPABASE_KEY: config.supabaseKey,
            MARKET_ENDPOINT: "https://api.market-data.com/v1"
        }
    });
    
    return () => {
        worker.terminate();
    };
  }, []);

  // Expose to window for ChatPanel Context Windows
  useEffect(() => {
    (window as any).getOdcLogs = () => logsRef.current;
  }, []);
  
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

  // Lock for file system sync operations
  const isSyncing = useRef(false);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (message: string, source: EcosystemLog['source']) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => {
        const newLogs = [...prev, { timestamp, message, source }].slice(-50);
        logsRef.current = newLogs;
        return newLogs;
    });
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

    try {
        if (navigator.getBattery) {
            const battery = await navigator.getBattery();
            data.battery = {
                level: battery.level,
                charging: battery.charging
            };
        }
    } catch (e) {}

    try {
        if (navigator.connection) {
            data.network = {
                type: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt
            };
        }
    } catch (e) {}

    if (sensorData.location) {
        data.location = sensorData.location;
    }

    return data;
  };

  useEffect(() => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setSensorData((prev: any) => ({
                    ...prev, 
                    location: { lat: pos.coords.latitude, lng: pos.coords.longitude }
                }));
            }, 
            (err) => {}
        );
    }
  }, []);

  // --- SECRET INJECTION ---
  useEffect(() => {
      if (isReady && workerRef.current) {
          workerRef.current.postMessage({ 
              type: 'SECRETS', 
              payload: {
                  NVIDIA_API_KEY: config.nvidiaApiKey,
                  SUPABASE_URL: config.supabaseUrl,
                  SUPABASE_KEY: config.supabaseKey,
                  MARKET_ENDPOINT: "https://api.market-data.com/v1"
              }
          });
          addLog('System Configuration Transmitted to Worker.', 'SYSTEM');
      }
  }, [config, isReady]);

  // --- RUNTIME LOOP (BROWSER MODE) ---
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isExecuting = false;
    
    const runCycle = async () => {
        if (mode === SimulationMode.BROWSER && isRunning && workerRef.current && isReady && !isExecuting) {
            isExecuting = true;
            try {
                const nextCycle = cycle + 1;
                const sensors = await gatherRealWorldData();
                
                // Add a timeout watcher to kill runaway worker!
                const deadManSwitch = setTimeout(() => {
                    addLog('Worker Quarantined (Timeout). Rebooting...', 'SYSTEM');
                    workerRef.current?.terminate();
                    setIsRunning(false);
                }, 300000); // 5 minutes timeout

                const workerStepComplete = new Promise((resolve) => {
                    stepPromiseResolveRef.current = resolve;
                });
                
                // Tell worker to step
                workerRef.current.postMessage({ type: 'STEP', payload: { cycle: nextCycle, sensorData: sensors } });
                
                await workerStepComplete;
                clearTimeout(deadManSwitch);
                
            } catch (e: any) {
                addLog(`Execution Error: ${e.message}`, 'SYSTEM');
                setIsRunning(false);
            }
            isExecuting = false;
        }
    };
    
    if (isRunning) {
        timeoutId = setInterval(runCycle, 3000);
    }
    
    return () => clearInterval(timeoutId);
  }, [isRunning, isReady, cycle, mode, sensorData]);


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

  // --- RUNTIME DEPRECATED BROWSER SIMULATION START MOVED TO WORKER ---

  const handleToggleRun = async () => {
    if (mode === SimulationMode.BROWSER) {
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
    
    if (mode === SimulationMode.BROWSER) {
        if (workerRef.current) {
            addLog('Rebooting Worker for Reset...', 'SYSTEM');
            workerRef.current.terminate();
            window.location.reload(); 
        }
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

      if (mode === SimulationMode.BROWSER) {
           if (workerRef.current && isReady) {
               workerRef.current.postMessage({ type: 'INSTRUCTION', payload: instruction });
           }
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
        <div className="mt-8 bg-black/40 p-4 border border-white/10 rounded w-full max-w-2xl">
           <h3 className="text-xs uppercase text-odc-muted mb-2">Worker Status</h3>
           <div className="font-mono text-xs text-gray-300 space-y-1">
              {logs.slice(-5).map((log, i) => (
                 <div key={i}><span className="text-odc-muted opacity-50">[{log.timestamp}]</span> {log.message}</div>
              ))}
           </div>
        </div>
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

            {/* Forge Analytics Dashboard */}
            <div className="bg-odc-panel rounded-lg border border-white/10 p-4 shrink-0 grid grid-cols-2 gap-4">
                <div>
                    <div className="text-[10px] text-odc-muted uppercase tracking-wider mb-2">Static Safety Checks</div>
                    <div className="flex items-center gap-2">
                       <div className="text-green-500 font-mono text-sm">Pass: {forgeStats.static_safety.success}</div>
                       <div className="text-red-500 font-mono text-sm">Fail: {forgeStats.static_safety.fail}</div>
                    </div>
                </div>
                <div>
                    <div className="text-[10px] text-odc-muted uppercase tracking-wider mb-2">Adversarial Alignment</div>
                    <div className="flex items-center gap-2">
                       <div className="text-green-500 font-mono text-sm">Pass: {forgeStats.adversarial.success}</div>
                       <div className="text-red-500 font-mono text-sm">Fail: {forgeStats.adversarial.fail}</div>
                    </div>
                </div>
                <div className="col-span-2 pt-2 border-t border-white/5">
                    <div className="text-[10px] text-odc-muted uppercase tracking-wider mb-2 flex justify-between">
                       <span>Population Census</span>
                       <span>Variants Injected: {mindState?.dna_library ? Object.keys(mindState.dna_library).length : 0}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm font-mono">
                       <span className="text-odc-accent">Active Organisms / Nodes</span>
                       <span className="text-white">{organisms.length}</span>
                    </div>
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
