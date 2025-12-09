
import { SchematicData, ComponentItem, PinDefinition, Net } from '../types';

// Generate a unique UUID for KiCad objects
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Generates a KiCad 6.0+ Schematic File (.kicad_sch)
 * Compatible with KiCad 6, 7, 8 and importable by Altium Designer.
 */
export const generateKiCadSchematic = (data: SchematicData, layoutPositions: Record<string, {x: number, y: number, w: number, h: number}>): string => {
  // Header
  let content = `(kicad_sch (version 20211014) (generator "AutoSchematicAI")\n`;
  content += `  (paper "A2")\n`;
  content += `  (lib_symbols\n`;

  // --- 1. Define Symbols Dynamically ---
  data.components.forEach(comp => {
    // Sanitize name
    const safeName = comp.name.replace(/[^a-zA-Z0-9_]/g, "_");
    
    // Determine Dimensions based on layout or pin count
    // KiCad units: 1.27mm = 50mil. We map our 20px grid to 50mil (1.27mm) or 100mil (2.54mm).
    // Let's assume 100mil (2.54mm) grid for standard schematic.
    
    const pos = layoutPositions[comp.id];
    const width = pos ? pos.w / 10 : 20; // Scale down pixels to KiCad units roughly
    const height = pos ? pos.h / 10 : 20;
    
    const halfW = width / 2 * 2.54; // Convert to mm
    const halfH = height / 2 * 2.54;

    content += `    (symbol "${safeName}" (in_bom yes) (on_board yes)\n`;
    content += `      (property "Reference" "U" (id 0) (at 0 -${(halfH + 2.54).toFixed(2)} 0) (effects (font (size 1.27 1.27))))\n`;
    content += `      (property "Value" "${comp.name}" (id 1) (at 0 ${(halfH + 2.54).toFixed(2)} 0) (effects (font (size 1.27 1.27))))\n`;
    content += `      (property "Footprint" "" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))\n`;
    
    // Draw Body Rectangle
    content += `      (symbol "${safeName}_0_1"\n`;
    content += `        (rectangle (start -${halfW.toFixed(2)} -${halfH.toFixed(2)}) (end ${halfW.toFixed(2)} ${halfH.toFixed(2)}) (stroke (width 0.254) (type default) (fill (type background))))\n`;
    content += `      )\n`;

    // Draw Pins
    (comp.pins || []).forEach((pin, idx) => {
        // We need to match the logic from SchematicView to place pins correctly in the symbol definition
        // This is tricky because SchematicView calculates positions dynamically.
        // We will approximate: 
        // Left pins: x = -halfW
        // Right pins: x = +halfW
        // Top/Bottom distributed
        
        const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
        const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
        const topPins = comp.pins?.filter(p => p.side === 'top') || [];
        const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];

        let x = 0, y = 0, angle = 0;
        
        const pinSpacing = 2.54; // 100 mil
        
        if (leftPins.includes(pin)) {
            const i = leftPins.indexOf(pin);
            x = -halfW - 2.54; 
            y = -halfH + pinSpacing + (i * pinSpacing * 2); // Spread out
            angle = 0;
        } else if (rightPins.includes(pin)) {
            const i = rightPins.indexOf(pin);
            x = halfW + 2.54;
            y = -halfH + pinSpacing + (i * pinSpacing * 2);
            angle = 180;
        } else if (topPins.includes(pin)) {
            const i = topPins.indexOf(pin);
            const step = (halfW * 2) / (topPins.length + 1);
            x = -halfW + (step * (i + 1));
            y = -halfH - 2.54;
            angle = 270;
        } else if (bottomPins.includes(pin)) {
            const i = bottomPins.indexOf(pin);
            const step = (halfW * 2) / (bottomPins.length + 1);
            x = -halfW + (step * (i + 1));
            y = halfH + 2.54;
            angle = 90;
        }

        content += `      (symbol "${safeName}_1_1"\n`;
        content += `        (pin input line (at ${x.toFixed(2)} ${y.toFixed(2)} ${angle}) (length 2.54)\n`;
        content += `          (name "${pin.name}" (effects (font (size 1.27 1.27))))\n`;
        content += `          (number "${pin.pinNumber}" (effects (font (size 1.27 1.27))))\n`;
        content += `        )\n`;
        content += `      )\n`;
    });

    content += `    )\n`;
  });
  content += `  )\n`; // End lib_symbols

  // --- 2. Place Component Instances ---
  data.components.forEach((comp, idx) => {
      const pos = layoutPositions[comp.id];
      if (!pos) return;
      const safeName = comp.name.replace(/[^a-zA-Z0-9_]/g, "_");
      
      // Map pixels to mm (approx)
      // 20px = 2.54mm grid
      const ratio = 2.54 / 20;
      const atX = (pos.x + pos.w / 2) * ratio;
      const atY = (pos.y + pos.h / 2) * ratio;

      content += `  (symbol (lib_id "${safeName}") (at ${atX.toFixed(2)} ${atY.toFixed(2)} 0) (unit 1)\n`;
      content += `    (in_bom yes) (on_board yes) (uuid "${generateUUID()}")\n`;
      content += `    (property "Reference" "U${idx+1}" (id 0) (at ${atX.toFixed(2)} ${(atY - 5).toFixed(2)} 0))\n`;
      content += `    (property "Value" "${comp.name}" (id 1) (at ${atX.toFixed(2)} ${(atY + 5).toFixed(2)} 0))\n`;
      content += `  )\n`;
  });

  // --- 3. Connectivity (Net Labels) ---
  // To ensure robust connectivity without calculating complex wire geometry for export,
  // we place Global Labels on every connected pin. This is standard auto-generated schematic practice.
  
  data.nets.forEach(net => {
      const netName = net.name.toUpperCase().replace(/\s+/g, "_");
      
      net.connections.forEach(conn => {
          const comp = data.components.find(c => c.id === conn.componentId);
          if (!comp) return;
          const pos = layoutPositions[comp.id];
          if (!pos) return;
          
          // Re-calculate absolute pin position to place label
          // Must match Symbol Def + Instance Position logic
          const ratio = 2.54 / 20; // px to mm
          
          const width = pos.w * ratio;
          const height = pos.h * ratio;
          const halfW = width / 2;
          const halfH = height / 2;
          const centerX = (pos.x + pos.w / 2) * ratio;
          const centerY = (pos.y + pos.h / 2) * ratio;
          
          let pinX = 0, pinY = 0;
          
          const leftPins = comp.pins?.filter(p => p.side === 'left' || !p.side) || [];
          const rightPins = comp.pins?.filter(p => p.side === 'right') || [];
          const topPins = comp.pins?.filter(p => p.side === 'top') || [];
          const bottomPins = comp.pins?.filter(p => p.side === 'bottom') || [];
          
          const pinSpacing = 2.54;

          const findPinIdx = (arr: PinDefinition[]) => arr.findIndex(p => String(p.pinNumber) === String(conn.pin) || p.name === String(conn.pin));

          let idx = -1;
          if ((idx = findPinIdx(leftPins)) !== -1) {
             pinX = centerX - halfW - 2.54; 
             pinY = centerY - halfH + pinSpacing + (idx * pinSpacing * 2);
          } else if ((idx = findPinIdx(rightPins)) !== -1) {
             pinX = centerX + halfW + 2.54;
             pinY = centerY - halfH + pinSpacing + (idx * pinSpacing * 2);
          } else if ((idx = findPinIdx(topPins)) !== -1) {
             const step = (halfW * 2) / (topPins.length + 1);
             pinX = centerX - halfW + (step * (idx + 1));
             pinY = centerY - halfH - 2.54;
          } else if ((idx = findPinIdx(bottomPins)) !== -1) {
             const step = (halfW * 2) / (bottomPins.length + 1);
             pinX = centerX - halfW + (step * (idx + 1));
             pinY = centerY + halfH + 2.54;
          }

          // Place Label
          content += `  (label "${netName}" (at ${pinX.toFixed(2)} ${pinY.toFixed(2)} 0) (fields_autoplaced)\n`;
          content += `    (effects (font (size 1.27 1.27)) (justify left bottom))\n`;
          content += `    (uuid "${generateUUID()}")\n`;
          content += `  )\n`;
          
          // Add a short wire stub to make it look connected
          // content += `  (wire (pts (xy ${pinX.toFixed(2)} ${pinY.toFixed(2)}) (xy ${(pinX+1).toFixed(2)} ${pinY.toFixed(2)})) (stroke (width 0) (type solid)) (uuid "${generateUUID()}"))\n`;
      });
  });

  content += `)\n`;
  return content;
};
