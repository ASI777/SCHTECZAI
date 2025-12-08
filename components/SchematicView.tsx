import React, { useMemo, useRef, useState, useEffect } from 'react';
import { SchematicData, ComponentItem, PinDefinition, Net } from '../types';
import { ZoomIn, ZoomOut, Move } from 'lucide-react';

interface SchematicViewProps {
  data: SchematicData;
}

const PIN_SPACING = 20;
const COMP_WIDTH_BASE = 100;
const HEADER_HEIGHT = 20;

export const SchematicView: React.FC<SchematicViewProps> = ({ data }) => {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Calculate layout coordinates
  const layout = useMemo(() => {
    const nodes: any[] = [];
    let currentX = 100;
    
    // Sort components: Main MCU in center, others around or linear for now
    // A simple robust layout: Line them up with some spacing
    
    data.components.forEach((comp, idx) => {
      // Determine height based on pins
      const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
      const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
      const topPins = comp.pins?.filter(p => p.side === 'top') || [];
      const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

      const maxSidePins = Math.max(leftPins.length, rightPins.length);
      const height = Math.max(80, maxSidePins * PIN_SPACING + HEADER_HEIGHT + 20);
      const width = COMP_WIDTH_BASE + (topPins.length + bottomPins.length) * 10;

      nodes.push({
        ...comp,
        x: currentX,
        y: 300 - height / 2, // Center vertically roughly
        w: width,
        h: height,
        pins: { left: leftPins, right: rightPins, top: topPins, bottom: bottomPins }
      });

      currentX += width + 250; // Spacing between components
    });

    return nodes;
  }, [data.components]);

  // Map Nets to SVG Paths
  const connections = useMemo(() => {
    const paths: React.ReactElement[] = [];

    data.nets.forEach((net, netIdx) => {
      const points: { x: number, y: number, side: string }[] = [];

      net.connections.forEach(conn => {
        const node = layout.find(n => n.id === conn.componentId);
        if (!node) return;

        // Find exact pin position
        let pinIndex = 0;
        let side = 'left';
        let pinX = 0;
        let pinY = 0;

        // Helper to find pin in groups
        const findPin = (group: PinDefinition[], s: string) => {
          const idx = group.findIndex(p => String(p.pinNumber) === String(conn.pin) || p.name === String(conn.pin));
          if (idx !== -1) {
            pinIndex = idx;
            side = s;
            return true;
          }
          return false;
        };

        if (findPin(node.pins.right, 'right')) {
          pinX = node.x + node.w;
          pinY = node.y + HEADER_HEIGHT + (pinIndex + 1) * PIN_SPACING;
        } else if (findPin(node.pins.left, 'left')) {
          pinX = node.x;
          pinY = node.y + HEADER_HEIGHT + (pinIndex + 1) * PIN_SPACING;
        } else if (findPin(node.pins.top, 'top')) {
          pinX = node.x + (node.w / (node.pins.top.length + 1)) * (pinIndex + 1);
          pinY = node.y;
        } else if (findPin(node.pins.bottom, 'bottom')) {
          pinX = node.x + (node.w / (node.pins.bottom.length + 1)) * (pinIndex + 1);
          pinY = node.y + node.h;
        } else {
            // Default fallback if pin not found in side groups
             pinX = node.x;
             pinY = node.y + HEADER_HEIGHT;
        }

        points.push({ x: pinX, y: pinY, side });
      });

      // Draw lines
      // Simplification: Direct lines or manhattan routing
      if (points.length > 1) {
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
          const p1 = points[i-1];
          const p2 = points[i];
          
          // Simple Manhattan Step
          const midX = (p1.x + p2.x) / 2;
          
          // If power/ground, maybe drop a flag instead? 
          // For now, draw lines.
          d += ` L ${midX} ${p1.y} L ${midX} ${p2.y} L ${p2.x} ${p2.y}`;
        }

        const color = net.type === 'power' ? '#ef4444' : net.type === 'ground' ? '#10b981' : '#06b6d4';
        
        paths.push(
          <g key={net.id}>
             <path d={d} stroke={color} strokeWidth="2" fill="none" opacity="0.8" />
             {/* Net Label on wire */}
             {points.length > 0 && (
               <text x={(points[0].x + points[1]?.x)/2 || points[0].x + 20} y={points[0].y - 5} fill={color} fontSize="10" fontFamily="monospace" fontWeight="bold">
                 {net.name}
               </text>
             )}
          </g>
        );
      } else if (points.length === 1) {
         // Single point net (usually global flag like VCC/GND)
         const p = points[0];
         const isPwr = net.type === 'power';
         const isGnd = net.type === 'ground';
         const color = isPwr ? '#ef4444' : isGnd ? '#10b981' : '#06b6d4';

         paths.push(
           <g key={net.id}>
             <line x1={p.x} y1={p.y} x2={p.side === 'left' ? p.x - 20 : p.x + 20} y2={p.y} stroke={color} strokeWidth="2" />
             <text x={p.side === 'left' ? p.x - 25 : p.x + 25} y={p.y + 4} textAnchor={p.side === 'left' ? 'end' : 'start'} fill={color} fontSize="12" fontWeight="bold">
               {net.name}
             </text>
             {isGnd && (
                <path d={`M ${p.side === 'left' ? p.x - 20 : p.x + 20} ${p.y - 5} L ${p.side === 'left' ? p.x - 20 : p.x + 20} ${p.y + 5} L ${p.side === 'left' ? p.x - 25 : p.x + 25} ${p.y}`} fill={color} />
             )}
             {isPwr && (
                 <circle cx={p.side === 'left' ? p.x - 20 : p.x + 20} cy={p.y} r="3" fill="none" stroke={color} />
             )}
           </g>
         );
      }
    });

    return paths;
  }, [data.nets, layout]);

  // Mouse Handlers for Pan/Zoom
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className="w-full h-full relative overflow-hidden bg-white select-none">
      {/* Grid Background */}
      <div className="absolute inset-0 pointer-events-none" 
           style={{ 
             backgroundSize: `${20 * scale}px ${20 * scale}px`,
             backgroundPosition: `${pan.x}px ${pan.y}px`,
             backgroundImage: 'linear-gradient(to right, #f1f5f9 1px, transparent 1px), linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)'
           }}>
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-white/90 shadow-lg border border-slate-200 p-2 rounded-lg">
        <button onClick={() => setScale(s => Math.min(s + 0.1, 3))} className="p-2 hover:bg-slate-100 rounded text-slate-600"><ZoomIn size={18}/></button>
        <button onClick={() => setScale(s => Math.max(s - 0.1, 0.5))} className="p-2 hover:bg-slate-100 rounded text-slate-600"><ZoomOut size={18}/></button>
        <button onClick={() => setPan({x: 0, y: 0})} className="p-2 hover:bg-slate-100 rounded text-slate-600"><Move size={18}/></button>
      </div>

      <div className="absolute top-4 left-4 z-10 bg-white/90 shadow border border-slate-200 px-3 py-1 rounded text-xs font-bold text-red-800 tracking-widest border-l-4 border-l-red-600">
        CAD VIEW v2.0
      </div>

      <svg 
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          
          {/* Component Bodies */}
          {layout.map(node => (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              {/* Main Body - Yellow with red stroke (Standard CAD look) */}
              <rect 
                width={node.w} 
                height={node.h} 
                className="fill-[#FFFFE0] stroke-[#8B0000] stroke-[2px]" 
                rx="0"
              />
              
              {/* Header / Name */}
              <text x={node.w / 2} y={HEADER_HEIGHT - 5} textAnchor="middle" className="fill-[#8B0000] font-bold font-sans text-sm tracking-wide">
                {node.name.toUpperCase()}
              </text>
              <line x1="0" y1={HEADER_HEIGHT} x2={node.w} y2={HEADER_HEIGHT} className="stroke-[#8B0000] stroke-[1px]" />

              {/* Pins - Left */}
              {node.pins.left.map((pin: PinDefinition, i: number) => (
                <g key={`l-${i}`} transform={`translate(0, ${HEADER_HEIGHT + (i + 1) * PIN_SPACING})`}>
                  <line x1="-5" y1="0" x2="0" y2="0" className="stroke-[#8B0000] stroke-1" />
                  <text x="-8" y="3" textAnchor="end" className="fill-[#8B0000] text-[10px] font-mono">{pin.pinNumber}</text>
                  <text x="5" y="3" textAnchor="start" className="fill-[#8B0000] text-[10px] font-sans font-semibold">{pin.name}</text>
                </g>
              ))}

              {/* Pins - Right */}
              {node.pins.right.map((pin: PinDefinition, i: number) => (
                <g key={`r-${i}`} transform={`translate(${node.w}, ${HEADER_HEIGHT + (i + 1) * PIN_SPACING})`}>
                  <line x1="0" y1="0" x2="5" y2="0" className="stroke-[#8B0000] stroke-1" />
                  <text x="8" y="3" textAnchor="start" className="fill-[#8B0000] text-[10px] font-mono">{pin.pinNumber}</text>
                  <text x="-5" y="3" textAnchor="end" className="fill-[#8B0000] text-[10px] font-sans font-semibold">{pin.name}</text>
                </g>
              ))}

               {/* Pins - Top */}
               {node.pins.top.map((pin: PinDefinition, i: number) => (
                <g key={`t-${i}`} transform={`translate(${(node.w / (node.pins.top.length + 1)) * (i + 1)}, 0)`}>
                  <line x1="0" y1="-5" x2="0" y2="0" className="stroke-[#8B0000] stroke-1" />
                  <text x="0" y="-8" textAnchor="middle" className="fill-[#8B0000] text-[10px] font-mono">{pin.name}</text>
                </g>
              ))}

               {/* Pins - Bottom */}
               {node.pins.bottom.map((pin: PinDefinition, i: number) => (
                <g key={`b-${i}`} transform={`translate(${(node.w / (node.pins.bottom.length + 1)) * (i + 1)}, ${node.h})`}>
                  <line x1="0" y1="0" x2="0" y2="5" className="stroke-[#8B0000] stroke-1" />
                  <text x="0" y="15" textAnchor="middle" className="fill-[#8B0000] text-[10px] font-mono">{pin.name}</text>
                </g>
              ))}

            </g>
          ))}

          {/* Connections (Rendered AFTER components to stay on top if needed, or before) */}
          {connections}

        </g>
      </svg>
    </div>
  );
};