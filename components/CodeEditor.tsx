import React from 'react';
import { FileNode } from '../types';

interface CodeEditorProps {
  file: FileNode | null;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ file }) => {
  if (!file) {
    return (
      <div className="h-full flex items-center justify-center text-odc-muted">
        <div className="text-center">
          <p className="text-xl font-bold mb-2">ODC Cognitive Ecosystem</p>
          <p>Select a file to view source</p>
        </div>
      </div>
    );
  }

  // Simple syntax coloring simulation (very basic regex)
  const highlightCode = (code: string) => {
    return code.split('\n').map((line, i) => {
      // Basic highlighting for keywords
      const parts = line.split(/(\b(?:def|class|import|from|return|if|else|while|for|in|pass|None|True|False)\b)/g);
      
      return (
        <div key={i} className="table-row">
          <span className="table-cell text-right pr-4 text-odc-muted select-none opacity-50 text-xs w-8 align-top">
            {i + 1}
          </span>
          <span className="table-cell whitespace-pre-wrap break-all">
            {parts.map((part, index) => {
              if (['def', 'class', 'import', 'from', 'return', 'if', 'else', 'while', 'for', 'in', 'pass', 'True', 'False'].includes(part)) {
                return <span key={index} className="text-purple-400 font-semibold">{part}</span>;
              } else if (part.trim().startsWith('#')) {
                return <span key={index} className="text-green-600 italic">{part}</span>;
              } else if (part.includes('"') || part.includes("'")) {
                return <span key={index} className="text-yellow-300">{part}</span>;
              }
               else {
                return <span key={index}>{part}</span>;
              }
            })}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="h-full flex flex-col bg-odc-bg">
      <div className="px-4 py-2 bg-odc-panel border-b border-white/5 text-sm font-mono text-odc-text flex items-center">
        <span className="opacity-50 mr-2">file:</span>
        {file.name}
      </div>
      <div className="flex-1 overflow-auto p-4 font-mono text-sm text-odc-text">
        <div className="table w-full">
            {file.content ? highlightCode(file.content) : <span className="text-odc-muted italic">No content</span>}
        </div>
      </div>
    </div>
  );
};

export default CodeEditor;