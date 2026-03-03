
import React, { useState, useEffect } from 'react';
import { INITIAL_FILE_SYSTEM } from './constants';
import { FileNode, ViewMode, MindState, SystemConfig } from './types';
import FileExplorer from './components/FileExplorer';
import CodeEditor from './components/CodeEditor';
import Simulation from './components/Simulation';
import Neuroscope from './components/Neuroscope';
import SettingsModal from './components/SettingsModal';
import { Terminal, Code, Settings, Menu, Database, Activity } from 'lucide-react';

const OdcLogo = ({ className }: { className?: string }) => (
  <img 
    src="logo.png" 
    alt="Metamorfos ODC" 
    className={className}
    style={{ display: 'block' }}
    onError={(e) => {
        // Fallback or hide if image missing
        e.currentTarget.style.display = 'none';
    }}
  />
);

export default function App() {
  const [fileSystem, setFileSystem] = useState<FileNode[]>(INITIAL_FILE_SYSTEM);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.CODE);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  
  // Sidebar Tab State
  const [sidebarTab, setSidebarTab] = useState<'FILES' | 'MIND'>('FILES');

  // Mind State
  const [mindState, setMindState] = useState<MindState>({
      dna_library: {},
      last_thought: null,
      active_dream: null
  });

  // System Configuration State
  // Safe access to process.env to prevent runtime/syntax errors in pure browser environments
  const getEnvApiKey = () => {
    try {
      if (typeof process !== 'undefined' && process.env) {
        return process.env.API_KEY || '';
      }
    } catch (e) {
      return '';
    }
    return '';
  };

  const [config, setConfig] = useState<SystemConfig>({
      geminiApiKey: getEnvApiKey(),
      supabaseUrl: "https://vswawfqzocydtwgwiqqv.supabase.co",
      supabaseKey: "sb_publishable_aeDLN0jr5xjiCKlXfRgCGQ_pXH-bIab"
  });

  // Load config from localStorage on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem('odc_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(prev => ({ ...prev, ...parsed }));
      } catch(e) {}
    }
  }, []);

  const handleSaveConfig = (newConfig: SystemConfig) => {
    setConfig(newConfig);
    localStorage.setItem('odc_config', JSON.stringify(newConfig));
  };

  const handleSelectFile = (node: FileNode) => {
    setSelectedFile(node);
    setViewMode(ViewMode.CODE);
  };
  
  const handleViewSource = (code: string, title: string) => {
      // Create a temporary file node to view generated code
      const tempNode: FileNode = {
          id: 'temp_view',
          name: title,
          type: 'file',
          content: code
      };
      setSelectedFile(tempNode);
      setViewMode(ViewMode.CODE);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-odc-bg text-odc-text">
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setSettingsOpen(false)} 
        config={config} 
        onSave={handleSaveConfig} 
      />

      {/* Top Navigation Bar */}
      <header className="h-16 border-b border-white/10 bg-odc-panel flex items-center px-4 justify-between shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-4">
            {/* Logo Section */}
            <div className="relative flex items-center justify-center">
                <OdcLogo className="h-10 w-auto drop-shadow-[0_0_15px_rgba(56,189,248,0.5)]" />
            </div>
            
            {/* Brand Text */}
            <div className="flex flex-col leading-none justify-center">
                <h1 className="font-bold text-lg tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-blue-300 via-cyan-200 to-white">
                    Metamorfos
                </h1>
                <span className="text-[10px] font-mono text-cyan-500 tracking-[0.35em] font-bold uppercase ml-0.5">
                    ODC
                </span>
            </div>
        </div>
        
        <div className="flex bg-black/20 p-1 rounded-lg">
            <button 
                onClick={() => setViewMode(ViewMode.CODE)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm transition-all ${viewMode === ViewMode.CODE ? 'bg-white/10 text-white shadow-sm' : 'text-odc-muted hover:text-white'}`}
            >
                <Code size={16} /> <span className="hidden sm:inline">Editor</span>
            </button>
            <button 
                onClick={() => setViewMode(ViewMode.SIMULATION)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm transition-all ${viewMode === ViewMode.SIMULATION ? 'bg-odc-accent/20 text-odc-accent shadow-sm' : 'text-odc-muted hover:text-white'}`}
            >
                <Terminal size={16} /> <span className="hidden sm:inline">Runtime Loop</span>
            </button>
        </div>

        <div className="flex items-center gap-3">
             <button 
                className="p-2 text-odc-muted hover:text-white transition-colors" 
                title="Settings"
                onClick={() => setSettingsOpen(true)}
             >
                <Settings size={18} />
             </button>
             <button className="md:hidden p-2 text-odc-muted" onClick={() => setSidebarOpen(!isSidebarOpen)}>
                <Menu size={18} />
             </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Sidebar */}
        <aside 
            className={`
                absolute md:relative z-10 h-full w-64 bg-odc-panel border-r border-white/10 flex flex-col transition-transform duration-300
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
            `}
        >
            {/* Sidebar Toggle */}
            <div className="flex border-b border-white/5 text-[10px] font-bold uppercase tracking-wider">
                 <button 
                    onClick={() => setSidebarTab('FILES')}
                    className={`flex-1 py-3 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors ${sidebarTab === 'FILES' ? 'text-white border-b-2 border-white' : 'text-odc-muted'}`}
                 >
                    <Database size={12} /> Explorer
                 </button>
                 <button 
                    onClick={() => setSidebarTab('MIND')}
                    className={`flex-1 py-3 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors ${sidebarTab === 'MIND' ? 'text-odc-accent border-b-2 border-odc-accent' : 'text-odc-muted'}`}
                 >
                    <Activity size={12} /> Mind
                 </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {sidebarTab === 'FILES' ? (
                    <div className="py-2">
                        {fileSystem.map(node => (
                            <FileExplorer 
                                key={node.id} 
                                node={node} 
                                onSelectFile={handleSelectFile} 
                                selectedFileId={selectedFile?.id || null} 
                            />
                        ))}
                    </div>
                ) : (
                    <Neuroscope mindState={mindState} onViewSource={handleViewSource} />
                )}
            </div>
        </aside>

        {/* Workspace */}
        <main className="flex-1 flex flex-col min-w-0 bg-odc-bg relative">
            {viewMode === ViewMode.CODE ? (
                <CodeEditor file={selectedFile} />
            ) : (
                <Simulation 
                    isActive={viewMode === ViewMode.SIMULATION} 
                    config={config}
                    onMindUpdate={setMindState}
                />
            )}
        </main>
      </div>
      
      {/* Status Bar */}
      <footer className="h-6 bg-odc-panel border-t border-white/5 flex items-center px-3 text-[10px] text-odc-muted justify-between shrink-0 select-none">
        <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${viewMode === ViewMode.SIMULATION ? 'bg-green-500 animate-pulse' : 'bg-blue-500'}`}></div>
                ODC KERNEL: READY
            </span>
            <span>{selectedFile ? selectedFile.name : 'NO FILE SELECTED'}</span>
        </div>
        <div className="flex items-center gap-4">
             <span>Python 3.11</span>
             <span>UTF-8</span>
             <span>Ln 1, Col 1</span>
        </div>
      </footer>
    </div>
  );
}
