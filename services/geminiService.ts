
import { GoogleGenAI, Type } from "@google/genai";
import { ComponentItem, Net, PinDefinition, CompatibilityReport, PhysicalSpecs } from "../types";

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

// 1. Generate BOM (Context Aware)
export const generateBOM = async (mainComponent: string, appDescription: string): Promise<ComponentItem[]> => {
  const ai = getAI();
  const prompt = `
    You are a Senior PCB Design Engineer. 
    Create a precise Bill of Materials (BOM) for:
    Main Component: "${mainComponent}"
    Application Context: "${appDescription}"
    
    Goal: Identify the exact chipset, peripheral ICs, and essential protection circuitry required.
    
    Rules:
    1. Include the main component.
    2. Analyze the 'Application Context' for specific requirements:
       - If "Automotive": Include TVS diodes, Reverse Polarity Protection (PFET/NFET), Load Dump protection.
       - If "USB": Include ESD protection (USBLC6-2 or equivalent).
       - If "Motor Control": Include Gate Drivers, Flyback diodes.
    3. Include required power regulation (LDOs, Buck) matching the main component's voltage.
    4. Include necessary passives (Decoupling 100nF/10uF, Crystal oscillators).
    5. Return 5-10 distinct components.
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
                  footprintType: { type: Type.STRING },
                  manufacturer: { type: Type.STRING }
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

// 2. Analyze Uploaded Datasheet PDF (Deep Extraction)
export const analyzeDatasheetPDF = async (component: ComponentItem, file: File, appContext: string = ""): Promise<{ 
    pins: PinDefinition[], 
    report: string, 
    physicalSpecs: PhysicalSpecs, 
    isolationRules: string[] 
}> => {
  const ai = getAI();
  const filePart = await fileToGenerativePart(file);

  const prompt = `
    You are an expert EDA Engineer analyzing a datasheet.
    Component: "${component.name}"
    Application Context: "${appContext}"

    Task: Extract deep technical specifications for Schematic Symbol creation and PCB Layout.

    1. **Physical Dimensions (High Priority)**:
       - Find "Package Outline" or "Mechanical Data".
       - Extract Body Width/Height (mm).
       - Extract Pin Pitch (mm).
       - Identify Package Type.

    2. **Electrical Characteristics**:
       - Find "Absolute Maximum Ratings" and "Recommended Operating Conditions".
       - Extract Max/Min Voltages for VCC and I/O.
       - Identify Special behaviors (Open-Drain, True Open-Drain, 5V Tolerant).

    3. **Isolation & Layout Rules**:
       - Look for "Layout Guidelines".
       - Are there requirements to separate AGND (Analog) from DGND (Digital)?
       - Are there high-voltage creepage rules?

    4. **Pin Configuration**:
       - Extract ALL pins with Number, Name, Type.
       - Assign "Side" for the schematic symbol:
         - LEFT: Inputs, Reset, Clocks.
         - RIGHT: Outputs, Interrupts, PWM.
         - TOP: Power (VCC, VDD).
         - BOTTOM: Ground (GND, VSS).

    Return JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // Using Pro for complex reasoning and PDF analysis
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
            physicalSpecs: {
              type: Type.OBJECT,
              properties: {
                widthMm: { type: Type.NUMBER },
                heightMm: { type: Type.NUMBER },
                pinPitchMm: { type: Type.NUMBER },
                packageType: { type: Type.STRING }
              }
            },
            isolationRules: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            pins: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pinNumber: { type: Type.STRING },
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['Power', 'Input', 'Output', 'IO', 'Clock', 'Passive'] },
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] },
                  description: { type: Type.STRING },
                  electrical: {
                    type: Type.OBJECT,
                    properties: {
                       minVoltage: { type: Type.STRING },
                       maxVoltage: { type: Type.STRING },
                       maxCurrent: { type: Type.STRING },
                       signalType: { type: Type.STRING },
                       behavior: { type: Type.STRING }
                    }
                  }
                },
                required: ["pinNumber", "name", "type", "side"]
              }
            }
          }
        }
      }
    });

    const json = JSON.parse(response.text || "{}");
    return { 
        pins: json.pins || [], 
        report: json.summary || "Deep analysis complete.",
        physicalSpecs: json.physicalSpecs || { widthMm: 10, heightMm: 10, pinPitchMm: 2.54, packageType: "Unknown" },
        isolationRules: json.isolationRules || []
    };
  } catch (error) {
    console.error("PDF Analysis Error:", error);
    // Fallback stub
    return { 
      pins: [{ pinNumber: "1", name: "VCC", type: "Power", side: "top" }, { pinNumber: "2", name: "GND", type: "Power", side: "bottom" }], 
      report: "Failed to parse PDF deeply. Using fallback data.",
      physicalSpecs: { widthMm: 10, heightMm: 10, pinPitchMm: 2.54, packageType: "Generic" },
      isolationRules: []
    };
  }
};

// 2b. Auto-Search Component Data (Web)
export const searchComponentData = async (componentName: string, appContext: string = ""): Promise<{ 
    pins: PinDefinition[], 
    datasheetUrl?: string, 
    description?: string,
    physicalSpecs?: PhysicalSpecs,
    isolationRules?: string[]
}> => {
  const ai = getAI();
  const prompt = `
    Find technical data for electronic component: "${componentName}".
    Application Context: "${appContext}".
    
    1. Find Datasheet or Product Page.
    2. Extract Pinout Table.
    3. Extract Package Dimensions (Width x Height, Pitch).
    4. Extract Electrical Ratings (Max Voltage, Logic Levels).
    5. Look for isolation/grounding recommendations (e.g., "Single Point Grounding").
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const datasheetUrl = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.[0]?.web?.uri || "";

    const extractionPrompt = `
      Based on this search result:
      ${response.text}

      Extract structured JSON for schematic symbol generation.
      Crucial: Physical Dimensions (mm) and Isolation Rules.
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
            isolationRules: { type: Type.ARRAY, items: { type: Type.STRING } },
            physicalSpecs: {
                type: Type.OBJECT,
                properties: {
                  widthMm: { type: Type.NUMBER },
                  heightMm: { type: Type.NUMBER },
                  pinPitchMm: { type: Type.NUMBER },
                  packageType: { type: Type.STRING }
                }
            },
            pins: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pinNumber: { type: Type.STRING },
                  name: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['Power', 'Input', 'Output', 'IO', 'Clock', 'Passive'] },
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] },
                  electrical: {
                    type: Type.OBJECT,
                    properties: {
                       minVoltage: { type: Type.STRING },
                       maxVoltage: { type: Type.STRING },
                       maxCurrent: { type: Type.STRING },
                       behavior: { type: Type.STRING }
                    }
                  }
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
      datasheetUrl: datasheetUrl,
      physicalSpecs: data.physicalSpecs,
      isolationRules: data.isolationRules
    };

  } catch (error) {
    console.error("Search Error:", error);
    return { pins: [], datasheetUrl: "" };
  }
};

// 3. Compatibility Check (Context Aware)
export const checkSystemCompatibility = async (components: ComponentItem[], appDescription: string): Promise<CompatibilityReport> => {
  const ai = getAI();
  
  const systemContext = components.map(c => 
    `Component: ${c.name} (${c.physicalSpecs?.packageType})
     Desc: ${c.description}
     Isolation Rules: ${c.isolationRules?.join(', ')}
     Pins: ${c.pins?.map(p => 
        `[${p.pinNumber}] ${p.name} 
         (Type: ${p.type}, MaxV: ${p.electrical?.maxVoltage || '?'}, Behavior: ${p.electrical?.behavior || '?'})`
     ).join(', ')}`
  ).join('\n---\n');

  const prompt = `
    You are a Lead Electronics Engineer performing a Design Rule Check (DRC).
    Application Context: "${appDescription}"
    
    Review the System Design below.
    
    Check for:
    1. **Voltage Domain Mismatch**: (e.g. 5V logic driving 3.3V inputs without level shifting).
    2. **Missing Pull-ups**: (e.g. Open-Drain I2C lines).
    3. **Isolation Violations**: (e.g. Mixing High Voltage and Low Voltage grounds).
    4. **Missing Protection**: (e.g. USB lines missing ESD protection).

    System Components:
    ${systemContext}
    
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

// 4. Generate Netlist
export const generateNetlist = async (components: ComponentItem[], mainComponentId: string): Promise<Net[]> => {
  const ai = getAI();
  
  const compData = components.map(c => ({
    id: c.id,
    name: c.name,
    pins: c.pins?.map(p => ({ 
        number: p.pinNumber, 
        name: p.name,
        specs: p.electrical 
    }))
  }));

  const prompt = `
    Create a professional schematic netlist.
    Main Controller ID: ${mainComponentId}
    
    Components & Detailed Pin Specs:
    ${JSON.stringify(compData, null, 2)}
    
    Rules:
    - Connect Power Rails based on voltage levels found in pin specs.
    - Connect Data lines matching protocols (UART to UART, SPI to SPI).
    - Respect behavior (e.g. connect Pull-ups to Open-Drain pins).
    - Return JSON nets.
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
export const analyzePins = async (componentName: string, appContext: string = ""): Promise<PinDefinition[]> => {
  const ai = getAI();
  const prompt = `
    Generate a schematic symbol pinout for: "${componentName}".
    Context: ${appContext}
    
    Infer the electrical properties (Voltage, Type) based on common knowledge of this part.
    Assign logical sides:
    - Left: Inputs
    - Right: Outputs
    - Top/Bottom: Power/GND
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
                  side: { type: Type.STRING, enum: ['left', 'right', 'top', 'bottom'] },
                  electrical: {
                    type: Type.OBJECT,
                    properties: {
                       maxVoltage: { type: Type.STRING },
                       behavior: { type: Type.STRING }
                    }
                  }
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
      { pinNumber: "1", name: "VCC", type: "Power", side: "top" },
      { pinNumber: "2", name: "GND", type: "Power", side: "bottom" },
      { pinNumber: "3", name: "SIG", type: "IO", side: "right" }
    ];
  }
};
