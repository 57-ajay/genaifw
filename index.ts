import { GoogleGenAI, Type } from "@google/genai";
import { systemPrompt } from "./prompts/systemPrompt";

const ai = new GoogleGenAI({
    vertexai: true,
    project: "cabswale-ai",
    location: "us-central1",
});


const run = async () => {

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            {
                role: "model",
                parts: [{ text: systemPrompt() }]
            },
            {
                role: "user",
                parts: [{ text: "i want to verify my aadhar" }]
            }
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    intent: {
                        type: Type.STRING,
                        enum: ["verifyAadharIntent", "generalIntent"],
                        description: "Classified user intent"
                    }
                },
                required: ["intent"]
            }
        }
    });

    return JSON.parse(response.text!) as { intent: string }

}

run().then(x => console.log(x.intent))
