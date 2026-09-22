

import React, { useState } from 'react';
import { MindState, FileNode } from '../types';
import { Brain, Dna, FileCode, AlertTriangle, Eye, Activity, Lock, Cpu, Hammer, CheckCircle, XCircle, List, ArrowRight } from 'lucide-react';

interface NeuroscopeProps {
  mindState: MindState;
  onViewSource: (code: string, title: string) => void;
}

const Neuroscope: React.FC<NeuroscopeProps> = ({ mindState, onViewSource }) => {
  const [activeTab, setActiveTab] = useState<'DNA' | 'CORTEX' | 'FORGE' | 'PLANNER'>('PLANNER');

  const handleSkillClick = async (skillName: string) => {
      // We rely on the parent (App) or global function to fetch source because the Python instance is there
      if ((window as any).getSkillSource) {
          const code = await (window as any).getSkillSource(skillName);
          onViewSource(code, `DNA_VIEWER: ${skillName}`);
      }
  };

  const activeDream = mindState.active_dream;

  return (
    <div className="h-full flex flex-col bg-odc-panel font-mono text-xs">
      
      {/* TABS */}
      <div className="flex border-b border-white/10 bg-black/20">
        <button 
            onClick={() => setActiveTab('PLANNER')}
            className={`flex-1 py-3 text-center transition-colors flex justify-center items-center gap-2 ${activeTab === 'PLANNER' ? 'text-green-400 border-b-2 border-green-400 bg-green-500/10' : 'text-odc-muted hover:text-white'}`}
        >
            <List size={14} /> PLAN
        </button>
        <button 
            onClick={() => setActiveTab('CORTEX')}
            className={`flex-1 py-3 text-center transition-colors flex justify-center items-center gap-2 ${activeTab === 'CORTEX' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/10' : 'text-odc-muted hover:text-white'}`}
        >
            <Brain size={14} /> CORTEX
        </button>
        <button 
            onClick={() => setActiveTab('FORGE')}
            className={`flex-1 py-3 text-center transition-colors flex justify-center items-center gap-2 ${activeTab === 'FORGE' ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/10' : 'text-odc-muted hover:text-white'}`}
        >
            <Hammer size={14} /> FORGE
        </button>
        <button 
            onClick={() => setActiveTab('DNA')}
            className={`flex-1 py-3 text-center transition-colors flex justify-center items-center gap-2 ${activeTab === 'DNA' ? 'text-odc-accent border-b-2 border-odc-accent bg-odc-accent/10' : 'text-odc-muted hover:text-white'}`}
        >
            <Dna size={14} /> DNA
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* DNA VIEW */}
        {activeTab === 'DNA' && (
            <div className="space-y-2">
                <div className="text-[10px] uppercase text-odc-muted mb-2 flex items-center gap-2">
                    <Lock size={10} /> Genetic Skill Library
                </div>
                {Object.keys(mindState.dna_library).length === 0 ? (
                    <div className="text-odc-muted italic text-center py-4">No skills forged yet.</div>
                ) : (
                    Object.entries(mindState.dna_library).map(([name, ver]) => (
                        <button
                            key={name}
                            onClick={() => handleSkillClick(name)}
                            className="w-full text-left bg-black/30 hover:bg-white/5 border border-white/5 hover:border-odc-accent/50 p-2 rounded transition-all flex justify-between items-center group"
                        >
                            <span className="text-odc-text group-hover:text-odc-accent">{name}</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-odc-muted">v{ver}</span>
                                <Eye size={12} className="text-odc-muted group-hover:text-odc-accent" />
                            </div>
                        </button>
                    ))
                )}
            </div>
        )}

        {/* PLANNER VIEW (NEW) */}
        {activeTab === 'PLANNER' && (
            <div className="space-y-4">
                 <div className="text-[10px] uppercase text-odc-muted mb-2 flex items-center gap-2">
                    <List size={10} /> Chain of Thought Buffer
                </div>

                {!mindState.plan_queue || mindState.plan_queue.length === 0 ? (
                    <div className="bg-black/20 p-8 rounded text-center text-odc-muted italic opacity-50 flex flex-col items-center gap-2">
                        <Brain size={24} />
                        <span>No Active Strategy</span>
                        <span className="text-[10px]">Provide a complex instruction to trigger strategic planning.</span>
                    </div>
                ) : (
                    <div className="space-y-3">
                         {mindState.plan_queue.map((step, idx) => (
                             <div key={idx} className={`p-3 rounded border relative overflow-hidden ${idx === 0 ? 'bg-green-900/20 border-green-500/50' : 'bg-black/30 border-white/5 opacity-60'}`}>
                                 <div className="flex justify-between items-start mb-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${idx === 0 ? 'bg-green-500 text-black' : 'bg-gray-700 text-gray-400'}`}>
                                            {step.step_id}
                                        </div>
                                        <span className={`font-mono text-sm ${idx === 0 ? 'text-green-300' : 'text-gray-300'}`}>{step.action}</span>
                                    </div>
                                    <span className="text-[9px] uppercase tracking-wider text-odc-muted">{idx === 0 ? 'IN PROGRESS' : 'QUEUED'}</span>
                                 </div>
                                 <p className="text-[10px] text-odc-muted pl-7 italic border-l border-white/10 ml-2.5">
                                    "{step.reasoning}"
                                 </p>
                                 {idx === 0 && (
                                     <div className="absolute bottom-0 left-0 h-0.5 bg-green-500 animate-[pulse_2s_infinite] w-full"></div>
                                 )}
                             </div>
                         ))}
                         
                         <div className="text-center pt-2">
                             <ArrowRight className="mx-auto text-odc-muted opacity-20 rotate-90" size={16} />
                         </div>
                    </div>
                )}
            </div>
        )}

        {/* CORTEX VIEW (BLACK BOX) */}
        {activeTab === 'CORTEX' && (
            <div className="space-y-4">
                {/* Last Thought Analysis */}
                <div className="bg-black/30 rounded border border-purple-500/30 p-3">
                    <div className="text-purple-400 font-bold mb-2 flex items-center gap-2">
                        <Activity size={14} /> METADATA
                    </div>
                    
                    {mindState.last_thought ? (
                        <div className="space-y-3">
                            <div>
                                <span className="block text-[10px] text-odc-muted uppercase">Risk Assessment</span>
                                <div className={`mt-1 inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold ${mindState.last_thought.risk_level === 'HIGH' ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
                                    {mindState.last_thought.risk_level === 'HIGH' && <AlertTriangle size={10} />}
                                    {mindState.last_thought.risk_level || 'UNKNOWN'}
                                </div>
                            </div>
                            
                            <div>
                                <span className="block text-[10px] text-odc-muted uppercase">Reasoning</span>
                                <p className="text-gray-300 italic mt-1 leading-relaxed border-l-2 border-purple-500/50 pl-2">
                                    "{mindState.last_thought.reasoning}"
                                </p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <span className="block text-[10px] text-odc-muted uppercase">Clarified Goal</span>
                                    <span className="text-white text-[10px]">{mindState.last_thought.clarified_instruction || '-'}</span>
                                </div>
                                <div>
                                    <span className="block text-[10px] text-odc-muted uppercase">Morph Focus</span>
                                    <span className="text-cyan-400 text-[10px]">{mindState.last_thought.morph_focus || '-'}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                         <div className="text-odc-muted italic opacity-50 py-4 text-center">
                            The Cortex is quiet. <br/> waiting for high-level directives...
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* FORGE VIEW (LIVE CODING) */}
        {activeTab === 'FORGE' && (
             <div className="space-y-4">
                <div className="text-[10px] uppercase text-odc-muted mb-2 flex items-center gap-2">
                    <Hammer size={10} /> Active Generation Process
                </div>
                
                {!activeDream ? (
                    <div className="bg-black/20 p-8 rounded text-center text-odc-muted italic opacity-50 flex flex-col items-center gap-2">
                        <Hammer size={24} />
                        <span>Forge is Idle.</span>
                        <span className="text-[10px]">Provide a new instruction to trigger evolution.</span>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Status Header */}
                        <div className="bg-amber-900/10 border border-amber-500/20 p-3 rounded">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">FORGING SKILL</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${activeDream.status === 'SUCCESS' ? 'bg-green-500/20 text-green-400' : activeDream.status === 'FAIL' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-300 animate-pulse'}`}>
                                    {activeDream.status}
                                </span>
                            </div>
                            <div className="font-mono text-white text-sm">
                                {activeDream.target_skill || 'UNKNOWN'}
                            </div>
                        </div>

                        {/* Attempts Timeline */}
                        <div className="space-y-2">
                            {activeDream.history.map((attempt, idx) => (
                                <div key={idx} className="bg-black/30 border border-white/5 rounded overflow-hidden">
                                    <div className="p-2 bg-white/5 flex justify-between items-center text-[10px] uppercase tracking-wide text-odc-muted">
                                        <span>Attempt #{attempt.attempt_id}</span>
                                        {attempt.status === 'APPROVED' 
                                            ? <span className="text-green-400 flex items-center gap-1"><CheckCircle size={10}/> Approved</span>
                                            : <span className="text-red-400 flex items-center gap-1"><XCircle size={10}/> Rejected</span>
                                        }
                                    </div>
                                    
                                    {/* Logs */}
                                    <div className="p-2 border-b border-white/5 font-mono text-[10px] space-y-1">
                                        {attempt.logs.map((log, i) => (
                                            <div key={i} className={`${log.includes('FAIL') || log.includes('REJECT') || log.includes('Error') ? 'text-red-400' : log.includes('SUCCESS') || log.includes('PASSED') ? 'text-green-400' : 'text-gray-400'}`}>
                                                &gt; {log}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Code Preview Button / Snippet */}
                                    {attempt.code && (
                                        <div className="bg-black/50 p-2">
                                            <button 
                                                onClick={() => onViewSource(attempt.code, `DREAM_ATTEMPT_${attempt.attempt_id}.py`)}
                                                className="w-full text-center text-[10px] text-odc-accent hover:text-white transition-colors py-1 bg-odc-accent/10 hover:bg-odc-accent/20 rounded border border-odc-accent/20"
                                            >
                                                View Generated Code ({attempt.code.length} bytes)
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
             </div>
        )}

      </div>
    </div>
  );
};

export default Neuroscope;
