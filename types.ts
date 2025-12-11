
export interface PinElectricalSpecs {
  minVoltage?: string; // e.g., "-0.3V"
  maxVoltage?: string; // e.g., "3.6V"
  maxCurrent?: string; // e.g., "40mA"
  signalType?: string; // e.g., "Push-Pull", "Open-Drain", "Analog", "Differential"
  impedance?: string;  // e.g., "50 ohm", "High-Z"
  behavior?: string;   // e.g., "Active Low", "PWM Capable", "High-Z at Reset"
}

export interface PhysicalSpecs {
  widthMm: number;
  heightMm: number;
  pinPitchMm: number;
  packageType: string; // e.g., "QFN-48", "SOP-8", "DIP-14"
}

export interface PinDefinition {
  pinNumber: string | number;
  name: string;
  type: 'Power' | 'Input' | 'Output' | 'IO' | 'Clock' | 'Passive';
  description?: string;
  side?: 'left' | 'right' | 'top' | 'bottom'; // For CAD placement
  electrical?: PinElectricalSpecs;
}

export interface ComponentItem {
  id: string;
  name: string;
  description: string;
  footprintType: string;
  pins?: PinDefinition[];
  
  // Enhanced Data for Professional CAD
  physicalSpecs?: PhysicalSpecs;
  isolationRules?: string[]; // e.g. "Keep separate from Analog GND", "High Voltage Creepage > 2mm"
  operatingConditions?: string; // e.g. "Temp: -40 to 85C"
  
  // For UI state
  status?: 'pending' | 'searching_datasheet' | 'analyzing' | 'ready' | 'error';
  datasheetUrl?: string; // Base64 data URI or Web URL
  datasheetFile?: File | null; // User uploaded file (runtime)
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
