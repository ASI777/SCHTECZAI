import { SchematicData, ComponentItem, PinDefinition, Net } from '../types';

interface Route {
  path: {x: number, y: number}[];
  color: string;
  id: string;
  netName: string;
}

// Eagle uses 0.1 inch grid standard (2.54mm).
// Web uses 20px grid.
// Scale factor: 20px -> 2.54mm
const SCALE = 2.54 / 20;

const cleanName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Generates an Eagle CAD XML Schematic File (.sch)
 * Compatible with Eagle 9.x, Fusion 360, Altium Designer (Import), and KiCad (Import).
 */
export const generateEagleSchematic = (
    data: SchematicData, 
    layoutPositions: Record<string, {x: number, y: number, w: number, h: number}>,
    routes: Route[] = []
): string => {

  const timestamp = new Date().toISOString();
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<!DOCTYPE eagle SYSTEM "eagle.dtd">\n`;
  xml += `<eagle version="9.6.2">\n`;
  xml += `<drawing>\n`;
  xml += `<settings>\n<setting alwaysvectorfont="no"/>\n<setting verticaltext="up"/>\n</settings>\n`;
  xml += `<grid distance="0.1" unitdist="inch" unit="inch" style="lines" multiple="1" display="no" altdistance="0.01" altunitdist="inch" altunit="inch"/>\n`;
  
  // Layers
  xml += `<layers>\n`;
  xml += `<layer number="91" name="Nets" color="2" fill="1" visible="yes" active="yes"/>\n`;
  xml += `<layer number="92" name="Busses" color="1" fill="1" visible="yes" active="yes"/>\n`;
  xml += `<layer number="93" name="Pins" color="2" fill="1" visible="yes" active="yes"/>\n`;
  xml += `<layer number="94" name="Symbols" color="4" fill="1" visible="yes" active="yes"/>\n`;
  xml += `<layer number="95" name="Names" color="7" fill="1" visible="yes" active="yes"/>\n`;
  xml += `<layer number="96" name="Values" color="7" fill="1" visible="yes" active="yes"/>\n`;
  xml += `</layers>\n`;

  // Schematic
  xml += `<schematic xreflabel="%F%N/%S.%C%R" xrefpart="/%S.%C%R">\n`;
  
  // --- LIBRARIES ---
  xml += `<libraries>\n`;
  xml += `<library name="AutoSchematicLib">\n`;
  xml += `<packages>\n</packages>\n`;
  xml += `<symbols>\n`;

  // Generate Symbols for each component
  data.components.forEach(comp => {
      const symName = cleanName(comp.name);
      const pos = layoutPositions[comp.id] || { x:0, y:0, w: 100, h: 100 };
      
      // Dimensions in mm
      const w = pos.w * SCALE;
      const h = pos.h * SCALE;
      const halfW = w / 2;
      const halfH = h / 2;

      xml += `<symbol name="${symName}">\n`;
      
      // Box
      // Eagle Y is up. To match web appearance where Y is down, we draw relative to 0,0 center.
      xml += `<wire x1="-${halfW}" y1="${halfH}" x2="${halfW}" y2="${halfH}" width="0.254" layer="94"/>\n`;
      xml += `<wire x1="${halfW}" y1="${halfH}" x2="${halfW}" y2="-${halfH}" width="0.254" layer="94"/>\n`;
      xml += `<wire x1="${halfW}" y1="-${halfH}" x2="-${halfW}" y2="-${halfH}" width="0.254" layer="94"/>\n`;
      xml += `<wire x1="-${halfW}" y1="-${halfH}" x2="-${halfW}" y2="${halfH}" width="0.254" layer="94"/>\n`;

      // Text
      xml += `<text x="-${halfW}" y="${halfH + 1}" size="1.778" layer="95">&gt;NAME</text>\n`;
      xml += `<text x="-${halfW}" y="-${halfH + 3}" size="1.778" layer="96">&gt;VALUE</text>\n`;

      // Pins
      (comp.pins || []).forEach(pin => {
        const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
        const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
        const topPins = comp.pins?.filter(p => p.side === 'top') || [];
        const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

        let x = 0, y = 0, rot = "R0";
        
        // In Web: Y is from top (0) to bottom (pos.h). 
        // In Eagle: Y is from bottom (-halfH) to top (halfH) ? No, we need to invert.
        // Let's map Web Y (0 to h) to Eagle Y (halfH to -halfH).
        // formula: eagleY = halfH - (webY * SCALE)

        if (leftPins.includes(pin)) {
            const idx = leftPins.indexOf(pin);
            // Web Logic: HEADER_HEIGHT + PIN_SPACING + (idx * PIN_SPACING * 2)
            // Hardcoded from SchematicView: 40 + 20 + idx*40
            const webY = 60 + (idx * 40);
            
            // Left Pin: Connection point at -halfW, line draws LEFT (away from box) -> R180
            x = -halfW;
            y = halfH - (webY * SCALE);
            rot = "R180"; 
        } 
        else if (rightPins.includes(pin)) {
            const idx = rightPins.indexOf(pin);
            const webY = 60 + (idx * 40);
            
            // Right Pin: Connection point at halfW, line draws RIGHT (away from box) -> R0
            x = halfW;
            y = halfH - (webY * SCALE);
            rot = "R0"; 
        }
        else if (topPins.includes(pin)) {
            const idx = topPins.indexOf(pin);
            const step = pos.w / (topPins.length + 1);
            const webX = step * (idx + 1);
            
            // Top Pin: Connection point at top, line draws UP -> R90
            x = -halfW + (webX * SCALE);
            y = halfH;
            rot = "R90"; 
        }
        else if (bottomPins.includes(pin)) {
            const idx = bottomPins.indexOf(pin);
            const step = pos.w / (bottomPins.length + 1);
            const webX = step * (idx + 1);
            
            // Bottom Pin: Connection point at bottom, line draws DOWN -> R270
            x = -halfW + (webX * SCALE);
            y = -halfH;
            rot = "R270"; 
        }

        xml += `<pin name="${pin.name}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" length="middle" rot="${rot}"/>\n`;
      });

      xml += `</symbol>\n`;
  });

  xml += `<devicesets>\n`;
  data.components.forEach(comp => {
      const symName = cleanName(comp.name);
      xml += `<deviceset name="${symName}" prefix="U">\n`;
      xml += `<gates>\n<gate name="G$1" symbol="${symName}" x="0" y="0"/>\n</gates>\n`;
      xml += `</deviceset>\n`;
  });
  xml += `</devicesets>\n`;

  xml += `</library>\n`;
  xml += `</libraries>\n`;

  // --- PARTS & INSTANCES ---
  xml += `<parts>\n`;
  data.components.forEach((comp, i) => {
     const symName = cleanName(comp.name);
     xml += `<part name="U${i+1}" library="AutoSchematicLib" deviceset="${symName}" device=""/>\n`;
  });
  xml += `</parts>\n`;

  // --- SHEET ---
  xml += `<sheets>\n<sheet>\n`;
  xml += `<plain>\n</plain>\n`;
  
  xml += `<instances>\n`;
  data.components.forEach((comp, i) => {
     const pos = layoutPositions[comp.id];
     if(!pos) return;
     
     // Convert Web Pos (Top-Left) to Eagle Pos (Center) and Invert Y
     const webCenterX = pos.x + pos.w/2;
     const webCenterY = pos.y + pos.h/2;
     
     const eagleX = webCenterX * SCALE;
     const eagleY = -(webCenterY * SCALE); // Invert Y

     xml += `<instance part="U${i+1}" gate="G$1" x="${eagleX.toFixed(2)}" y="${eagleY.toFixed(2)}"/>\n`;
  });
  xml += `</instances>\n`;

  xml += `<busses>\n</busses>\n`;

  // --- NETS (WIRES) ---
  xml += `<nets>\n`;
  
  // Group routes by net
  const netGroups: Record<string, Route[]> = {};
  routes.forEach(r => {
      if(!netGroups[r.netName]) netGroups[r.netName] = [];
      netGroups[r.netName].push(r);
  });

  Object.entries(netGroups).forEach(([netName, netRoutes]) => {
      const safeNetName = cleanName(netName);
      xml += `<net name="${safeNetName}" class="0">\n`;
      
      netRoutes.forEach(route => {
          xml += `<segment>\n`;
          for(let i=0; i<route.path.length-1; i++) {
              const p1 = route.path[i];
              const p2 = route.path[i+1];
              
              const x1 = p1.x * SCALE;
              const y1 = -(p1.y * SCALE); // Invert Y
              const x2 = p2.x * SCALE;
              const y2 = -(p2.y * SCALE); // Invert Y
              
              xml += `<wire x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" width="0.1524" layer="91"/>\n`;
          }
          xml += `</segment>\n`;
      });
      xml += `</net>\n`;
  });

  xml += `</nets>\n`;
  xml += `</sheet>\n`;
  xml += `</sheets>\n`;
  
  xml += `</schematic>\n`;
  xml += `</drawing>\n`;
  xml += `</eagle>\n`;

  return xml;
};

// Deprecated KiCad export kept for reference but unused
export const generateKiCadSchematic = () => "";