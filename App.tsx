import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  AppStage, 
  ComponentItem, 
  LogEntry, 
  Net, 
  CompatibilityReport,
  ComponentAction,
  Project
} from './types';
import { 
  generateBOM, 
  analyzeDatasheetPDF,
  analyzePins,
  generateNetlist, 
  checkSystemCompatibility,
  searchComponentData
} from './services/geminiService';
import { generateEagleSchematic } from './services/exportService';
import { ArchitectureDiagram } from './components/ArchitectureDiagram';
import { SchematicView } from './components/SchematicView';
import { 
  Terminal, 
  Cpu, 
  Activity, 
  Layers, 
  Play, 
  CheckCircle, 
  FileText,
  Upload,
  AlertTriangle,
  PenTool,
  Wrench,
  RefreshCw,
  Folder,
  Save,
  Plus,
  Trash2,
  ArrowRight,
  Globe,
  Loader2,
  Download,
  MousePointer2
} from 'lucide-react';
import { INITIAL_LOGS } from './constants';

const App: React.FC = () => {
  // State
  const [stage, setStage] = useState<AppStage>(AppStage.PROJECTS);
  const [projects, setProjects] = useState<Project[]>([]);
  
  // Current Project State
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("New Project");
  const [mainComponent, setMainComponent] = useState("ESP32-WROOM-32");
  const [appDescription, setAppDescription] = useState("IoT Weather Station with DHT22");
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [nets, setNets] = useState<Net[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<ComponentItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(null);
  
  // Layout state for Export
  const [schematicLayout, setSchematicLayout] = useState<{
      positions: Record<string, {x: number, y: number, w: number, h: number}>,
      routes: any[]
  }>({ positions: {}, routes: [] });

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load projects from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('eda_projects');
    if (saved) {
      try {
        setProjects(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load projects", e);
      }
    }
  }, []);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', system: LogEntry['system'] = 'CLIENT') => {
    setLogs(prev => [...prev, { timestamp: Date.now(), message, type, system }]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- Project Management Functions ---

  const createProject = () => {
    setProjectId(null); // New project has no ID until saved
    setProjectName("Untitled Project");
    setMainComponent("ESP32-WROOM-32");
    setAppDescription("IoT Weather Station with DHT22");
    setComponents([]);
    setNets([]);
    setCompatibilityReport(null);
    setLogs(INITIAL_LOGS);
    setStage(AppStage.INPUT);
  };

  const saveProject = async () => {
    addLog("Saving project...", 'info', 'CLIENT');
    
    // We cannot save full Base64 PDFs in localStorage due to 5MB limit.
    // We will save the extracted data (pins, report) but strip the heavy datasheetUrl if it's base64.
    const processedComponents = components.map(c => {
      const isBase64 = c.datasheetUrl?.startsWith('data:');
      return {
        ...c,
        // Keep the URL if it's a web link, otherwise drop it to save space
        datasheetUrl: isBase64 ? undefined : c.datasheetUrl, 
        datasheetFile: undefined 
      };
    });

    const newProject: Project = {
      id: projectId || `proj_${Date.now()}`,
      name: projectName,
      lastModified: Date.now(),
      mainComponent,
      appDescription,
      components: processedComponents,
      nets,
      compatibilityReport,
      stage: stage === AppStage.PROJECTS ? AppStage.INPUT : stage
    };

    const updatedProjects = projectId 
      ? projects.map(p => p.id === projectId ? newProject : p)
      : [...projects, newProject];

    setProjects(updatedProjects);
    setProjectId(newProject.id);
    
    // Persist to local storage
    try {
      localStorage.setItem('eda_projects', JSON.stringify(updatedProjects));
      addLog("Project saved successfully. (Note: Large PDF files are not persisted, only analysis data)", 'success', 'CLIENT');
    } catch (e) {
      addLog("Failed to save project. Storage limit exceeded?", 'error', 'CLIENT');
      console.error(e);
    }
  };

  const loadProject = (project: Project) => {
    setProjectId(project.id);
    setProjectName(project.name);
    setMainComponent(project.mainComponent);
    setAppDescription(project.appDescription);
    setNets(project.nets);
    setCompatibilityReport(project.compatibilityReport);
    setStage(project.stage);
    
    // Hydrate components
    const hydratedComponents = project.components.map(c => {
       return { ...c };
    });
    setComponents(hydratedComponents);
    
    addLog(`Project "${project.name}" loaded.`, 'success', 'CLIENT');
  };

  const deleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    localStorage.setItem('eda_projects', JSON.stringify(updated));
  };

  // --- Export Function ---
  const handleDownloadCAD = () => {
    if (!nets.length || !components.length) return;
    addLog("Generating Eagle Schematic file (.sch)...", 'info', 'BUILDER');
    
    try {
      // Use the actual layout state from SchematicView
      const eagleContent = generateEagleSchematic(
          { components, nets }, 
          schematicLayout.positions,
          schematicLayout.routes
      );
      
      // Trigger Download
      const blob = new Blob([eagleContent], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, '_')}.sch`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog("Eagle Schematic (.sch) downloaded. Compatible with Eagle, Altium, KiCad.", 'success', 'BUILDER');
    } catch (e) {
      console.error(e);
      addLog("Failed to generate CAD file.", 'error', 'BUILDER');
    }
  };

  // --- Layout Handler ---
  const handleLayoutChange = (positions: any, routes: any) => {
      setSchematicLayout({ positions, routes });
  };


  // --- Functional Logic ---

  // Handler for File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, comp: ComponentItem) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addLog(`Uploading datasheet for ${comp.name}...`, 'info', 'CLIENT');
    
    // Update State
    setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, datasheetFile: file, status: 'analyzing' } : c));

    try {
      addLog(`Analyzing PDF structure & Electrical Specs with Gemini 3.0 Pro...`, 'info', 'LLM_PRO');
      // PASS APP DESCRIPTION CONTEXT
      const result = await analyzeDatasheetPDF(comp, file, appDescription);
      
      setComponents(prev => prev.map(c => c.id === comp.id ? { 
        ...c, 
        pins: result.pins, 
        analysisReport: result.report,
        physicalSpecs: result.physicalSpecs,
        isolationRules: result.isolationRules,
        status: 'ready' 
      } : c));

      addLog(`Deep Analysis complete for ${comp.name}. Extracted physical dimensions & isolation rules.`, 'success', 'LLM_PRO');

    } catch (error) {
      addLog(`Failed to analyze PDF for ${comp.name}`, 'error', 'LLM_PRO');
    }
  };

  const handleStartProcessing = async () => {
    if (!mainComponent || !appDescription) return;
    setStage(AppStage.PROCESSING);
    setIsProcessing(true);
    addLog(`Initializing Design Pipeline for: ${mainComponent}`, 'info', 'CLIENT');

    try {
      // 1. Generate BOM
      addLog(`Generating Context-Aware Bill of Materials (BOM)...`, 'info', 'LLM_FLASH');
      const bom = await generateBOM(mainComponent, appDescription);
      setComponents(bom);
      addLog(`BOM Generated with ${bom.length} components.`, 'success', 'LLM_FLASH');

      // 2. Automated Search & Analysis for each Component
      addLog("Initiating Parallel Datasheet Search & Extraction...", 'info', 'DATASHEET_SPIDER');
      
      const updatedComponents = await Promise.all(bom.map(async (comp) => {
         addLog(`Searching technical data for: ${comp.name}`, 'info', 'DATASHEET_SPIDER');
         
         // Use Google Search + Gemini to find pinout and specs
         const searchResult = await searchComponentData(comp.name, appDescription);
         
         if (searchResult.pins.length > 0) {
             addLog(`Found data for ${comp.name}: ${searchResult.pins.length} pins, ${searchResult.physicalSpecs?.packageType || 'Unknown Package'}`, 'success', 'DATASHEET_SPIDER');
             return { 
                 ...comp, 
                 pins: searchResult.pins, 
                 status: 'ready', 
                 datasheetUrl: searchResult.datasheetUrl,
                 physicalSpecs: searchResult.physicalSpecs,
                 isolationRules: searchResult.isolationRules 
             } as ComponentItem;
         } else {
             // Fallback
             addLog(`Deep search failed for ${comp.name}. Using heuristic generation.`, 'warning', 'DATASHEET_SPIDER');
             const fallbackPins = await analyzePins(comp.name, appDescription);
             return { ...comp, pins: fallbackPins, status: 'ready' } as ComponentItem;
         }
      }));

      setComponents(updatedComponents);

      // 3. Compatibility Check
      addLog("Running Electrical Rule Check (ERC) & Compatibility Analysis...", 'info', 'LLM_PRO');
      const report = await checkSystemCompatibility(updatedComponents, appDescription);
      setCompatibilityReport(report);
      
      if (!report.isCompatible) {
        addLog(`Compatibility Issues Found: ${report.issues.length}`, 'warning', 'LLM_PRO');
      } else {
        addLog("System Design Verified. No critical issues.", 'success', 'LLM_PRO');
      }

      // 4. Generate Netlist
      addLog("Synthesizing Schematic Netlist...", 'info', 'BUILDER');
      const mainCompId = updatedComponents[0]?.id;
      const generatedNets = await generateNetlist(updatedComponents, mainCompId);
      setNets(generatedNets);
      addLog(`Netlist created with ${generatedNets.length} distinct nets.`, 'success', 'BUILDER');

      setStage(AppStage.SCHEMATIC);
    } catch (error) {
      console.error(error);
      addLog("Critical System Failure during processing.", 'error', 'CLIENT');
    } finally {
      setIsProcessing(false);
    }
  };


  // --- UI Renderers ---

  const renderProjects = () => (
    <div className="w-full h-full p-12 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-12">
           <div>
             <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">AutoSchematic AI</h1>
             <p className="text-eda-muted text-lg">Next-Gen Generative EDA Suite</p>
           </div>
           <button 
             onClick={createProject}
             className="bg-eda-accent hover:bg-cyan-400 text-slate-900 px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/20"
           >
             <Plus size={20}/> New Project
           </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(p => (
            <div 
              key={p.id} 
              onClick={() => loadProject(p)}
              className="group bg-eda-panel border border-eda-border p-6 rounded-xl hover:border-eda-accent cursor-pointer transition-all hover:shadow-xl relative"
            >
               <div className="flex justify-between items-start mb-4">
                 <Folder className="text-eda-accent" size={32}/>
                 <button onClick={(e) => deleteProject(e, p.id)} className="text-eda-muted hover:text-red-400 p-2"><Trash2 size={16}/></button>
               </div>
               <h3 className="text-xl font-bold text-white mb-2 group-hover:text-eda-accent transition-colors">{p.name}</h3>
               <p className="text-eda-muted text-sm line-clamp-2">{p.appDescription}</p>
               <div className="mt-4 pt-4 border-t border-eda-border flex justify-between text-xs text-eda-muted font-mono">
                 <span>{p.components.length} Components</span>
                 <span>{new Date(p.lastModified).toLocaleDateString()}</span>
               </div>
            </div>
          ))}
          
          {projects.length === 0 && (
            <div className="col-span-full py-20 text-center text-eda-muted border-2 border-dashed border-eda-border rounded-xl">
               <p>No projects found. Start a new design.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderInputStage = () => (
    <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-eda-bg to-slate-900">
      <div className="w-full max-w-2xl bg-eda-panel p-8 rounded-2xl border border-eda-border shadow-2xl">
        <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
          <Cpu className="text-eda-accent" /> Design Parameters
        </h2>
        
        <div className="space-y-6">
          <div>
             <label className="block text-eda-muted text-sm font-bold mb-2 uppercase tracking-wider">Project Name</label>
             <input 
               className="w-full bg-eda-bg border border-eda-border rounded-lg p-4 text-white focus:border-eda-accent focus:outline-none transition-colors"
               value={projectName}
               onChange={e => setProjectName(e.target.value)}
               placeholder="e.g., Smart Home Hub v1"
             />
          </div>

          <div>
            <label className="block text-eda-muted text-sm font-bold mb-2 uppercase tracking-wider">Main Component / MCU</label>
            <input 
              className="w-full bg-eda-bg border border-eda-border rounded-lg p-4 text-white focus:border-eda-accent focus:outline-none transition-colors font-mono"
              value={mainComponent}
              onChange={e => setMainComponent(e.target.value)}
              placeholder="e.g., ESP32-WROOM-32, STM32F401"
            />
          </div>
          
          <div>
            <label className="block text-eda-muted text-sm font-bold mb-2 uppercase tracking-wider">Application Context (Crucial for AI)</label>
            <textarea 
              className="w-full bg-eda-bg border border-eda-border rounded-lg p-4 text-white focus:border-eda-accent focus:outline-none transition-colors h-32 resize-none"
              value={appDescription}
              onChange={e => setAppDescription(e.target.value)}
              placeholder="Describe the use case, environment, and required peripherals. E.g., 'Automotive sensor node reading 12V signals, needs CAN bus, reverse polarity protection, and robust 5V regulation.'"
            />
          </div>

          <div className="pt-4 flex gap-4">
             <button onClick={() => setStage(AppStage.PROJECTS)} className="px-6 py-4 rounded-lg font-bold text-eda-muted hover:text-white transition-colors">Back</button>
             <button 
                className="flex-1 bg-eda-accent hover:bg-cyan-400 text-slate-900 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                onClick={handleStartProcessing}
             >
                <Play size={20} fill="currentColor" /> Generate Schematic
             </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderProcessingStage = () => (
    <div className="w-full h-full flex flex-col">
       <div className="h-1/2 border-b border-eda-border bg-eda-bg relative">
          <ArchitectureDiagram />
          {/* Overlay Status */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-eda-panel/90 backdrop-blur border border-eda-accent/30 px-6 py-3 rounded-full flex items-center gap-3 shadow-xl">
             <Loader2 className="animate-spin text-eda-accent" size={20}/>
             <span className="text-eda-accent font-mono text-sm">
               {components.length === 0 ? "Analyzing Architecture..." : 
                nets.length === 0 ? `Processing Components (${components.filter(c => c.status === 'ready').length}/${components.length})...` :
                "Finalizing Netlist..."}
             </span>
          </div>
       </div>
       <div className="h-1/2 bg-black p-4 font-mono text-xs overflow-auto">
          {logs.map((log, i) => (
            <div key={i} className={`mb-1 flex gap-3 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-400'}`}>
               <span className="opacity-50 min-w-[80px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
               <span className={`font-bold px-2 py-0.5 rounded text-[10px] bg-white/5 w-[120px] text-center shrink-0 ${
                   log.system === 'LLM_PRO' ? 'text-purple-400' : 
                   log.system === 'DATASHEET_SPIDER' ? 'text-orange-400' : 
                   'text-blue-400'
               }`}>
                 {log.system}
               </span>
               <span>{log.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
       </div>
    </div>
  );

  const renderSchematicStage = () => (
    <div className="w-full h-full flex bg-eda-bg text-eda-text overflow-hidden">
      {/* Sidebar: Components */}
      <div className="w-80 flex-shrink-0 border-r border-eda-border bg-eda-panel flex flex-col">
        <div className="p-4 border-b border-eda-border bg-eda-bg/50 backdrop-blur">
          <div className="flex justify-between items-center mb-1">
             <h2 className="font-bold text-white flex items-center gap-2"><Layers size={18} className="text-eda-accent"/> Components</h2>
             <button onClick={saveProject} className="text-eda-muted hover:text-white" title="Save Project"><Save size={18}/></button>
          </div>
          <div className="text-xs text-eda-muted flex items-center gap-2">
             <span className={`w-2 h-2 rounded-full ${compatibilityReport?.isCompatible ? 'bg-green-500' : 'bg-red-500'}`}></span>
             {compatibilityReport?.isCompatible ? "Design Valid" : "Issues Found"}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {components.map(c => (
             <div 
               key={c.id} 
               onClick={() => setSelectedComponent(c)}
               className={`p-3 rounded border transition-all cursor-pointer ${selectedComponent?.id === c.id ? 'bg-eda-accent/10 border-eda-accent' : 'bg-eda-bg border-eda-border hover:border-slate-500'}`}
             >
                <div className="flex justify-between items-start mb-1">
                   <span className="font-bold text-sm text-white">{c.name}</span>
                   {c.status === 'ready' ? <CheckCircle size={14} className="text-green-500"/> : <Loader2 size={14} className="animate-spin text-eda-accent"/>}
                </div>
                <p className="text-xs text-eda-muted line-clamp-1 mb-2">{c.description}</p>
                
                {/* PDF Upload / Status */}
                {c.datasheetUrl ? (
                   <a href={c.datasheetUrl} target="_blank" rel="noreferrer" className="text-[10px] flex items-center gap-1 text-cyan-400 hover:underline" onClick={e => e.stopPropagation()}>
                      <Globe size={10}/> Datasheet
                   </a>
                ) : (
                   <label className="text-[10px] flex items-center gap-1 text-eda-muted hover:text-white cursor-pointer bg-white/5 p-1 rounded justify-center">
                      <Upload size={10}/> Upload PDF
                      <input type="file" className="hidden" accept=".pdf" onChange={(e) => handleFileUpload(e, c)} />
                   </label>
                )}
             </div>
          ))}
        </div>

        {/* Compatibility Report Mini-View */}
        {compatibilityReport && !compatibilityReport.isCompatible && (
           <div className="p-4 bg-red-900/20 border-t border-red-900/50">
              <h3 className="text-red-400 font-bold text-xs mb-2 flex items-center gap-2"><AlertTriangle size={12}/> Design Issues</h3>
              <ul className="text-[10px] text-red-200 list-disc pl-4 space-y-1">
                 {compatibilityReport.issues.slice(0, 3).map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
           </div>
        )}
      </div>

      {/* Main Schematic Canvas */}
      <div className="flex-1 flex flex-col relative">
         <SchematicView 
            data={{ components, nets }} 
            onLayoutChange={handleLayoutChange} 
         />
      </div>

      {/* Right Sidebar: Details */}
      <div className="w-80 flex-shrink-0 border-l border-eda-border bg-eda-panel flex flex-col">
          {selectedComponent ? (
            <div className="p-0 flex flex-col h-full">
               <div className="p-4 border-b border-eda-border bg-eda-bg">
                  <h2 className="font-bold text-lg text-white mb-1">{selectedComponent.name}</h2>
                  <span className="text-xs font-mono text-eda-accent bg-eda-accent/10 px-2 py-0.5 rounded">{selectedComponent.footprintType}</span>
               </div>
               
               <div className="p-4 flex-1 overflow-y-auto">
                  <div className="mb-6">
                     <h3 className="text-xs font-bold text-eda-muted uppercase mb-2">Technical Specs</h3>
                     <div className="bg-eda-bg rounded p-3 text-xs font-mono text-slate-300 space-y-1">
                        <div className="flex justify-between"><span>Width:</span> <span className="text-white">{selectedComponent.physicalSpecs?.widthMm || '?'} mm</span></div>
                        <div className="flex justify-between"><span>Pitch:</span> <span className="text-white">{selectedComponent.physicalSpecs?.pinPitchMm || '?'} mm</span></div>
                        <div className="flex justify-between"><span>Pins:</span> <span className="text-white">{selectedComponent.pins?.length || 0}</span></div>
                     </div>
                  </div>

                  {selectedComponent.isolationRules && selectedComponent.isolationRules.length > 0 && (
                      <div className="mb-6">
                        <h3 className="text-xs font-bold text-orange-400 uppercase mb-2 flex items-center gap-2"><AlertTriangle size={12}/> Isolation Rules</h3>
                        <ul className="list-disc pl-4 text-xs text-orange-200/80 space-y-1">
                           {selectedComponent.isolationRules.map((rule, i) => <li key={i}>{rule}</li>)}
                        </ul>
                      </div>
                  )}

                  <div className="mb-6">
                     <h3 className="text-xs font-bold text-eda-muted uppercase mb-2">Pin Configuration</h3>
                     <div className="space-y-1">
                        {selectedComponent.pins?.map((pin, i) => (
                           <div key={i} className="flex items-center text-xs bg-eda-bg/50 p-1.5 rounded border border-transparent hover:border-eda-border">
                              <span className="font-mono text-eda-accent w-6 mr-2 text-right">{pin.pinNumber}</span>
                              <span className="text-white font-bold mr-auto">{pin.name}</span>
                              <span className="text-[10px] text-eda-muted bg-white/5 px-1.5 rounded">{pin.type}</span>
                              {pin.electrical?.behavior && <span className="ml-1 text-[9px] text-yellow-500" title={pin.electrical.behavior}>⚡</span>}
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-eda-muted p-8 text-center">
               <MousePointer2 size={48} className="mb-4 opacity-20"/>
               <p>Select a component to view deep technical analysis and physical specs.</p>
            </div>
          )}
          
          <div className="p-4 border-t border-eda-border bg-eda-bg">
             <button onClick={handleDownloadCAD} className="w-full bg-eda-accent hover:bg-cyan-400 text-slate-900 font-bold py-3 rounded flex items-center justify-center gap-2 transition-all">
                <Download size={18}/> Export .SCH
             </button>
             <p className="text-[10px] text-center mt-2 text-eda-muted">Compatible with Eagle, Altium, KiCad</p>
          </div>
      </div>
    </div>
  );

  return (
    <div className="w-screen h-screen bg-eda-bg text-eda-text font-sans overflow-hidden">
      {stage === AppStage.PROJECTS && renderProjects()}
      {stage === AppStage.INPUT && renderInputStage()}
      {stage === AppStage.PROCESSING && renderProcessingStage()}
      {stage === AppStage.SCHEMATIC && renderSchematicStage()}
    </div>
  );
};

export default App;