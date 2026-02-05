import { ai, MODEL } from "./config";
import type { Part, Session } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations } from "./tools";
import type { FunctionCall } from "@google/genai/web";

const SYSTEM_PROMPT = `You are RAAHI, a helpful assistant for Cabswale.

You operate by using tools to look up information and execute features.

## Your Mandatory Workflow

For EVERY user request (except simple greetings):

STEP 1: Call fetchKnowledgeBase with keywords from the user query.
STEP 2: Read the result carefully.
  - If it contains [FEATURE] entries, you MUST call fetchFeaturePrompt with the exact featureName to get full instructions.
  - If it contains only [INFO] entries, use that info to answer directly.
STEP 3: After calling fetchFeaturePrompt, follow the instructions it returns exactly. Use the tools it mentions.

## Critical Rules
- NEVER skip fetchKnowledgeBase. It is your only source of truth.
- NEVER skip fetchFeaturePrompt when a [FEATURE] is found. You cannot execute features without loading their instructions first.
- When a feature prompt tells you to call a tool, call it. Do not guess results.
- If the user already provided info (like an Aadhaar number), don't ask again — use it.
- Be concise and helpful.`;

// Base tools every session starts with
export const BASE_TOOLS = ["fetchKnowledgeBase", "fetchFeaturePrompt"];


const MAX_DEPTH = 15;

export async function resolve(session: Session): Promise<string> {
    return step(session, 0);
}

async function step(session: Session, depth: number): Promise<string> {
    if (depth >= MAX_DEPTH) {
        return "I've done too many steps. Let's try again — can you rephrase?";
    }

    const stream = await ai.models.generateContentStream({
        model: MODEL,
        contents: session.history as any,
        config: {
            tools: [{ functionDeclarations: getDeclarations(session.activeTools) }],
            systemInstruction: SYSTEM_PROMPT,
        },
    });

    let text = "";
    let fnCall: FunctionCall | null = null;

    for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];

        for (const p of parts) {
            if (p.text) {
                text += p.text;
            }
            if (p.functionCall && !fnCall) {
                fnCall = p.functionCall;
            }
        }
    }

    session.history.push({
        role: "model",
        parts: fnCall
            ? [{ functionCall: fnCall }] as Part[]
            : [{ text }],
    });

    if (fnCall) {
        const fn = getTool(fnCall.name!);
        const args =
            fnCall.args && typeof fnCall.args === "object"
                ? (fnCall.args as Record<string, string>)
                : {};
        const { msg, addTools } = fn
            ? await fn(args)
            : { msg: `Error: tool "${fnCall.name}" not found.` };

        if (addTools) {
            for (const t of addTools) {
                if (!session.activeTools.includes(t)) {
                    session.activeTools.push(t);
                }
            }
        }

        session.history.push({
            role: "function",
            parts: [{ functionResponse: { name: fnCall.name!, response: { content: msg } } }],
        });

        await saveSession(session);
        return step(session, depth + 1);
    }

    await saveSession(session);
    return text || "I'm not sure how to respond to that.";
}
