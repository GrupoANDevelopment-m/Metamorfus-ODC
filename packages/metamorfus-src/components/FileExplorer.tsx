import React, { useState } from 'react';
import { FileNode } from '../types';
import { ChevronRight, ChevronDown, FileCode, Folder, FolderOpen } from 'lucide-react';

interface FileExplorerProps {
  node: FileNode;
  onSelectFile: (node: FileNode) => void;
  selectedFileId: string | null;
  level?: number;
}

const FileExplorer: React.FC<FileExplorerProps> = ({ node, onSelectFile, selectedFileId, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(node.isOpen || false);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'file') {
      onSelectFile(node);
    } else {
      setIsOpen(!isOpen);
    }
  };

  const paddingLeft = `${level * 1.25}rem`;

  return (
    <div className="select-none text-sm">
      <div
        className={`flex items-center py-1 pr-2 cursor-pointer transition-colors duration-150 ${
          selectedFileId === node.id 
            ? 'bg-odc-accent/20 text-odc-accent' 
            : 'text-odc-muted hover:text-odc-text hover:bg-white/5'
        }`}
        style={{ paddingLeft }}
        onClick={handleSelect}
      >
        <span className="mr-1.5 opacity-70" onClick={node.type === 'folder' ? handleToggle : undefined}>
          {node.type === 'folder' ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-[14px] inline-block" />
          )}
        </span>
        
        <span className="mr-2 text-odc-accent opacity-80">
          {node.type === 'folder' ? (
            isOpen ? <FolderOpen size={16} /> : <Folder size={16} />
          ) : (
            <FileCode size={16} />
          )}
        </span>
        
        <span className="truncate">{node.name}</span>
      </div>

      {node.type === 'folder' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileExplorer
              key={child.id}
              node={child}
              onSelectFile={onSelectFile}
              selectedFileId={selectedFileId}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FileExplorer;