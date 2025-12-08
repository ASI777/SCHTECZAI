
export interface PinDefinition {
  pinNumber: string | number;
  name: string;
  type: 'Power' | 'Input' | 'Output' | 'IO' | 'Clock' | 'Passive';
  description?: string;
  side?: 'left' | 'right' | 'top' | 'bottom'; // For CAD placement
}

export interface ComponentItem {
  id: string;
  name: string;
  description: string;
  footprintType: string;
  pins?: PinDefinition[];
  // For UI state
  status?: 'pending' | 'searching_datasheet' | 'analyzing' | 'ready' | 'error';
  datasheetUrl?: string; // Base64 data URI for storage
  datasheetFile?: File | null; // User uploaded file (runtime)
  footprintImage?: string; 
  analysisReport?: string;
  manufacturer?: string;
}

export interface NetConnection {
  componentId: string;
  pin: string | number;
}

export interface Net {
  id: string;
  name: string;
  connections: NetConnection[];
  type?: 'signal' | 'power' | 'ground';
}

export interface SchematicData {
  components: ComponentItem[];
  nets: Net[];
}

export enum AppStage {
  PROJECTS = 'PROJECTS',
  INPUT = 'INPUT',
  ARCH_DIAGRAM = 'ARCH_DIAGRAM',
  PROCESSING = 'PROCESSING',
  SCHEMATIC = 'SCHEMATIC',
}

export interface LogEntry {
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  system: 'CLIENT' | 'LLM_FLASH' | 'DATASHEET_SPIDER' | 'CV_PIPELINE' | 'LLM_PRO' | 'BUILDER';
}

export interface ComponentAction {
  type: 'ADD' | 'REMOVE';
  componentName: string;
  description: string;
  reason: string;
}

export interface CompatibilityReport {
  isCompatible: boolean;
  issues: string[];
  recommendations: string[];
  actions: ComponentAction[];
}

export interface Project {
  id: string;
  name: string;
  lastModified: number;
  mainComponent: string;
  appDescription: string;
  components: ComponentItem[];
  nets: Net[];
  compatibilityReport: CompatibilityReport | null;
  stage: AppStage;
}
