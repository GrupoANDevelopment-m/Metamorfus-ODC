
import React, { useState, useEffect } from 'react';
import { X, Save, Key, Database, ShieldAlert } from 'lucide-react';
import { SystemConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SystemConfig;
  onSave: (newConfig: SystemConfig) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onSave }) => {
  const [formData, setFormData] = useState<SystemConfig>(config);

  useEffect(() => {
    setFormData(config);
  }, [config, isOpen]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-odc-panel border border-white/10 rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
          <h2 className="text-lg font-mono font-bold text-odc-accent flex items-center gap-2">
            <Key size={18} />
            SYSTEM CONFIGURATION
          </h2>
          <button onClick={onClose} className="text-odc-muted hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          
          <div className="space-y-4">
            <div className="bg-amber-900/20 border border-amber-500/20 p-3 rounded text-xs text-amber-200 flex items-start gap-2">
                <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                <p>
                    These keys are stored locally in your browser and injected into the Python Sandbox at runtime.
                    Without an NVIDIA API Key, the <strong>Cortex</strong> and <strong>Forge</strong> (AI Evolution) will not function.
                </p>
            </div>

            {/* NVIDIA API Key */}
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold text-odc-muted flex items-center gap-2">
                <Key size={12} /> NVIDIA API Key (Required)
              </label>
              <input
                type="password"
                name="nvidiaApiKey"
                value={formData.nvidiaApiKey}
                onChange={handleChange}
                placeholder="nvapi-..."
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-odc-text focus:border-odc-accent focus:outline-none font-mono"
              />
              <p className="text-[10px] text-odc-muted">Used for Cognitive Cortex & Genetic Forge logic (Kimi-k2.6 or Mistral).</p>
            </div>

            <div className="border-t border-white/5 my-4"></div>

            {/* Supabase Config */}
            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold text-odc-muted flex items-center gap-2">
                <Database size={12} /> Supabase URL (Hive Mind)
              </label>
              <input
                type="text"
                name="supabaseUrl"
                value={formData.supabaseUrl}
                onChange={handleChange}
                placeholder="https://xyz.supabase.co"
                readOnly
                disabled
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-odc-text focus:border-odc-accent focus:outline-none font-mono opacity-50 cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold text-odc-muted flex items-center gap-2">
                <Key size={12} /> Supabase Anon Key
              </label>
              <input
                type="password"
                name="supabaseKey"
                value={formData.supabaseKey}
                onChange={handleChange}
                placeholder="eyJh..."
                readOnly
                disabled
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-odc-text focus:border-odc-accent focus:outline-none font-mono opacity-50 cursor-not-allowed"
              />
              <p className="text-[10px] text-odc-muted">Used for shared memory and swarm telepathy.</p>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-black/20 flex justify-end gap-2">
            <button 
                type="button" 
                onClick={onClose}
                className="px-4 py-2 rounded text-xs font-bold text-odc-muted hover:bg-white/5 transition-colors"
            >
                CANCEL
            </button>
            <button 
                onClick={handleSubmit}
                className="px-6 py-2 rounded bg-odc-accent/20 border border-odc-accent/50 text-odc-accent hover:bg-odc-accent/30 text-xs font-bold transition-all flex items-center gap-2"
            >
                <Save size={14} /> SAVE CONFIGURATION
            </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
