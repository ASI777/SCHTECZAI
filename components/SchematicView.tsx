import React, { useMemo, useState, useEffect, useRef } from 'react';
import { SchematicData, ComponentItem, PinDefinition } from '../types';
import { ZoomIn, ZoomOut, Move, Grid } from 'lucide-react';

interface SchematicViewProps {
  data: SchematicData;
  onLayoutChange?: (positions: Record<string, {x: number, y: number, w: number, h: number}>) => void;
}

const GRID_SIZE = 20;
const HEADER_HEIGHT = 40;
const PIN_SPACING = 20;

// --- A* Pathfinding Logic ---

interface Point { x: number; y: number; }

const toGrid = (val: number) => Math.round(val / GRID_SIZE);
const toPx = (val: number) => val * GRID_SIZE;

// Simple Priority Queue for A*
class PriorityQueue<T> {
  elements: { item: T, priority: number }[] = [];
  enqueue(item: T, priority: number) {
    this.elements.push({ item, priority });
    this.elements.sort((a, b) => a.priority - b.priority);
  }
  dequeue(): T | undefined {
    return this.elements.shift()?.item;
  }
  isEmpty() { return this.elements.length === 0; }
}

const getManhattanDistance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const findPathAStar = (
  start: Point, 
  end: Point, 
  obstacles: Set<string>, 
  gridBounds: { minX: number, maxX: number, minY: number, maxY: number }
): Point[] => {
  
  const startKey = `${start.x},${start.y}`;
  const endKey = `${end.x},${end.y}`;

  // If start or end is inside an obstacle (e.g., pin is on edge), we must allow it.
  // We assume the caller handles "pin access" points.
  
  const queue = new PriorityQueue<{ pos: Point, path: Point[] }>();
  queue.enqueue({ pos: start, path: [start] }, 0);
  
  const visited = new Set<string>();
  const costs = new Map<string, number>();
  
  costs.set(startKey, 0);

  let iterations = 0;
  const MAX_ITER = 2000; // Performance Safety

  const dirs = [
    { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }
  ];

  while (!queue.isEmpty() && iterations < MAX_ITER) {
    iterations++;
    const current = queue.dequeue();
    if (!current) break;

    const { pos, path } = current;
    const key = `${pos.x},${pos.y}`;
    
    // Found End?
    if (pos.x === end.x && pos.y === end.y) {
      // Optimize: Remove redundant collinear points
      const optimized: Point[] = [path[0]];
      for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i-1];
        const curr = path[i];
        const next = path[i+1];
        // If changing direction, keep point
        if (!((prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y))) {
          optimized.push(curr);
        }
      }
      optimized.push(path[path.length - 1]);
      return optimized;
    }

    if (visited.has(key)) continue;
    visited.add(key);

    const costSoFar = costs.get(key) || 0;

    for (const d of dirs) {
      const next = { x: pos.x + d.x, y: pos.y + d.y };
      const nextKey = `${next.x},${next.y}`;

      // Check bounds
      if (next.x < gridBounds.minX || next.x > gridBounds.maxX || next.y < gridBounds.minY || next.y > gridBounds.maxY) continue;
      
      // Check obstacles (Allow end node)
      const isEnd = next.x === end.x && next.y === end.y;
      if (obstacles.has(nextKey) && !isEnd) continue;

      // Cost Calculation
      // Base movement cost = 1
      // Turn penalty: If direction changed from previous, add cost
      let newCost = costSoFar + 1;
      
      if (path.length > 1) {
        const prev = path[path.length - 2];
        const prevDirX = pos.x - prev.x;
        const prevDirY = pos.y - prev.y;
        if (prevDirX !== d.x || prevDirY !== d.y) {
          newCost += 2; // Penalty for turning to encourage straight lines
        }
      }

      if (!costs.has(nextKey) || newCost < costs.get(nextKey)!) {
        costs.set(nextKey, newCost);
        const priority = newCost + getManhattanDistance(next, end);
        queue.enqueue({ pos: next, path: [...path, next] }, priority);
      }
    }
  }

  // Fallback: L-shape
  return [
    start, 
    { x: (start.x + end.x)/2, y: start.y }, 
    { x: (start.x + end.x)/2, y: end.y }, 
    end
  ];
};

export const SchematicView: React.FC<SchematicViewProps> = ({ data, onLayoutChange }) => {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  
  // Grid layout state
  const [positions, setPositions] = useState<Record<string, { x: number, y: number, w: number, h: number }>>({});
  
  const [dragState, setDragState] = useState<{ id: string | 'pan', startX: number, startY: number, initialX: number, initialY: number } | null>(null);
  const [hoveredComp, setHoveredComp] = useState<string | null>(null);

  // Initialize Component Positions
  useEffect(() => {
    if (Object.keys(positions).length > 0) return; // Already initialized

    const newPos: Record<string, any> = {};
    let col = 0;
    let row = 0;
    const startX = 100;
    const startY = 100;
    const colWidth = 300;
    const rowHeight = 300;

    data.components.forEach((comp) => {
       const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
       const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
       const topPins = comp.pins?.filter(p => p.side === 'top') || [];
       const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

       const maxV = Math.max(leftPins.length, rightPins.length);
       // Calculate required height based on pins, snapped to grid
       const contentHeight = HEADER_HEIGHT + (maxV * PIN_SPACING * 2); 
       const h = Math.ceil((Math.max(contentHeight, 100) + 40) / GRID_SIZE) * GRID_SIZE;
       
       const w = Math.ceil(200 / GRID_SIZE) * GRID_SIZE;

       newPos[comp.id] = { 
           x: startX + (col * colWidth), 
           y: startY + (row * rowHeight), 
           w, 
           h 
       };

       col++;
       if (col > 3) { col = 0; row++; }
    });

    setPositions(newPos);
  }, [data.components]);

  // Sync with parent for export
  useEffect(() => {
    if (onLayoutChange) onLayoutChange(positions);
  }, [positions, onLayoutChange]);


  // --- Routing Calculation ---
  const routes = useMemo(() => {
    // 1. Build Blocked Grid (Obstacles)
    const blocked = new Set<string>();
    const padding = 1; 
    
    Object.values(positions).forEach((p: { x: number, y: number, w: number, h: number }) => {
        const gx = toGrid(p.x);
        const gy = toGrid(p.y);
        const gw = toGrid(p.w);
        const gh = toGrid(p.h);

        for(let x = gx - padding; x <= gx + gw + padding; x++) {
            for(let y = gy - padding; y <= gy + gh + padding; y++) {
                blocked.add(`${x},${y}`);
            }
        }
    });

    const calculatedRoutes: { path: Point[], color: string, id: string }[] = [];

    // 2. Route Nets
    data.nets.forEach(net => {
        // Collect pin locations
        const pinPoints: Point[] = [];
        
        net.connections.forEach(conn => {
            const comp = data.components.find(c => c.id === conn.componentId);
            const pos = positions[conn.componentId];
            if(!comp || !pos) return;

            // Pin Logic (Must match Render Logic)
            const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
            const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
            const topPins = comp.pins?.filter(p => p.side === 'top') || [];
            const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

            const findIdx = (arr: PinDefinition[]) => arr.findIndex(p => String(p.pinNumber) === String(conn.pin) || p.name === String(conn.pin));

            let px = 0, py = 0;
            let idx = -1;

            if ((idx = findIdx(leftPins)) !== -1) {
                px = pos.x; 
                py = pos.y + HEADER_HEIGHT + PIN_SPACING + (idx * PIN_SPACING * 2);
            } else if ((idx = findIdx(rightPins)) !== -1) {
                px = pos.x + pos.w;
                py = pos.y + HEADER_HEIGHT + PIN_SPACING + (idx * PIN_SPACING * 2);
            } else if ((idx = findIdx(topPins)) !== -1) {
                // Top pins logic
                const step = pos.w / (topPins.length + 1);
                px = pos.x + (step * (idx + 1));
                py = pos.y;
            } else if ((idx = findIdx(bottomPins)) !== -1) {
                // Bottom pins
                const step = pos.w / (bottomPins.length + 1);
                px = pos.x + (step * (idx + 1));
                py = pos.y + pos.h;
            }

            pinPoints.push({ x: toGrid(px), y: toGrid(py) });
        });

        if (pinPoints.length < 2) return;

        // Simple Chain Routing
        for (let i = 0; i < pinPoints.length - 1; i++) {
            const start = pinPoints[i];
            const end = pinPoints[i+1];
            
            // Define Bounds for search (Optimization)
            const margin = 10;
            const bounds = {
                minX: Math.min(start.x, end.x) - margin,
                maxX: Math.max(start.x, end.x) + margin,
                minY: Math.min(start.y, end.y) - margin,
                maxY: Math.max(start.y, end.y) + margin
            };

            const path = findPathAStar(start, end, blocked, bounds);
            const color = net.type === 'power' ? '#ef4444' : net.type === 'ground' ? '#10b981' : '#06b6d4';
            
            calculatedRoutes.push({ 
                path: path.map(p => ({ x: toPx(p.x), y: toPx(p.y) })), 
                color,
                id: `${net.id}-${i}`
            });
        }
    });

    return calculatedRoutes;
  }, [data.nets, positions, data.components]);


  // --- Event Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
      setDragState({ id: 'pan', startX: e.clientX, startY: e.clientY, initialX: pan.x, initialY: pan.y });
  };

  const handleCompDown = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setDragState({
          id,
          startX: e.clientX,
          startY: e.clientY,
          initialX: positions[id].x,
          initialY: positions[id].y
      });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if(!dragState) return;

      const dx = (e.clientX - dragState.startX) / scale;
      const dy = (e.clientY - dragState.startY) / scale;

      if(dragState.id === 'pan') {
          setPan({ x: dragState.initialX + (e.clientX - dragState.startX), y: dragState.initialY + (e.clientY - dragState.startY) });
      } else {
          // Dragging Component
          const rawX = dragState.initialX + dx;
          const rawY = dragState.initialY + dy;
          
          // Snap
          const x = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
          const y = Math.round(rawY / GRID_SIZE) * GRID_SIZE;

          setPositions(prev => ({
              ...prev,
              [dragState.id]: { ...prev[dragState.id], x, y }
          }));
      }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#f8fafc] select-none font-sans">
       {/* Toolbar */}
       <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 bg-white shadow-md border border-slate-200 p-2 rounded-lg">
        <button onClick={() => setScale(s => Math.min(s + 0.1, 3))} className="p-2 hover:bg-slate-50 rounded text-slate-600"><ZoomIn size={18}/></button>
        <button onClick={() => setScale(s => Math.max(s - 0.1, 0.5))} className="p-2 hover:bg-slate-50 rounded text-slate-600"><ZoomOut size={18}/></button>
        <button onClick={() => setPan({x: 0, y: 0})} className="p-2 hover:bg-slate-50 rounded text-slate-600"><Move size={18}/></button>
      </div>

      <div className="absolute top-4 left-4 z-20 bg-white/90 shadow px-4 py-2 rounded border-l-4 border-yellow-500 text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
         <Grid size={14}/> Schematic CAD View
      </div>

      {/* Canvas */}
      <svg 
        className="w-full h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragState(null)}
        onMouseLeave={() => setDragState(null)}
      >
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
             {/* Grid Points */}
             <defs>
                 <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                     <circle cx="1" cy="1" r="1" fill="#cbd5e1" />
                 </pattern>
             </defs>
             <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#grid)" />

             {/* Routes (Wires) */}
             {routes.map(r => {
                 let d = `M ${r.path[0].x} ${r.path[0].y}`;
                 for(let i=1; i<r.path.length; i++) d += ` L ${r.path[i].x} ${r.path[i].y}`;
                 return (
                    <g key={r.id}>
                        {/* Outer Glow for selection/visibility */}
                        <path d={d} stroke="white" strokeWidth="4" fill="none" opacity="0.5"/> 
                        {/* Main Wire */}
                        <path d={d} stroke={r.color} strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
                        {/* Junctions */}
                        <circle cx={r.path[0].x} cy={r.path[0].y} r="2" fill={r.color}/>
                        <circle cx={r.path[r.path.length-1].x} cy={r.path[r.path.length-1].y} r="2" fill={r.color}/>
                    </g>
                 )
             })}

             {/* Components */}
             {data.components.map(comp => {
                 const pos = positions[comp.id];
                 if (!pos) return null;
                 
                 const isHovered = hoveredComp === comp.id;

                 return (
                     <g 
                       key={comp.id} 
                       transform={`translate(${pos.x},${pos.y})`}
                       onMouseDown={(e) => handleCompDown(e, comp.id)}
                       onMouseEnter={() => setHoveredComp(comp.id)}
                       onMouseLeave={() => setHoveredComp(null)}
                       className="cursor-move"
                     >
                        {/* Shadow */}
                        <rect x="4" y="4" width={pos.w} height={pos.h} fill="black" fillOpacity="0.1" rx="2" />
                        
                        {/* Body - PDF Style (Yellowish) */}
                        <rect 
                           width={pos.w} 
                           height={pos.h} 
                           fill="#FEF9C3" 
                           stroke={isHovered ? "#0891b2" : "#854d0e"} 
                           strokeWidth="2"
                           rx="1"
                        />

                        {/* Component Label */}
                        <text x="10" y="25" className="font-bold text-sm fill-[#854d0e] font-mono pointer-events-none">
                            {comp.name}
                        </text>
                        <line x1="0" y1={HEADER_HEIGHT} x2={pos.w} y2={HEADER_HEIGHT} stroke="#854d0e" strokeWidth="1"/>

                        {/* Pins */}
                        {(comp.pins || []).map((pin, i) => {
                             const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
                             const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
                             const topPins = comp.pins?.filter(p => p.side === 'top') || [];
                             const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

                             const findIdx = (arr: any[]) => arr.indexOf(pin);

                             let x=0, y=0, align='start', anchor='start';
                             let lx1=0, ly1=0, lx2=0, ly2=0;

                             if (leftPins.includes(pin)) {
                                 y = HEADER_HEIGHT + PIN_SPACING + (findIdx(leftPins) * PIN_SPACING * 2);
                                 x = 5; anchor='start';
                                 lx1 = 0; ly1 = y; lx2 = -5; ly2 = y;
                             } else if (rightPins.includes(pin)) {
                                 y = HEADER_HEIGHT + PIN_SPACING + (findIdx(rightPins) * PIN_SPACING * 2);
                                 x = pos.w - 5; anchor='end';
                                 lx1 = pos.w; ly1 = y; lx2 = pos.w + 5; ly2 = y;
                             } else if (topPins.includes(pin)) {
                                 // Logic for top
                                 const step = pos.w / (topPins.length + 1);
                                 x = step * (findIdx(topPins) + 1);
                                 y = 12; anchor='middle';
                                 lx1 = x; ly1 = 0; lx2 = x; ly2 = -5;
                             } else if (bottomPins.includes(pin)) {
                                 const step = pos.w / (bottomPins.length + 1);
                                 x = step * (findIdx(bottomPins) + 1);
                                 y = pos.h - 5; anchor='middle';
                                 lx1 = x; ly1 = pos.h; lx2 = x; ly2 = pos.h + 5;
                             }

                             return (
                                 <g key={i}>
                                     {/* Pin Stub */}
                                     <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#b91c1c" strokeWidth="2" />
                                     {/* Pin Terminal Circle */}
                                     <circle cx={lx2} cy={ly2} r="2" fill="none" stroke="#b91c1c" strokeWidth="1" />
                                     
                                     {/* Pin Name */}
                                     <text x={x} y={y + 4} textAnchor={anchor} className="text-[10px] fill-slate-800 font-mono pointer-events-none">
                                         {pin.name}
                                     </text>
                                     {/* Pin Number */}
                                     <text x={lx2 + (anchor === 'end' ? 5 : -5)} y={ly2 - 3} textAnchor="middle" className="text-[9px] fill-red-600 font-bold pointer-events-none">
                                         {pin.pinNumber}
                                     </text>
                                 </g>
                             )
                        })}

                     </g>
                 )
             })}
          </g>
      </svg>
    </div>
  );
};