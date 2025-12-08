import React from 'react';

const Node = ({ title, sub, x, y, color = "stroke-cyan-500", fill = "fill-slate-900" }: { title: string, sub?: string, x: number, y: number, color?: string, fill?: string }) => (
  <g transform={`translate(${x},${y})`}>
    <rect x="0" y="0" width="180" height="80" rx="6" className={`stroke-2 ${color} ${fill}`} />
    <text x="90" y="35" textAnchor="middle" className="fill-white font-bold text-sm pointer-events-none">{title}</text>
    {sub && <text x="90" y="55" textAnchor="middle" className="fill-slate-400 text-xs pointer-events-none">{sub}</text>}
  </g>
);

const Edge = ({ x1, y1, x2, y2, label }: { x1: number, y1: number, x2: number, y2: number, label?: string }) => {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g>
      <path d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`} className="stroke-slate-500 stroke-2 fill-none marker-end" markerEnd="url(#arrowhead)" />
      {label && (
        <rect x={midX - 30} y={midY - 10} width="60" height="20" rx="4" className="fill-slate-800" />
      )}
      {label && <text x={midX} y={midY + 4} textAnchor="middle" className="fill-cyan-400 text-xs font-mono">{label}</text>}
    </g>
  );
};

export const ArchitectureDiagram: React.FC = () => {
  return (
    <div className="w-full h-full flex items-center justify-center bg-eda-bg overflow-auto p-8">
      <svg width="1000" height="600" viewBox="0 0 1000 600" className="bg-eda-panel rounded-xl border border-eda-border shadow-2xl">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" className="fill-slate-500" />
          </marker>
        </defs>

        <text x="30" y="40" className="fill-white font-mono text-xl font-bold opacity-50">SYSTEM ARCHITECTURE v1.0</text>

        {/* Phase 1 */}
        <Node title="Client Interface" sub="Input Processing" x={50} y={250} color="stroke-indigo-500" />
        
        {/* Phase 2 */}
        <Node title="LLM (Flash)" sub="Structure & BOM" x={300} y={150} color="stroke-cyan-500" />
        
        {/* Phase 3 */}
        <Node title="Datasheet Spider" sub="Automated Retrieval" x={300} y={350} color="stroke-green-500" />
        
        {/* Phase 4 */}
        <Node title="CV Pipeline" sub="Footprint Engine" x={550} y={450} color="stroke-green-500" />
        <Node title="LLM (Pro)" sub="Pin Logic Analysis" x={550} y={150} color="stroke-purple-500" />

        {/* Phase 5 */}
        <Node title="Builder Engine" sub="Schematic Assembly" x={800} y={250} color="stroke-rose-500" />

        {/* Edges */}
        <Edge x1={230} y1={290} x2={300} y2={190} label="JSON" />
        <Edge x1={230} y1={290} x2={300} y2={390} label="Request" />
        
        <Edge x1={480} y1={190} x2={550} y2={190} label="BOM" />
        <Edge x1={480} y1={390} x2={550} y2={490} label="PDFs" />
        
        <Edge x1={730} y1={190} x2={800} y2={290} label="Netlist" />
        <Edge x1={730} y1={490} x2={800} y2={290} label="Symbols" />

      </svg>
    </div>
  );
};