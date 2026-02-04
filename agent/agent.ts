import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { createClassifier } from "./classifier";
import { getIntentConfig } from "../intents/registry";
import {
    getOrCreateUser,
    updateIntent,
    pushMessage,
} from "../state/memoryStore";
import type { IntentConfig } from "../types";

export const createAgent = (ai: GoogleGenAI) => {
    const classifier = createClassifier(ai);

    /**
     * Run one turn of the conversation:
     *  1. classify intent
     *  2. load intent config (prompt + tools)
     *  3. call Gemini with full chat history
     *  4. loop on any tool calls until we get a text response
     */
    const run = async (userId: string, userMessage: string): Promise<string> => {
        const state = getOrCreateUser(userId);

        // ── 1. classify ──
        const detectedIntent = await classifier.classify(userMessage);

        // if intent changed, swap config & inform
        let intentSwitched = false;
        if (state.currentIntent !== detectedIntent) {
            updateIntent(userId, detectedIntent);
            intentSwitched = true;
        }

        const intentConfig = getIntentConfig(detectedIntent);
        if (!intentConfig) {
            return `[system] Unknown intent: ${detectedIntent}`;
        }

        // ── 2. push user message into history ──
        pushMessage(userId, { role: "user", text: userMessage });

        // ── 3. build Gemini contents from chat history ──
        const contents = buildContents(state.chatHistory.map(m => ({
            role: m.role,
            text: m.text,
        })));

        // ── 4. call Gemini in a tool‑call loop ──
        const finalText = await geminiLoop(ai, intentConfig, contents);

        // ── 5. save assistant reply ──
        pushMessage(userId, { role: "model", text: finalText });

        // prepend a small notice when intent switches mid‑conversation
        if (intentSwitched) {
            const label = `[intent → ${detectedIntent}]`;
            return `${label}\n${finalText}`;
        }

        return finalText;
    };

    return { run };
};


// ─── helpers ────────────────────────────────────────────────────────

function buildContents(history: { role: string; text: string }[]): Content[] {
    return history.map(m => ({
        role: m.role as "user" | "model",
        parts: [{ text: m.text }],
    }));
}


async function geminiLoop(
    ai: GoogleGenAI,
    config: IntentConfig,
    contents: Content[],
): Promise<string> {

    const toolDeclarations = config.tools.length
        ? [{ functionDeclarations: config.tools }]
        : undefined;

    // max iterations to avoid infinite loops
    const MAX_TOOL_ROUNDS = 5;

    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
                systemInstruction: config.systemPrompt,
                tools: toolDeclarations,
            },
        });

        const candidate = response.candidates?.[0];
        if (!candidate?.content?.parts) {
            return "[agent] No response from model.";
        }

        const parts = candidate.content.parts;

        // check for function calls
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) {
            // no tool calls → extract text and return
            const text = parts
                .filter(p => p.text)
                .map(p => p.text)
                .join("");
            return text || "[agent] Empty response.";
        }

        // ── handle each tool call ──
        // append the model's response (with function calls) to contents
        contents.push({
            role: "model",
            parts: parts as Part[],
        });

        // execute tools and build function‑response parts
        const toolResponseParts: Part[] = [];
        for (const part of functionCalls) {
            const fc = part.functionCall!;
            const toolName = fc.name ?? "unknown";
            const handler = config.toolHandlers[toolName];

            let result: any;
            if (handler) {
                try {
                    result = await handler(fc.args as Record<string, any>);
                } catch (err: any) {
                    result = { error: err.message };
                }
            } else {
                result = { error: `No handler registered for tool "${toolName}"` };
            }

            toolResponseParts.push({
                functionResponse: {
                    name: toolName,
                    response: result,
                },
            });
        }

        // append tool results so the model can continue
        contents.push({
            role: "user",
            parts: toolResponseParts,
        });
    }

    return "[agent] Tool‑call limit reached.";
}
