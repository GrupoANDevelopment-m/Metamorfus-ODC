import React, { useState, useRef, useEffect } from 'react';
import { Send, TerminalSquare, User, Bot, Loader2 } from 'lucide-react';
import { SystemConfig, MindState } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  config: SystemConfig;
  mindState: MindState;
}

export default function ChatPanel({ config, mindState }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Connection established. I am Metamorfos ODC. How may I assist you?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Gather Realtime Context
      let ecosystemContext = "";
      if (typeof window !== 'undefined' && (window as any).getOdcLogs) {
         const logs = (window as any).getOdcLogs() || [];
         ecosystemContext = "\n\nRECENT SIMULATION LOGS:\n" + logs.slice(-20).map((l:any) => `[${l.timestamp}] ${l.source || 'SYS'}: ${l.message}`).join('\n');
      }
      
      const mindContext = "\n\nCURRENT MIND STATE (DNA/SKILLS):\n" + JSON.stringify(mindState.dna_library || {}, null, 2);
      
      const systemPrompt = `You are Metamorfos ODC, an autonomous transforming AI system. You evaluate your own logic and generate simulations. 
Currently taking inputs purely for consultation.
${ecosystemContext}
${mindContext}`;

      const payload = {
        model: "moonshotai/kimi-k2.6",
        messages: [{ role: "system", content: systemPrompt }, ...messages, { role: "user", content: userMessage }],
        max_tokens: 4096,
        temperature: 0.7,
      };

      let response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-api-key": config.nvidiaApiKey || ""
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // Fallback
        const fallbackPayload = {
          model: "mistralai/mistral-medium-3.5-128b",
          messages: [{ role: "system", content: systemPrompt }, ...messages, { role: "user", content: userMessage }],
          max_tokens: 4096,
          temperature: 0.7,
        };
        response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": config.nvidiaApiKey || ""
          },
          body: JSON.stringify(fallbackPayload)
        });
      }

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0]?.message?.content || 'No response from core.';
        setMessages(prev => [...prev, { role: 'assistant', content }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error communicating with core. Code: ${response.status}` }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `System Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-odc-bg text-odc-text">
       <div className="p-4 border-b border-white/10 bg-odc-panel flex items-center gap-2 text-odc-accent">
           <TerminalSquare size={18} />
           <h2 className="font-mono font-bold tracking-wider">ODC COMM LINK</h2>
       </div>

       <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm">
           {messages.map((msg, idx) => (
             <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                 {msg.role === 'assistant' && (
                     <div className="w-8 h-8 rounded shrink-0 bg-odc-panel flex items-center justify-center text-odc-accent border border-odc-accent/20">
                        <Bot size={16} />
                     </div>
                 )}
                 <div className={`p-3 rounded max-w-[80%] ${msg.role === 'user' ? 'bg-blue-900/40 border border-blue-500/30 text-blue-100' : 'bg-white/5 border border-white/10 text-gray-300'}`}>
                     <pre className="whitespace-pre-wrap font-mono text-sm">{msg.content}</pre>
                 </div>
                 {msg.role === 'user' && (
                     <div className="w-8 h-8 rounded shrink-0 bg-blue-900/50 flex items-center justify-center text-blue-300 border border-blue-500/20">
                        <User size={16} />
                     </div>
                 )}
             </div>
           ))}
           {isLoading && (
              <div className="flex gap-3 justify-start">
                   <div className="w-8 h-8 rounded shrink-0 bg-odc-panel flex items-center justify-center text-odc-accent border border-odc-accent/20">
                      <Loader2 size={16} className="animate-spin" />
                   </div>
                   <div className="p-3 rounded bg-white/5 border border-white/10 text-gray-400">
                      Processing...
                   </div>
              </div>
           )}
           <div ref={messagesEndRef} />
       </div>

       <div className="p-4 border-t border-white/10 bg-odc-panel mt-auto">
           <div className="relative">
               <input 
                   type="text"
                   value={input}
                   onChange={e => setInput(e.target.value)}
                   onKeyDown={e => e.key === 'Enter' && handleSend()}
                   placeholder="Send a message to the system..."
                   disabled={isLoading}
                   className="w-full bg-black/40 border border-white/10 rounded px-4 py-3 text-sm focus:outline-none focus:border-odc-accent text-white placeholder-gray-500 font-mono transition-colors disabled:opacity-50 pr-12"
               />
               <button 
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded bg-odc-accent/20 text-odc-accent hover:bg-odc-accent/40 disabled:opacity-50 transition-colors"
               >
                   <Send size={16} />
               </button>
           </div>
       </div>
    </div>
  );
}
