

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
  isOpen?: boolean;
}

export enum ViewMode {
  CODE = 'CODE',
  SIMULATION = 'SIMULATION',
  SETTINGS = 'SETTINGS'
}

export enum SimulationMode {
  BROWSER = 'BROWSER_SANDBOX',
  LOCAL = 'LOCAL_NEURO_LINK'
}

export interface SystemConfig {
  geminiApiKey: string;
  supabaseUrl: string;
  supabaseKey: string;
}

export interface OrganismState {
  id: number;
  energy: number;
  status: 'ALIVE' | 'DEAD' | string;
  action: string;
  cycle: number;
  instruction: string;
  attributes: Record<string, number>; // The liquid attributes (e.g., { cpu: 90, strength: 10 })
  is_remote?: boolean;
}

export interface DreamAttempt {
  attempt_id: number;
  code: string;
  logs: string[];
  status: 'PENDING' | 'REJECTED' | 'APPROVED';
}

export interface DreamState {
  status: 'IDLE' | 'FORGING' | 'DREAMING' | 'SUCCESS' | 'FAIL';
  target_skill: string;
  current_attempt: number;
  history: DreamAttempt[];
}

export interface PlanStep {
  step_id: number;
  action: string;
  reasoning: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETE' | 'FAILED';
}

export interface MindState {
  dna_library: Record<string, number>; // Skill Name -> Version
  last_thought: {
    safe?: boolean;
    risk_level?: string;
    clarified_instruction?: string;
    morph_focus?: string;
    reasoning?: string;
  } | null;
  active_dream: DreamState | null;
  plan_queue: PlanStep[]; // The Chain of Thought Buffer
  active_skill_source?: string;
}

export interface EcosystemLog {
  timestamp: string;
  message: string;
  source: 'SYSTEM' | 'ORGANISM' | 'GOVERNANCE' | 'NETWORK';
}
