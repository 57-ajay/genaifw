import { ai, MODEL } from "./config";
import type { Part, Session, AgentResponse, MatchedAction, UIActionType } from "./types";
import { ALL_UI_ACTIONS } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations } from "./tools";
import type { FunctionCall } from "@google/genai/web";

const SYSTEM_PROMPT = `You are RAAHI, a helpful female assistant for Cabswale.
You ALWAYS respond in HINGLISH (natural mix of Hindi and English). Never pure English or pure Hindi.
Use respectful tone — "Aap" not "Tu".

## Workflow
For EVERY user request (except simple greetings):
1. Call fetchKnowledgeBase with keywords from the user query.
2. If result has [FEATURE] entries, call fetchFeaturePrompt with exact featureName.
3. After loading feature, follow its instructions and use its tools.

## Rules
- NEVER skip fetchKnowledgeBase.
- NEVER skip fetchFeaturePrompt when a [FEATURE] is found.
- When a feature prompt tells you to call a tool, call it.
- If the user already provided info, don't ask again — use it.
- Be concise.`;

const RESPONSE_PROMPT = `You are RAAHI, a helpful female assistant for Cabswale.
Respond in HINGLISH (natural mix of Hindi and English). Respectful tone — use "Aap".
Based on the conversation, produce the final response and action data.
Be concise — 1-2 sentences max.
For multiple destination cities, extract ONLY the first city as to_city.`;

export const BASE_TOOLS = ["fetchKnowledgeBase", "fetchFeaturePrompt"];

const MAX_DEPTH = 15;


export async function resolve(session: Session): Promise<AgentResponse> {
    const text = await phase1(session, 0);

    return phase2(session, text);
}


async function phase1(session: Session, depth: number): Promise<string> {
    if (depth >= MAX_DEPTH) {
        return "Bahut zyada steps ho gaye. Kya aap dobara bata sakte hain?";
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
            if (p.text) text += p.text;
            if (p.functionCall && !fnCall) fnCall = p.functionCall;
        }
    }

    session.history.push({
        role: "model",
        parts: fnCall
            ? [{ functionCall: fnCall } as Part]
            : [{ text }],
    });

    if (fnCall) {
        const fn = getTool(fnCall.name!);
        const args =
            fnCall.args && typeof fnCall.args === "object"
                ? (fnCall.args as Record<string, string>)
                : {};

        const { msg, addTools } = fn
            ? await fn(args, session)
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
        return phase1(session, depth + 1);
    }

    await saveSession(session);
    return text;
}


async function phase2(session: Session, fallbackText: string): Promise<AgentResponse> {
    const schema = buildResponseSchema(session.matchedAction);

    try {
        const result = await ai.models.generateContent({
            model: MODEL,
            contents: session.history as any,
            config: {
                systemInstruction: RESPONSE_PROMPT,
                responseMimeType: "application/json",
                responseSchema: schema as any,
            },
        });

        const raw = result.text ?? "";
        const parsed = JSON.parse(raw);

        session.matchedAction = null;
        await saveSession(session);

        return {
            response: parsed.response ?? fallbackText,
            action: {
                type: parsed.action?.type ?? "none",
                data: parsed.action?.data ?? {},
            },
        };
    } catch {
        session.matchedAction = null;
        await saveSession(session);

        return {
            response: fallbackText || "Kuch samajh nahi aaya, kya aap dobara bata sakte hain?",
            action: { type: "none", data: {} },
        };
    }
}


function buildResponseSchema(matched: MatchedAction | null) {
    const actionEnum: UIActionType[] = matched
        ? [matched.actionType]
        : ALL_UI_ACTIONS;

    const dataSchema = matched?.dataSchema ?? {
        type: "OBJECT" as const,
        properties: {},
    };

    return {
        type: "OBJECT" as const,
        properties: {
            response: {
                type: "STRING" as const,
                description: "Hinglish response text for the user",
            },
            action: {
                type: "OBJECT" as const,
                properties: {
                    type: {
                        type: "STRING" as const,
                        enum: actionEnum,
                        description: "UI action for client",
                    },
                    data: dataSchema,
                },
                required: ["type", "data"],
            },
        },
        required: ["response", "action"],
    };
}
