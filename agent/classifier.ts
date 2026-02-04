import { GoogleGenAI, Type } from "@google/genai";
import { getAllIntentDescriptions } from "../intents/registry";

export const createClassifier = (ai: GoogleGenAI) => {

    const classify = async (userMessage: string): Promise<string> => {
        const intents = getAllIntentDescriptions();
        const intentList = intents.map(i => `- ${i.name}: ${i.description}`).join("\n");
        const enumValues = intents.map(i => i.name);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                {
                    role: "user",
                    parts: [{
                        text: `
You are an intent classifier. Given the user's message, return the most appropriate intent.

Available intents:
${intentList}

User message: "${userMessage}"
`.trim()
                    }],
                },
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        intent: {
                            type: Type.STRING,
                            enum: enumValues,
                            description: "The classified intent",
                        },
                    },
                    required: ["intent"],
                },
            },
        });

        const parsed = JSON.parse(response.text!) as { intent: string };
        return parsed.intent;
    };

    return { classify };
};
