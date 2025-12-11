import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { SchematicData, ComponentItem, PinDefinition, Net } from '../types';
import { ZoomIn, ZoomOut, Move, Grid, MousePointer2 } from 'lucide-react';

interface Route {
  path: {x: number, y: number}[];
  color: string;
  id: string;
  netName: string;
}

interface SchematicViewProps {
  data: SchematicData;
  onLayoutChange?: (
    positions: Record<string, {x: number, y: number, w: number, h: number}>,
    routes: Route[]
  ) => void;
}

const GRID_SIZE = 20;
const HEADER_HEIGHT = 40;
const PIN_SPACING = 20;

// --- A* Pathfinding Logic ---

interface Point { x: number; y: number; }

const toGrid = (val: number) => Math.round(val / GRID_SIZE);
const toPx = (val: number) => val * GRID_SIZE;

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
  const queue = new PriorityQueue<{ pos: Point, path: Point[], dir: Point | null }>();
  queue.enqueue({ pos: start, path: [start], dir: null }, 0);
  
  const visited = new Map<string, number>(); // Key -> Cost
  visited.set(startKey, 0);

  let iterations = 0;
  const MAX_ITER = 5000; 

  const dirs = [
    { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }
  ];

  let bestPath: Point[] | null = null;
  let minCost = Infinity;

  while (!queue.isEmpty() && iterations < MAX_ITER) {
    iterations++;
    const current = queue.dequeue();
    if (!current) break;

    const { pos, path, dir } = current;

    // Found End?
    if (pos.x === end.x && pos.y === end.y) {
       // Optimize path to remove redundant collinear points
       const optimized: Point[] = [path[0]];
       for (let i = 1; i < path.length - 1; i++) {
         const prev = path[i-1];
         const curr = path[i];
         const next = path[i+1];
         if (!((prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y))) {
           optimized.push(curr);
         }
       }
       optimized.push(path[path.length - 1]);
       return optimized;
    }

    const costSoFar = visited.get(`${pos.x},${pos.y}`) || 0;

    // Explore neighbors
    for (const d of dirs) {
      const next = { x: pos.x + d.x, y: pos.y + d.y };
      const nextKey = `${next.x},${next.y}`;

      // Check bounds
      if (next.x < gridBounds.minX || next.x > gridBounds.maxX || next.y < gridBounds.minY || next.y > gridBounds.maxY) continue;
      
      // Check obstacles (Allow end node)
      const isEnd = next.x === end.x && next.y === end.y;
      if (obstacles.has(nextKey) && !isEnd) continue;

      // Cost Calculation
      // Base movement cost = 10
      // Turn penalty = 50 (Force sharp turns, prefer straight lines)
      let newCost = costSoFar + 10;
      
      if (dir) {
        if (dir.x !== d.x || dir.y !== d.y) {
          newCost += 50; // Heavy penalty for turning
        }
      }

      if (!visited.has(nextKey) || newCost < visited.get(nextKey)!) {
        visited.set(nextKey, newCost);
        const priority = newCost + (getManhattanDistance(next, end) * 10);
        queue.enqueue({ pos: next, path: [...path, next], dir: d }, priority);
      }
    }
  }

  // Fallback: Manhattan L-shape if A* fails
  return [
    start, 
    { x: end.x, y: start.y }, 
    end
  ];
};

export const SchematicView: React.FC<SchematicViewProps> = ({ data, onLayoutChange }) => {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [positions, setPositions] = useState<Record<string, { x: number, y: number, w: number, h: number }>>({});
  const [dragState, setDragState] = useState<{ id: string | 'pan', startX: number, startY: number, initialX: number, initialY: number } | null>(null);
  const [hoveredComp, setHoveredComp] = useState<string | null>(null);

  // Initialize Component Positions
  useEffect(() => {
    if (Object.keys(positions).length > 0) return; 

    const newPos: Record<string, any> = {};
    let col = 0;
    let row = 0;
    const startX = 60;
    const startY = 60;
    const colWidth = 320; // Good spacing
    const rowHeight = 350;

    data.components.forEach((comp) => {
       const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
       const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
       
       const maxV = Math.max(leftPins.length, rightPins.length);
       // Calculate required height based on pins, snapped to grid
       const contentHeight = HEADER_HEIGHT + (maxV * PIN_SPACING * 2); 
       // Minimum height 100, add padding
       const h = Math.ceil((Math.max(contentHeight, 100) + 40) / GRID_SIZE) * GRID_SIZE;
       const w = Math.ceil(220 / GRID_SIZE) * GRID_SIZE;

       newPos[comp.id] = { 
           x: startX + (col * colWidth), 
           y: startY + (row * rowHeight), 
           w, 
           h 
       };

       col++;
       if (col > 2) { col = 0; row++; }
    });

    setPositions(newPos);
  }, [data.components]);

  // --- Routing Calculation ---
  const routes: Route[] = useMemo(() => {
    // 1. Build Blocked Grid (Obstacles)
    const blocked = new Set<string>();
    const padding = 2; // Extra padding for good spacing around components
    
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

    const calculatedRoutes: Route[] = [];

    // 2. Route Nets
    data.nets.forEach(net => {
        // Collect pin locations
        const pinPoints: { p: Point, side: string }[] = [];
        
        net.connections.forEach(conn => {
            const comp = data.components.find(c => c.id === conn.componentId);
            const pos = positions[conn.componentId];
            if(!comp || !pos) return;

            const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
            const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
            const topPins = comp.pins?.filter(p => p.side === 'top') || [];
            const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

            const findIdx = (arr: PinDefinition[]) => arr.findIndex(p => String(p.pinNumber) === String(conn.pin) || p.name === String(conn.pin));

            let px = 0, py = 0, side = 'left';
            let idx = -1;

            if ((idx = findIdx(leftPins)) !== -1) {
                px = pos.x; 
                py = pos.y + HEADER_HEIGHT + PIN_SPACING + (idx * PIN_SPACING * 2);
                side = 'left';
            } else if ((idx = findIdx(rightPins)) !== -1) {
                px = pos.x + pos.w;
                py = pos.y + HEADER_HEIGHT + PIN_SPACING + (idx * PIN_SPACING * 2);
                side = 'right';
            } else if ((idx = findIdx(topPins)) !== -1) {
                const step = pos.w / (topPins.length + 1);
                px = pos.x + (step * (idx + 1));
                py = pos.y;
                side = 'top';
            } else if ((idx = findIdx(bottomPins)) !== -1) {
                const step = pos.w / (bottomPins.length + 1);
                px = pos.x + (step * (idx + 1));
                py = pos.y + pos.h;
                side = 'bottom';
            }

            pinPoints.push({ p: { x: toGrid(px), y: toGrid(py) }, side });
        });

        if (pinPoints.length < 2) return;

        // Chain Routing
        for (let i = 0; i < pinPoints.length - 1; i++) {
            const startNode = pinPoints[i];
            const endNode = pinPoints[i+1];
            
            // "Pull" start and end points out of the blocked zone so the router can find them
            const getAccessPoint = (pt: Point, side: string) => {
              switch(side) {
                case 'left': return { x: pt.x - 1, y: pt.y };
                case 'right': return { x: pt.x + 1, y: pt.y };
                case 'top': return { x: pt.x, y: pt.y - 1 };
                case 'bottom': return { x: pt.x, y: pt.y + 1 };
                default: return pt;
              }
            };

            const startAccess = getAccessPoint(startNode.p, startNode.side);
            const endAccess = getAccessPoint(endNode.p, endNode.side);

            // Bounds
            const margin = 20; // Generous search space
            const bounds = {
                minX: Math.min(startAccess.x, endAccess.x) - margin,
                maxX: Math.max(startAccess.x, endAccess.x) + margin,
                minY: Math.min(startAccess.y, endAccess.y) - margin,
                maxY: Math.max(startAccess.y, endAccess.y) + margin
            };

            const path = findPathAStar(startAccess, endAccess, blocked, bounds);
            
            // Re-attach the exact pin points to the path
            const finalPath = [startNode.p, ...path, endNode.p];

            // Color Coding based on Net Type
            let color = '#059669'; // Default Green (Signal)
            if (net.type === 'power' || net.name.includes('VCC') || net.name.includes('3V3') || net.name.includes('5V')) color = '#dc2626'; // Red
            if (net.type === 'ground' || net.name.includes('GND')) color = '#1e293b'; // Dark/Black

            calculatedRoutes.push({ 
                path: finalPath.map(p => ({ x: toPx(p.x), y: toPx(p.y) })), 
                color,
                id: `${net.id}-${i}`,
                netName: net.name
            });
        }
    });

    return calculatedRoutes;
  }, [data.nets, positions, data.components]);

  // Sync to parent
  useEffect(() => {
     if(onLayoutChange) onLayoutChange(positions, routes);
  }, [positions, routes, onLayoutChange]);

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
          
          // Snap to Grid
          const x = Math.round(rawX / GRID_SIZE) * GRID_SIZE;
          const y = Math.round(rawY / GRID_SIZE) * GRID_SIZE;

          setPositions(prev => ({
              ...prev,
              [dragState.id]: { ...prev[dragState.id], x, y }
          }));
      }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-[#fff] select-none font-sans group">
       {/* Toolbar */}
       <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 bg-white shadow-xl border border-slate-200 p-2 rounded-lg">
        <button onClick={() => setScale(s => Math.min(s + 0.1, 3))} className="p-2 hover:bg-slate-50 rounded text-slate-600 border border-transparent hover:border-slate-200"><ZoomIn size={18}/></button>
        <button onClick={() => setScale(s => Math.max(s - 0.1, 0.5))} className="p-2 hover:bg-slate-50 rounded text-slate-600 border border-transparent hover:border-slate-200"><ZoomOut size={18}/></button>
        <button onClick={() => setPan({x: 0, y: 0})} className="p-2 hover:bg-slate-50 rounded text-slate-600 border border-transparent hover:border-slate-200"><Move size={18}/></button>
      </div>

      <div className="absolute top-4 left-4 z-20 bg-yellow-50/90 backdrop-blur shadow-sm px-4 py-2 rounded border border-yellow-200 text-xs font-bold text-yellow-900 uppercase tracking-widest flex items-center gap-2">
         <Grid size={14}/> Schematic Editor
      </div>
      
      <div className="absolute bottom-4 left-4 z-20 text-[10px] text-slate-400 font-mono">
         GRID: 20px | SNAP: ON | ROUTING: MANHATTAN
      </div>

      {/* Canvas */}
      <svg 
        className="w-full h-full cursor-crosshair bg-white"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setDragState(null)}
        onMouseLeave={() => setDragState(null)}
      >
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
             {/* Infinite Grid Pattern */}
             <defs>
                 <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                     {/* Major Grid Lines */}
                     <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#f1f5f9" strokeWidth="1"/>
                     {/* Dot */}
                     <rect x={GRID_SIZE-1} y={GRID_SIZE-1} width="1" height="1" fill="#cbd5e1" />
                 </pattern>
             </defs>
             <rect x="-10000" y="-10000" width="20000" height="20000" fill="url(#grid)" />

             {/* Routes (Wires) */}
             {routes.map((r, idx) => {
                 let d = `M ${r.path[0].x} ${r.path[0].y}`;
                 for(let i=1; i<r.path.length; i++) d += ` L ${r.path[i].x} ${r.path[i].y}`;
                 return (
                    <g key={r.id}>
                        {/* Shadow/Glow for easier reading */}
                        <path d={d} stroke="white" strokeWidth="4" fill="none" strokeLinejoin="round" /> 
                        {/* Wire */}
                        <path d={d} stroke={r.color} strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
                        {/* Joint Dots */}
                        <circle cx={r.path[0].x} cy={r.path[0].y} r="2.5" fill={r.color}/>
                        <circle cx={r.path[r.path.length-1].x} cy={r.path[r.path.length-1].y} r="2.5" fill={r.color}/>
                    </g>
                 )
             })}

             {/* Components */}
             {data.components.map(comp => {
                 const pos = positions[comp.id];
                 if (!pos) return null;
                 
                 const isHovered = hoveredComp === comp.id;
                 const isDragging = dragState?.id === comp.id;

                 return (
                     <g 
                       key={comp.id} 
                       transform={`translate(${pos.x},${pos.y})`}
                       onMouseDown={(e) => handleCompDown(e, comp.id)}
                       onMouseEnter={() => setHoveredComp(comp.id)}
                       onMouseLeave={() => setHoveredComp(null)}
                       className={`transition-opacity ${isDragging ? 'opacity-80 cursor-grabbing' : 'cursor-grab'}`}
                     >
                        {/* Selection Glow */}
                        {isHovered && <rect x="-4" y="-4" width={pos.w+8} height={pos.h+8} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4" rx="4"/>}

                        {/* Body - PDF Style (Pale Yellow Body, Maroon Outline) */}
                        <rect 
                           width={pos.w} 
                           height={pos.h} 
                           fill="#FEFCE8" /* Light Yellow */
                           stroke="#7f1d1d" /* Maroon/Dark Red */
                           strokeWidth="2"
                           rx="0" 
                        />
                        
                        {/* Header Bar Area */}
                        <path d={`M 0 ${HEADER_HEIGHT} L ${pos.w} ${HEADER_HEIGHT}`} stroke="#7f1d1d" strokeWidth="1"/>
                        <text x="10" y="26" className="font-bold text-sm fill-[#451a03] font-mono pointer-events-none tracking-tight">
                            {comp.name}
                        </text>

                        {/* Pins */}
                        {(comp.pins || []).map((pin, i) => {
                             const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
                             const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
                             const topPins = comp.pins?.filter(p => p.side === 'top') || [];
                             const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

                             const findIdx = (arr: any[]) => arr.indexOf(pin);

                             let x=0, y=0, align='start', anchor='start';
                             let lx1=0, ly1=0, lx2=0, ly2=0;

                             // Pin Visuals: Red Line, Small Red Circle
                             const pinColor = "#dc2626";

                             if (leftPins.includes(pin)) {
                                 y = HEADER_HEIGHT + PIN_SPACING + (findIdx(leftPins) * PIN_SPACING * 2);
                                 x = 6; anchor='start';
                                 lx1 = 0; ly1 = y; lx2 = -10; ly2 = y; // Extend out
                             } else if (rightPins.includes(pin)) {
                                 y = HEADER_HEIGHT + PIN_SPACING + (findIdx(rightPins) * PIN_SPACING * 2);
                                 x = pos.w - 6; anchor='end';
                                 lx1 = pos.w; ly1 = y; lx2 = pos.w + 10; ly2 = y;
                             } else if (topPins.includes(pin)) {
                                 const step = pos.w / (topPins.length + 1);
                                 x = step * (findIdx(topPins) + 1);
                                 y = 12; anchor='middle';
                                 lx1 = x; ly1 = 0; lx2 = x; ly2 = -10;
                             } else if (bottomPins.includes(pin)) {
                                 const step = pos.w / (bottomPins.length + 1);
                                 x = step * (findIdx(bottomPins) + 1);
                                 y = pos.h - 5; anchor='middle';
                                 lx1 = x; ly1 = pos.h; lx2 = x; ly2 = pos.h + 10;
                             }

                             return (
                                 <g key={i}>
                                     {/* Pin Leg */}
                                     <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke={pinColor} strokeWidth="1.5" />
                                     
                                     {/* Connection Point (Hollow Circle) */}
                                     {/* <circle cx={lx2} cy={ly2} r="2" fill="#fff" stroke={pinColor} strokeWidth="1.5" /> */}
                                     
                                     {/* Pin Name (Inside) */}
                                     <text x={x} y={y + 4} textAnchor={anchor} className="text-[10px] fill-slate-900 font-mono font-bold pointer-events-none">
                                         {pin.name}
                                     </text>
                                     
                                     {/* Pin Number (Outside) */}
                                     <text 
                                       x={lx2 + (anchor === 'end' ? 5 : (anchor === 'start' ? -5 : 0))} 
                                       y={ly2 + (anchor === 'middle' ? (bottomPins.includes(pin) ? 10 : -8) : 3)} 
                                       textAnchor={anchor === 'middle' ? 'middle' : (anchor === 'end' ? 'start' : 'end')} 
                                       className="text-[9px] fill-red-700 pointer-events-none"
                                     >
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
