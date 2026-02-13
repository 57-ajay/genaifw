import { ai, MODEL } from "./config";
import type { Part, Session, AgentResponse, UIActionType } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations, buildRespondTool } from "./tools";
import type { FunctionCall } from "@google/genai";

const RESPOND_TOOL_NAME = "respondToUser";

const SYSTEM_PROMPT = `You are RAAHI, a helpful female assistant for Cabswale.
You ALWAYS respond in HINGLISH (natural mix of Hindi and English). Never pure English or pure Hindi.
Use respectful tone — "Aap" not "Tu".

## CabsWale Info
- CabsWale is a travel platform for outstation trips. Drivers are chosen directly by customers.
- Joining is free. No commission on trip fare. Customers pay driver directly (Cash/UPI).
- Verification needs RC, DL, Aadhaar. Mandatory for getting duties.
- Premium drivers get badge, higher search priority, exclusive duties.
- Wallet recharge needed for premium features.

## Workflow
1. Call fetchKnowledgeBase ONLY when:
   - First user message in session
   - User changes topic or asks something NEW
   - You do NOT have loaded feature instructions for current ask
   Do NOT call if continuing an active feature flow.

2. If KB result has [FEATURE] entries, call fetchFeaturePrompt with exact featureName.
3. After loading feature, follow its instructions and use its tools.
4. When ready to respond, call respondToUser with your response text and UI action.

## Response Rules
- ALWAYS finish by calling respondToUser. Mandatory.
- Put your Hinglish text in the "response" field.
- Set action_type to the appropriate UI action.
- Fill action_data fields per the feature schema.
- Be concise — 1-2 sentences max.
- For multiple destination cities, extract ONLY the first city as to_city.
- NEVER skip fetchFeaturePrompt when a [FEATURE] is found.
- When a feature prompt tells you to call a tool, call it.
- If the user already provided info, don't ask again — use it.

## Fallback
If user asks something outside your features, classify as "information" and suggest contacting CabsWale support.`;

function buildSystemPrompt(session: Session): string {
    const parts: string[] = [];

    const ud = session.userData;
    if (ud) {
        if (ud.name) parts.push(`Name: ${ud.name}`);
        if (ud.phoneNo) parts.push(`Phone: ${ud.phoneNo}`);
        if (ud.date) parts.push(`Today's date: ${ud.date}`);
        for (const [key, val] of Object.entries(ud)) {
            if (val && !["name", "phoneNo", "date"].includes(key)) parts.push(`${key}: ${val}`);
        }
    }

    const dp = session.driverProfile;
    if (dp) {
        const lines: string[] = [`Driver: ${dp.name} (ID: ${dp.id})`];
        if (dp.city) lines.push(`City: ${dp.city}`);
        if (dp.vehicle_type) lines.push(`Vehicle: ${dp.vehicle_type} ${dp.vehicle_number ?? ""}`);
        if (dp.profileVerified != null) lines.push(`Profile Verified: ${dp.profileVerified ? "Yes" : "No"}`);
        if (dp.isAadhaarVerified != null) lines.push(`Aadhaar Verified: ${dp.isAadhaarVerified ? "Yes" : "No"}`);
        if (dp.isDLVerified != null) lines.push(`DL Verified: ${dp.isDLVerified ? "Yes" : "No"}`);
        if (dp.isPremium != null) lines.push(`Premium: ${dp.isPremium ? "Yes" : "No"}`);
        if (dp.totalEarnings != null) lines.push(`Earnings: ${dp.totalEarnings}`);
        if (dp.confirmedTrips != null) lines.push(`Confirmed Trips: ${dp.confirmedTrips}`);
        if (dp.connectionCount != null) lines.push(`Connections: ${dp.connectionCount}`);
        if (dp.fraud != null) lines.push(`Fraud Reported: ${dp.fraud ? "Yes" : "No"} (${dp.fraudReports ?? 0})`);
        if (dp.tripTypes?.length) lines.push(`Trip Types: ${dp.tripTypes.join(", ")}`);
        if (dp.languages?.length) lines.push(`Languages: ${dp.languages.join(", ")}`);
        parts.push("## Driver Profile\n" + lines.join("\n"));
    }

    const loc = session.currentLocation;
    if (loc) parts.push(`Location: (${loc.latitude}, ${loc.longitude})`);

    if (session.activeFeature) {
        parts.push(`Active feature: ${session.activeFeature} (skip fetchKnowledgeBase unless user changes topic)`);
    }

    if (!parts.length) return SYSTEM_PROMPT;
    return `${SYSTEM_PROMPT}\n\n## Current Context\n${parts.join("\n")}`;
}

export const BASE_TOOLS = ["fetchKnowledgeBase", "fetchFeaturePrompt"];
const MAX_DEPTH = 15;

export async function resolve(
    session: Session,
    onTextChunk?: (chunk: string) => void,
): Promise<AgentResponse> {
    return loop(session, 0, onTextChunk);
}

async function loop(
    session: Session,
    depth: number,
    onTextChunk?: (chunk: string) => void,
): Promise<AgentResponse> {
    if (depth >= MAX_DEPTH) {
        return {
            response: "Bahut zyada steps ho gaye. Kya aap dobara bata sakte hain?",
            action: { type: "none", data: {} },
        };
    }

    const respondDecl = buildRespondTool(session.matchedAction);
    const toolDecls = [...getDeclarations(session.activeTools), respondDecl];
    const systemPrompt = buildSystemPrompt(session);

    const stream = await ai.models.generateContentStream({
        model: MODEL,
        contents: session.history as any,
        config: {
            tools: [{ functionDeclarations: toolDecls as any }],
            systemInstruction: systemPrompt,
        },
    });

    let text = "";
    let fnCall: FunctionCall | null = null;

    for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
            if (p.text) { text += p.text; onTextChunk?.(p.text); }
            if (p.functionCall && !fnCall) fnCall = p.functionCall;
        }
    }

    if (fnCall?.name === RESPOND_TOOL_NAME) {
        const args = (fnCall.args ?? {}) as Record<string, unknown>;
        const responseText = (args.response as string) ?? text ?? "Kuch samajh nahi aaya.";

        session.history.push({ role: "model", parts: [{ text: responseText }] });
        session.matchedAction = null;
        await saveSession(session);

        return {
            response: responseText,
            action: {
                type: (args.action_type as UIActionType) ?? "none",
                data: (args.action_data as Record<string, unknown>) ?? {},
            },
        };
    }

    if (fnCall) {
        session.history.push({ role: "model", parts: [{ functionCall: fnCall } as Part] });

        const fn = getTool(fnCall.name!);
        const args = fnCall.args && typeof fnCall.args === "object"
            ? (fnCall.args as Record<string, string>)
            : {};

        const { msg, addTools, featureName } = fn
            ? await fn(args, session)
            : { msg: `Error: tool "${fnCall.name}" not found.` };

        if (featureName) session.activeFeature = featureName;
        if (addTools) {
            for (const t of addTools) {
                if (!session.activeTools.includes(t)) session.activeTools.push(t);
            }
        }

        session.history.push({
            role: "function",
            parts: [{ functionResponse: { name: fnCall.name!, response: { content: msg } } }],
        });

        await saveSession(session);
        return loop(session, depth + 1, onTextChunk);
    }

    session.history.push({ role: "model", parts: [{ text }] });
    session.matchedAction = null;
    await saveSession(session);

    return {
        response: text || "Kuch samajh nahi aaya, kya aap dobara bata sakte hain?",
        action: { type: "none", data: {} },
    };
}
