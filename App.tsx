
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
import { generateKiCadSchematic } from './services/exportService';
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
  Download
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
  const [schematicLayout, setSchematicLayout] = useState<Record<string, {x: number, y: number, w: number, h: number}>>({});

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
    addLog("Generating KiCad Schematic file...", 'info', 'BUILDER');
    
    try {
      const kicadContent = generateKiCadSchematic({ components, nets }, schematicLayout);
      
      // Trigger Download
      const blob = new Blob([kicadContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.replace(/\s+/g, '_')}_Schematic.kicad_sch`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog("KiCad Schematic downloaded. File is compatible with KiCad 6+ and Altium.", 'success', 'BUILDER');
    } catch (e) {
      console.error(e);
      addLog("Failed to generate CAD file.", 'error', 'BUILDER');
    }
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
      addLog(`Analyzing PDF structure with Gemini 3.0 Pro...`, 'info', 'LLM_PRO');
      const result = await analyzeDatasheetPDF(comp, file);
      
      setComponents(prev => prev.map(c => c.id === comp.id ? { 
        ...c, 
        pins: result.pins, 
        analysisReport: result.report,
        status: 'ready' 
      } : c));

      addLog(`PDF Analysis complete for ${comp.name}. Extracted ${result.pins.length} pins.`, 'success', 'LLM_PRO');

    } catch (error) {
      addLog(`Failed to analyze PDF for ${comp.name}`, 'error', 'LLM_PRO');
    }
  };

  const handleStartProcessing = async () => {
    if (!mainComponent || !appDescription) return;
    setStage(AppStage.PROCESSING);
    setIsProcessing(true);
    setLogs([]);
    
    // Update project name based on component if it's new
    if (projectName === "New Project" || projectName === "Untitled Project") {
      setProjectName(`${mainComponent} Design`);
    }

    try {
      // 1. Generate BOM
      addLog("Generating BOM structure...", 'info', 'LLM_FLASH');
      let currentComponents = await generateBOM(mainComponent, appDescription);
      setComponents(currentComponents);
      addLog(`BOM Generated: ${currentComponents.length} components. Starting Auto-Search for Datasheets...`, 'success', 'LLM_FLASH');
      
      // 2. Auto-Fetch Datasheets Loop
      for (let i = 0; i < currentComponents.length; i++) {
        const comp = currentComponents[i];
        
        // Update status to 'searching'
        setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, status: 'searching_datasheet' } : c));
        
        addLog(`Searching web for ${comp.name} datasheet & pinout...`, 'info', 'DATASHEET_SPIDER');
        const searchResult = await searchComponentData(comp.name);
        
        if (searchResult.pins && searchResult.pins.length > 0) {
           addLog(`Found data for ${comp.name}: ${searchResult.pins.length} pins.`, 'success', 'DATASHEET_SPIDER');
           currentComponents[i] = {
             ...comp,
             pins: searchResult.pins,
             description: searchResult.description || comp.description,
             datasheetUrl: searchResult.datasheetUrl,
             status: 'ready'
           };
        } else {
           addLog(`Could not auto-fetch ${comp.name}. Using fallback estimation.`, 'warning', 'DATASHEET_SPIDER');
           currentComponents[i] = {
             ...comp,
             status: 'pending' // Leaves it open for manual upload if user wants, but we will proceed
           };
        }
        
        // Update state progressively
        setComponents([...currentComponents]);
      }

      addLog("Auto-Fetch Complete. Proceeding to System Compatibility Analysis...", 'info', 'CLIENT');
      
      // 3. Trigger Analysis automatically
      await executeAnalysis(currentComponents);

    } catch (error) {
      addLog(`Error: ${error}`, 'error', 'CLIENT');
      setIsProcessing(false);
    }
  };

  const executeAnalysis = async (currentComponents: ComponentItem[]) => {
    setCompatibilityReport(null); 
    addLog("Starting System Compatibility Check with Gemini 3.0 Pro...", 'info', 'LLM_PRO');

    // 1. Fill in missing data (Auto-analyze those without PDFs or Web Data)
    const updatedComponents = [...currentComponents];
    for (let i = 0; i < updatedComponents.length; i++) {
       if (!updatedComponents[i].pins || updatedComponents[i].pins?.length === 0) {
         addLog(`No pinout for ${updatedComponents[i].name}. Running web-knowledge inference...`, 'warning', 'LLM_FLASH');
         const pins = await analyzePins(updatedComponents[i].name);
         updatedComponents[i].pins = pins;
         updatedComponents[i].status = 'ready';
       }
    }
    setComponents(updatedComponents);

    // 2. Compatibility Check
    const report = await checkSystemCompatibility(updatedComponents);
    setCompatibilityReport(report);

    if (report.isCompatible) {
       addLog("System Compatibility Verified. No major issues found.", 'success', 'LLM_PRO');
       // 3. Generate Schematic only if compatible
       addLog("Generating Netlist & Schematic Layout...", 'info', 'BUILDER');
       const netlist = await generateNetlist(updatedComponents, updatedComponents[0].id);
       setNets(netlist);
       setStage(AppStage.SCHEMATIC);
       addLog("CAD Window Ready.", 'success', 'BUILDER');
    } else {
       addLog(`Compatibility Issues: ${report.issues.length} found. Review actions required.`, 'warning', 'LLM_PRO');
       setStage(AppStage.PROCESSING); // Stay on processing/components view
    }

    setIsProcessing(false);
  };

  const handleRunAnalysis = async () => {
    setIsProcessing(true);
    await executeAnalysis(components);
  };

  // Iterative Loop: Apply Fixes
  const applyFixes = () => {
    if (!compatibilityReport?.actions) return;

    const newComponents = [...components];
    const newItems: ComponentItem[] = [];
    
    compatibilityReport.actions.forEach((action: ComponentAction) => {
      if (action.type === 'REMOVE') {
        const idx = newComponents.findIndex(c => c.name.toLowerCase().includes(action.componentName.toLowerCase()));
        if (idx !== -1) {
          addLog(`Removing ${action.componentName} per recommendation...`, 'warning', 'CLIENT');
          newComponents.splice(idx, 1);
        }
      } else if (action.type === 'ADD') {
        // Reuse logic: Check if exists
        const exists = newComponents.some(c => c.name.toLowerCase() === action.componentName.toLowerCase());
        if (!exists) {
          addLog(`Adding ${action.componentName} to component list.`, 'info', 'CLIENT');
          const newItem: ComponentItem = {
            id: `comp_auto_${Math.random().toString(36).substr(2, 5)}`,
            name: action.componentName,
            description: action.description || "Added by AI Recommendation",
            footprintType: "Unknown",
            status: 'pending'
          };
          newComponents.push(newItem);
          newItems.push(newItem);
        }
      }
    });

    setComponents(newComponents);
    setCompatibilityReport(null); 
    
    // Auto-fetch for the new items immediately
    if (newItems.length > 0) {
      autoFetchNewItems(newComponents, newItems);
    } else {
       addLog("Adjustments made. Please Re-run Analysis.", 'info', 'CLIENT');
    }
  };

  const autoFetchNewItems = async (allComponents: ComponentItem[], newItems: ComponentItem[]) => {
    setIsProcessing(true);
    addLog(`Auto-fetching data for ${newItems.length} new recommended components...`, 'info', 'DATASHEET_SPIDER');
    
    const updatedComponents = [...allComponents];

    for (const newItem of newItems) {
      const idx = updatedComponents.findIndex(c => c.id === newItem.id);
      if (idx === -1) continue;

      updatedComponents[idx] = { ...updatedComponents[idx], status: 'searching_datasheet' };
      setComponents([...updatedComponents]); // Update UI

      const searchResult = await searchComponentData(newItem.name);
       if (searchResult.pins && searchResult.pins.length > 0) {
           addLog(`Found data for ${newItem.name}.`, 'success', 'DATASHEET_SPIDER');
           updatedComponents[idx] = {
             ...updatedComponents[idx],
             pins: searchResult.pins,
             description: searchResult.description || updatedComponents[idx].description,
             datasheetUrl: searchResult.datasheetUrl,
             status: 'ready'
           };
        } else {
           updatedComponents[idx].status = 'pending';
        }
        setComponents([...updatedComponents]);
    }
    
    setIsProcessing(false);
    addLog("New components ready. Click 'Run Analysis' to verify.", 'info', 'CLIENT');
  };

  return (
    <div className="flex flex-col h-screen bg-eda-bg text-eda-text font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-eda-border bg-eda-panel flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setStage(AppStage.PROJECTS)}>
          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2 rounded-lg">
            <Cpu className="text-white" size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">AutoSchematic AI</h1>
            <p className="text-xs text-eda-muted font-mono">Professional Suite</p>
          </div>
        </div>
        
        {stage !== AppStage.PROJECTS && (
          <div className="flex items-center gap-2 bg-slate-800/50 px-4 py-2 rounded-lg border border-eda-border">
             <input 
               value={projectName} 
               onChange={(e) => setProjectName(e.target.value)}
               className="bg-transparent border-none text-sm font-bold text-white focus:outline-none w-48 text-center"
             />
          </div>
        )}

        <div className="flex items-center gap-4">
           {stage === AppStage.SCHEMATIC && (
             <button onClick={handleDownloadCAD} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-sm transition-colors shadow-lg">
               <Download size={14} /> Export KiCad
             </button>
           )}

          <button 
            onClick={() => setStage(AppStage.PROJECTS)} 
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm hover:bg-slate-700 ${stage === AppStage.PROJECTS ? 'bg-cyan-900 text-cyan-200' : 'text-slate-400'}`}
          >
            <Folder size={14} /> Projects
          </button>
          
          {stage !== AppStage.PROJECTS && (
            <>
              <div className="h-6 w-[1px] bg-eda-border"></div>
              <button onClick={() => setStage(AppStage.INPUT)} className={`px-3 py-1.5 rounded text-sm ${stage === AppStage.INPUT ? 'bg-cyan-900 text-cyan-200' : 'text-slate-400'}`}>Input</button>
              <button onClick={() => setStage(AppStage.ARCH_DIAGRAM)} className={`px-3 py-1.5 rounded text-sm ${stage === AppStage.ARCH_DIAGRAM ? 'bg-cyan-900 text-cyan-200' : 'text-slate-400'}`}>Arch</button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* --- PROJECTS DASHBOARD VIEW --- */}
        {stage === AppStage.PROJECTS ? (
           <div className="w-full h-full overflow-auto bg-slate-900 p-8">
              <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-3xl font-bold text-white tracking-tight">Your Projects</h2>
                  <button 
                    onClick={createProject}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 shadow-lg transition-all"
                  >
                    <Plus size={20} /> Create Project
                  </button>
                </div>

                {projects.length === 0 ? (
                  <div className="text-center py-20 border-2 border-dashed border-slate-700 rounded-xl">
                    <Folder size={48} className="mx-auto text-slate-600 mb-4" />
                    <p className="text-slate-400 text-lg">No projects yet. Start building something amazing.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((p) => (
                      <div key={p.id} className="bg-eda-panel border border-eda-border rounded-xl p-6 hover:border-cyan-500 transition-all cursor-pointer group shadow-lg relative" onClick={() => loadProject(p)}>
                        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={(e) => deleteProject(e, p.id)} className="p-2 hover:bg-red-900/30 text-red-400 rounded-full"><Trash2 size={16}/></button>
                        </div>
                        <h3 className="text-xl font-bold text-cyan-100 mb-1">{p.name}</h3>
                        <p className="text-xs text-slate-500 font-mono mb-4">Last edited: {new Date(p.lastModified).toLocaleDateString()}</p>
                        
                        <div className="space-y-2 mb-6">
                           <div className="flex items-center gap-2 text-sm text-slate-300">
                              <Cpu size={14} className="text-cyan-500"/>
                              <span>{p.mainComponent}</span>
                           </div>
                           <div className="flex items-center gap-2 text-sm text-slate-300">
                              <Layers size={14} className="text-purple-500"/>
                              <span>{p.components.length} Components</span>
                           </div>
                           {p.compatibilityReport && (
                              <div className="flex items-center gap-2 text-sm">
                                 {p.compatibilityReport.isCompatible 
                                   ? <span className="text-green-400 flex gap-1 items-center"><CheckCircle size={14}/> Verified</span>
                                   : <span className="text-yellow-400 flex gap-1 items-center"><AlertTriangle size={14}/> Issues Found</span>
                                 }
                              </div>
                           )}
                        </div>

                        <div className="flex items-center text-cyan-400 text-sm font-bold group-hover:translate-x-1 transition-transform">
                          Open Project <ArrowRight size={16} className="ml-1"/>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
           </div>
        ) : (
          <>
            {/* Sidebar (Editor Mode) */}
            <aside className="w-96 border-r border-eda-border bg-eda-panel/50 flex flex-col shrink-0">
              <div className="p-4 border-b border-eda-border">
                 <button 
                   onClick={saveProject}
                   className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 rounded flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                 >
                   <Save size={16} /> Save Project
                 </button>
              </div>

              <div className="flex-1 overflow-auto p-4">
                <h3 className="text-xs font-bold text-eda-muted uppercase mb-4 flex items-center gap-2">
                  <Layers size={14} /> Design Components
                </h3>
                
                <div className="space-y-3">
                  {components.map(c => (
                    <div 
                      key={c.id} 
                      className={`p-3 rounded-lg border text-sm transition-all relative group ${selectedComponent?.id === c.id ? 'border-cyan-500 bg-cyan-900/10' : 'border-eda-border bg-slate-800/50'}`}
                      onClick={() => setSelectedComponent(c)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-mono font-bold text-cyan-300">{c.name}</span>
                        <div className="flex items-center gap-2">
                           {c.status === 'searching_datasheet' && <Loader2 size={14} className="animate-spin text-cyan-500"/>}
                           {c.status === 'ready' && <CheckCircle size={14} className="text-green-500"/>}
                           {(c.datasheetFile) && <FileText size={14} className="text-blue-400"/>}
                           {(c.datasheetUrl && !c.datasheetFile) && <Globe size={14} className="text-blue-400"/>}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mb-3 line-clamp-2">{c.description}</p>
                      
                      {/* Upload / Link Display */}
                      <div className="flex gap-2">
                         {c.datasheetUrl && !c.datasheetUrl.startsWith('data:') ? (
                            <a href={c.datasheetUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-cyan-400 py-1.5 px-3 rounded text-xs transition-colors">
                               <Globe size={12} /> View Datasheet Source
                            </a>
                         ) : (
                            <label className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 py-1.5 px-3 rounded cursor-pointer text-xs transition-colors">
                              <Upload size={12} />
                              {c.datasheetFile ? 'Update PDF' : 'Upload Manual PDF'}
                              <input 
                                type="file" 
                                accept=".pdf" 
                                className="hidden" 
                                onChange={(e) => handleFileUpload(e, c)}
                              />
                            </label>
                         )}
                      </div>
                    </div>
                  ))}
                </div>

                {components.length > 0 && (stage === AppStage.PROCESSING || stage === AppStage.SCHEMATIC || stage === AppStage.INPUT) && (
                  <div className="mt-6 flex flex-col gap-2">
                    {/* Run / Re-run Button */}
                    <button 
                      onClick={handleRunAnalysis}
                      disabled={isProcessing}
                      className={`w-full font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg transition-all
                        ${isProcessing ? 'bg-slate-600 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white'}
                      `}
                    >
                      {isProcessing ? <Activity className="animate-spin" /> : <RefreshCw size={18} />}
                      {stage === AppStage.SCHEMATIC ? 'Re-run Analysis' : 'Run System Analysis'}
                    </button>
                    {stage === AppStage.SCHEMATIC && <p className="text-center text-[10px] text-slate-500">Run again if you modified components.</p>}
                  </div>
                )}
              </div>

              {/* Logs */}
              <div className="h-48 border-t border-eda-border bg-black p-3 flex flex-col font-mono text-[10px]">
                <div className="flex-1 overflow-y-auto space-y-1 pr-2">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-slate-600 shrink-0">[{new Date(log.timestamp).toLocaleTimeString([], {hour12: false, minute:'2-digit', second:'2-digit'})}]</span>
                      <span className={`${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-400' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'}`}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </aside>

            {/* Right Content */}
            <section className="flex-1 relative bg-slate-100 overflow-hidden flex flex-col">
              
              {/* Input Stage */}
              {stage === AppStage.INPUT && (
                <div className="flex-1 flex flex-col items-center justify-center bg-eda-bg p-8">
                  <div className="max-w-2xl w-full bg-eda-panel border border-eda-border rounded-xl p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-3 rounded-full bg-cyan-500/20 text-cyan-400"><PenTool size={24} /></div>
                      <h2 className="text-2xl font-bold text-white">Project Setup</h2>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Main Controller</label>
                        <input type="text" value={mainComponent} onChange={(e) => setMainComponent(e.target.value)} className="w-full bg-eda-bg border border-eda-border rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="e.g., STM32F4" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Application Goal</label>
                        <textarea value={appDescription} onChange={(e) => setAppDescription(e.target.value)} className="w-full bg-eda-bg border border-eda-border rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none h-32 resize-none" />
                      </div>
                      <button onClick={handleStartProcessing} disabled={isProcessing} className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg flex items-center justify-center gap-2">
                        {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} fill="currentColor" />} 
                        {isProcessing ? 'Initializing...' : 'Initialize Design'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Architecture Stage */}
              {stage === AppStage.ARCH_DIAGRAM && <ArchitectureDiagram />}

              {/* Schematic Stage */}
              {(stage === AppStage.PROCESSING || stage === AppStage.SCHEMATIC) && (
                <div className="flex-1 h-full relative">
                    {/* Render Schematic if we have nets, otherwise just components placeholder */}
                    {(stage === AppStage.SCHEMATIC && nets.length > 0) ? (
                      <SchematicView 
                        data={{ components, nets }} 
                        onLayoutChange={setSchematicLayout}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-white">
                        <Activity size={48} className={`mb-4 ${isProcessing ? 'animate-spin text-cyan-500' : 'text-slate-300'}`} />
                        <p className="text-lg font-medium">{isProcessing ? 'Analyzing System & Fetching Datasheets...' : 'Ready to Analyze'}</p>
                        <p className="text-sm mt-2 text-slate-500">
                          {isProcessing ? "AI is searching the web for component specifications." : "Upload datasheets for best results."}
                        </p>
                      </div>
                    )}

                    {/* Compatibility Overlay */}
                    {compatibilityReport && (
                      <div className="absolute top-4 right-4 max-w-sm w-full bg-white/95 backdrop-blur shadow-xl border border-slate-200 rounded-lg p-4 animate-slideIn max-h-[80vh] overflow-auto z-10">
                        <h4 className={`font-bold text-sm mb-2 flex items-center gap-2 ${compatibilityReport.isCompatible ? 'text-green-600' : 'text-red-600'}`}>
                          {compatibilityReport.isCompatible ? <CheckCircle size={16}/> : <AlertTriangle size={16}/>}
                          {compatibilityReport.isCompatible ? 'System Verified' : 'Attention Needed'}
                        </h4>
                        
                        {!compatibilityReport.isCompatible && (
                          <>
                            <div className="space-y-2 mb-3">
                              {compatibilityReport.issues.map((issue, i) => (
                                <div key={i} className="text-xs text-red-700 bg-red-50 p-2 rounded border border-red-100">{issue}</div>
                              ))}
                            </div>
                            
                            {compatibilityReport.actions && compatibilityReport.actions.length > 0 && (
                              <div className="mb-4">
                                <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Recommended Actions</p>
                                <div className="space-y-2">
                                  {compatibilityReport.actions.map((action, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                                      <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 ${action.type === 'ADD' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {action.type === 'ADD' ? '+' : '-'}
                                      </div>
                                      <div>
                                        <span className="font-bold">{action.type} {action.componentName}</span>
                                        <p className="text-slate-500 leading-tight mt-0.5">{action.reason}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button 
                                  onClick={applyFixes}
                                  className="mt-3 w-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold py-2 rounded flex items-center justify-center gap-2"
                                >
                                  <Wrench size={12} /> Apply AI Recommendations
                                </button>
                              </div>
                            )}
                          </>
                        )}

                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Analysis Notes</p>
                          {compatibilityReport.recommendations.map((rec, i) => (
                              <div key={i} className="text-xs text-slate-600">• {rec}</div>
                            ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
