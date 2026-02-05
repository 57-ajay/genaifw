import { ai, MODEL } from "./config";
import type { Session, Part } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations } from "./tools";

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

//  Resolve one user turn

const MAX_DEPTH = 15;

export async function resolve(session: Session): Promise<string> {
    return step(session, 0);
}

async function step(session: Session, depth: number): Promise<string> {
    if (depth >= MAX_DEPTH) {
        return "I've done too many steps. Let's try again — can you rephrase?";
    }

    const result = await ai.models.generateContent({
        model: MODEL,
        contents: session.history as any,
        config: {
            tools: [{ functionDeclarations: getDeclarations(session.activeTools) }],
            systemInstruction: SYSTEM_PROMPT,
        },
    });

    const parts = result.candidates?.[0]?.content?.parts;
    if (!parts?.length) return "No response from model.";

    // Push entire model turn
    session.history.push({ role: "model", parts: parts as Part[] });

    // Find function call if any
    const fnPart = parts.find((p: any) => p.functionCall);
    const textPart = parts.find((p: any) => p.text);

    // ── Function call -> execute -> recurse
    if (fnPart && "functionCall" in fnPart) {
        const { name, args } = fnPart.functionCall as {
            name: string;
            args: Record<string, string>;
        };

        console.log(`  🔧 ${name}(${JSON.stringify(args)})`);

        const fn = getTool(name);
        let content: string;

        if (fn) {
            const { msg, addTools } = await fn(args);
            content = msg;

            if (addTools?.length) {
                for (const t of addTools) {
                    if (!session.activeTools.includes(t)) {
                        session.activeTools.push(t);
                        console.log(`  ⊕ Tool unlocked: ${t}`);
                    }
                }
            }
        } else {
            content = `Error: tool "${name}" not found.`;
        }

        session.history.push({
            role: "function",
            parts: [{ functionResponse: { name, response: { content } } }],
        });

        await saveSession(session);
        return step(session, depth + 1);
    }

    // ── Text only -> done
    if (textPart && "text" in textPart) {
        await saveSession(session);
        return textPart.text as string;
    }

    await saveSession(session);
    return "I'm not sure how to respond to that.";
}
