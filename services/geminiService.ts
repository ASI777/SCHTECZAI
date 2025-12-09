
import { GoogleGenAI, Type } from "@google/genai";
import { ComponentItem, Net, PinDefinition, CompatibilityReport } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string, mimeType: string } }> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

// 1. Generate BOM
export const generateBOM = async (mainComponent: string, appDescription: string): Promise<ComponentItem[]> => {
  const ai = getAI();
  const prompt = `
    You are an expert Electronic Design Automation (EDA) architect.
    Design a minimal Bill of Materials (BOM) for the following application:
    Main Component: "${mainComponent}"
    Target Application: "${appDescription}"
    
    Return a list of 4-6 essential electronic components.
    Include specific part numbers.
    Identify the footprint type (e.g., DIP, SOP, 0603, 0805).
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            components: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  footprintType: { type: Type.STRING }
                },
                required: ["name", "description", "footprintType"]
              }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return (json.components || []).map((c: any, idx: number) => ({
      ...c,
      id: `comp_${idx}_${Math.random().toString(36).substr(2, 5)}`,
      status: 'pending'
    }));
  } catch (error) {
    console.error("BOM Generation Error:", error);
    throw new Error("Failed to generate BOM");
  }
};

// 2. Analyze Uploaded Datasheet PDF
export const analyzeDatasheetPDF = async (component: ComponentItem, file: File): Promise<{ pins: PinDefinition[], report: string }> => {
  const ai = getAI();
  const filePart = await fileToGenerativePart(file);

  const prompt = `
    Analyze this electronic component datasheet. 
    1. Extract the comprehensive Pin Configuration / Pinout Table.
    2. Determine the physical package characteristics.
    3. Identify voltage levels and key operating conditions.

    Output a JSON object with 'pins' and a 'summary'.
    For 'pins', assign a 'side' (left, right, top, bottom) based on typical schematic symbol conventions:
    - Top: Positive Power (VCC, VDD, 3V3, 5V, VBAT)
    - Bottom: Ground (GND, VSS)
    - Left: Inputs, Reset, Clock In, Control Signals
    - Right: Outputs, Data Out, Communication Interfaces (TX, MOSI, SDA)
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // Capable of multimodal PDF analysis
      contents: {
        parts: [
          filePart,
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            pins: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pinNumber: { type: Type.STRING },
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['Power', 'Input', 'Output', 'IO', 'Clock', 'Passive'] },
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] },
                  description: { type: Type.STRING }
                },
                required: ["pinNumber", "name", "type", "side"]
              }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return { pins: json.pins || [], report: json.summary || "Analysis complete." };
  } catch (error) {
    console.error("PDF Analysis Error:", error);
    // Fallback stub
    return { 
      pins: [{ pinNumber: "1", name: "VCC", type: "Power", side: "top" }, { pinNumber: "2", name: "GND", type: "Power", side: "bottom" }], 
      report: "Failed to parse PDF deeply. Using fallback data." 
    };
  }
};

// 2b. Auto-Search Component Data (Web)
export const searchComponentData = async (componentName: string): Promise<{ pins: PinDefinition[], datasheetUrl?: string, description?: string }> => {
  const ai = getAI();
  const prompt = `
    Find the datasheet and pinout information for the electronic component: "${componentName}".
    
    1. Search for the component's pin configuration.
    2. Return a list of pins with their number, name, and function.
    3. Assign 'side' for a schematic symbol:
       - Top: Power (VCC, VDD, 5V, 3.3V)
       - Bottom: Ground (GND, VSS)
       - Left: Inputs, Clocks, Resets
       - Right: Outputs, Communication (TX/RX, SDA/SCL, MOSI/MISO)
    4. Find a URL to the datasheet if possible.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    // Extract grounding link for datasheet
    const datasheetUrl = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.[0]?.web?.uri || "";

    // Now parse the text response into JSON using a second call or if the tool supports schema directly (Search tool usually returns text)
    // We will do a second fast pass to format the text response into strict JSON
    
    const extractionPrompt = `
      Extract the pinout data from this text into JSON:
      ${response.text}
    `;

    const jsonResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: extractionPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            pins: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pinNumber: { type: Type.STRING },
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['Power', 'Input', 'Output', 'IO', 'Clock', 'Passive'] },
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] }
                }
              }
            }
          }
        }
      }
    });

    const data = JSON.parse(jsonResponse.text || "{}");
    return {
      pins: data.pins || [],
      description: data.description || "",
      datasheetUrl: datasheetUrl
    };

  } catch (error) {
    console.error("Search Error:", error);
    return { pins: [], datasheetUrl: "" };
  }
};

// 3. Compatibility Check (Revised for Actions)
export const checkSystemCompatibility = async (components: ComponentItem[]): Promise<CompatibilityReport> => {
  const ai = getAI();
  
  // Construct a context string from available analysis reports or names
  const systemContext = components.map(c => 
    `Component: ${c.name}\nDescription: ${c.description}\nKnown Pins: ${c.pins?.map(p => `${p.pinNumber}:${p.name}`).join(', ')}`
  ).join('\n---\n');

  const prompt = `
    You are a Senior Electronics Engineer. Perform a rigorous design rule check (DRC) and compatibility analysis on this system.
    
    System Components:
    ${systemContext}

    Your Task:
    1. Check for Voltage level compatibility (e.g. 3.3V vs 5V logic).
    2. Check for missing essential passives or auxiliary components (pull-ups, bypass caps, crystal oscillators, level shifters).
    3. Check for Protocol mismatches (UART to SPI, etc.).
    
    If you find issues, propose specific actions:
    - ADD: Add a missing component (e.g. "Level Shifter" or "10k Resistor").
    - REMOVE: Remove a component that is wrong or redundant.
    
    Return a strict JSON report.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCompatible: { type: Type.BOOLEAN },
            issues: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            actions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ['ADD', 'REMOVE'] },
                  componentName: { type: Type.STRING },
                  description: { type: Type.STRING },
                  reason: { type: Type.STRING }
                },
                required: ["type", "componentName", "reason"]
              }
            }
          },
          required: ["isCompatible", "issues", "recommendations", "actions"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    return { isCompatible: false, issues: ["AI Check Failed"], recommendations: [], actions: [] };
  }
};

// 4. Generate Netlist (Updated to use actual pins)
export const generateNetlist = async (components: ComponentItem[], mainComponentId: string): Promise<Net[]> => {
  const ai = getAI();
  
  const compData = components.map(c => ({
    id: c.id,
    name: c.name,
    pins: c.pins?.map(p => ({ number: p.pinNumber, name: p.name }))
  }));

  const prompt = `
    Create a professional schematic netlist connecting these components.
    Main Controller ID: ${mainComponentId}
    
    Components & Available Pins:
    ${JSON.stringify(compData, null, 2)}
    
    Rules:
    - Use EXACT pin numbers/names provided.
    - Create nets for Power (VCC, 3V3, 5V), Ground (GND), and Data lines.
    - Assign meaningful net names (e.g., 'I2C_SDA', 'SPI_CLK').
    - Return a JSON object with a list of nets.
    - Type should be 'power', 'ground', or 'signal'.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            nets: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['signal', 'power', 'ground'] },
                  connections: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        componentId: { type: Type.STRING },
                        pin: { type: Type.STRING }
                      },
                      required: ["componentId", "pin"]
                    }
                  }
                },
                required: ["name", "connections"]
              }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return json.nets || [];
  } catch (error) {
    console.error("Netlist Generation Error:", error);
    return [];
  }
};

// Fallback Pin Analysis (for components without PDF)
export const analyzePins = async (componentName: string): Promise<PinDefinition[]> => {
  const ai = getAI();
  const prompt = `
    Generate a schematic symbol pinout for: "${componentName}".
    Assign logical sides for a rectangular schematic symbol:
    - Left: Inputs, Power In
    - Right: Outputs, Power Out
    - Top/Bottom: GND or special control
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pins: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pinNumber: { type: Type.STRING },
                  name: { type: Type.STRING },
                  type: { type: Type.STRING },
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] }
                }
              }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return json.pins || [];
  } catch (error) {
     return [
      { pinNumber: "1", name: "VCC", type: "Power", side: "left" },
      { pinNumber: "2", name: "GND", type: "Power", side: "bottom" },
      { pinNumber: "3", name: "SIG", type: "IO", side: "right" }
    ];
  }
};

// 5. Generate Footprint Image (Legacy/Fallback)
export const generateFootprintImage = async (component: ComponentItem): Promise<string> => {
    // Kept for backward compatibility if needed, though we focus on CAD view now
    return "";
};
