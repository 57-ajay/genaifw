import { ai, MODEL } from "./config";
import type { Part, Session, AgentResponse, UIActionType } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations, buildRespondTool } from "./tools";
import type { FunctionCall } from "@google/genai";

const RESPOND_TOOL_NAME = "respondToUser";

const SYSTEM_PROMPT = `You are RAAHI, a helpful female AI assistant that CONTROLS the CabsWale app on behalf of the user.
You ALWAYS respond in HINGLISH (natural mix of Hindi and English). Never pure English or pure Hindi.
Use respectful tone — "Aap" not "Tu".

## Your Role
You are an APP CONTROL AGENT. You don't just answer questions — you take ACTION inside the app.
When a user says something, you figure out what they need and execute it by calling tools to:
- Speak to the user (playCustomAudioInApp / playPredefineAudioInApp)
- Navigate screens (changeScreenInApp)
- Perform UI actions (uiActionInApp)
You call these tools ITERATIVELY — multiple tools in sequence as needed to fulfill the user's request.

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

4. EXECUTE the request by calling the appropriate combination of tools:
   a) Use playCustomAudioInApp to SPEAK your Hinglish response to the user (this replaces text responses).
   b) Use changeScreenInApp to navigate when the user needs a different screen.
   c) Use uiActionInApp to interact with UI elements (fill forms, tap buttons, toggle settings, etc.).
   d) Use playPredefineAudioInApp for standard audio cues (success sounds, alerts, etc.).

   You MUST call at least playCustomAudioInApp to verbally respond every turn.
   Then chain additional tools as needed. Example flow:
   - User says "Mujhe Delhi se Jaipur booking karni hai"
   → playCustomAudioInApp("Bilkul, aapki Delhi se Jaipur ki booking set karti hoon!")
   → changeScreenInApp("booking", { from_city: "Delhi", to_city: "Jaipur" })

## Response Rules
- NEVER respond with plain text only. ALWAYS act through tools.
- playCustomAudioInApp is your voice — call it every turn to talk to the user.
- Chain multiple tool calls in one turn when the action requires it.
- Be concise in audio text — 1-2 sentences max.
- For multiple destination cities, extract ONLY the first city as to_city.
- NEVER skip fetchFeaturePrompt when a [FEATURE] is found.
- If the user already provided info, don't ask again — use it directly in tool calls.
- If a feature prompt tells you to call a tool, call it immediately.

## Fallback
If user asks something outside your features, call playCustomAudioInApp with a helpful Hinglish message suggesting they contact CabsWale support.`;

function buildSystemPrompt(session: Session): string {
    const parts: string[] = [];

    const ud = session.userData;
    if (ud) {
        if (ud.name) parts.push(`Name: ${ud.name}`);
        if (ud.phoneNo) parts.push(`Phone: ${ud.phoneNo}`);
        if (ud.date) parts.push(`Today's date: ${ud.date}`);
        for (const [key, val] of Object.entries(ud)) {
            if (val && !["name", "phoneNo", "date"].includes(key))
                parts.push(`${key}: ${val}`);
        }
    }

    const dp = session.driverProfile;
    if (dp) {
        const lines: string[] = [`Driver: ${dp.name} (ID: ${dp.id})`];
        if (dp.city) lines.push(`City: ${dp.city}`);
        if (dp.vehicle_type)
            lines.push(
                `Vehicle: ${dp.vehicle_type} ${dp.vehicle_number ?? ""}`,
            );
        if (dp.profileVerified != null)
            lines.push(
                `Profile Verified: ${dp.profileVerified ? "Yes" : "No"}`,
            );
        if (dp.isAadhaarVerified != null)
            lines.push(
                `Aadhaar Verified: ${dp.isAadhaarVerified ? "Yes" : "No"}`,
            );
        if (dp.isDLVerified != null)
            lines.push(`DL Verified: ${dp.isDLVerified ? "Yes" : "No"}`);
        if (dp.isPremium != null)
            lines.push(`Premium: ${dp.isPremium ? "Yes" : "No"}`);
        if (dp.totalEarnings != null)
            lines.push(`Earnings: ${dp.totalEarnings}`);
        if (dp.confirmedTrips != null)
            lines.push(`Confirmed Trips: ${dp.confirmedTrips}`);
        if (dp.connectionCount != null)
            lines.push(`Connections: ${dp.connectionCount}`);
        if (dp.fraud != null)
            lines.push(
                `Fraud Reported: ${dp.fraud ? "Yes" : "No"} (${dp.fraudReports ?? 0})`,
            );
        if (dp.tripTypes?.length)
            lines.push(`Trip Types: ${dp.tripTypes.join(", ")}`);
        if (dp.languages?.length)
            lines.push(`Languages: ${dp.languages.join(", ")}`);
        parts.push("## Driver Profile\n" + lines.join("\n"));
    }

    const loc = session.currentLocation;
    if (loc) parts.push(`Location: (${loc.latitude}, ${loc.longitude})`);

    if (session.activeFeature) {
        parts.push(
            `Active feature: ${session.activeFeature} (skip fetchKnowledgeBase unless user changes topic)`,
        );
    }

    if (!parts.length) return SYSTEM_PROMPT;
    return `${SYSTEM_PROMPT}\n\n## Current Context\n${parts.join("\n")}`;
}

export const BASE_TOOLS = [
    "fetchKnowledgeBase",
    "fetchFeaturePrompt",
    "playPredefineAudioInApp",
    "playCustomAudioInApp",
    "changeScreenInApp",
    "uiActionInApp",
];
const MAX_DEPTH = 15;

export async function resolve(
    session: Session,
    onTextChunk?: (chunk: string) => void,
): Promise<AgentResponse> {
    const response: AgentResponse = {
        audioText: "",
        audioName: "",
        screenName: "",
        uiAction: "",
        predefindData: null,
    };
    return loop(session, 0, response, onTextChunk);
}

async function loop(
    session: Session,
    depth: number,
    response: AgentResponse,
    onTextChunk?: (chunk: string) => void,
): Promise<AgentResponse> {
    try {
        if (depth >= MAX_DEPTH) {
            response.audioName = "";
            return response;
        }

        const respondDecl = buildRespondTool(session.matchedAction);
        const toolDecls = [
            ...getDeclarations(session.activeTools),
            respondDecl,
        ];
        const systemPrompt = buildSystemPrompt(session);

        const stream = await ai.models.generateContentStream({
            model: MODEL,
            contents: session.history as any,
            config: {
                tools: [{ functionDeclarations: toolDecls as any }],
                systemInstruction: systemPrompt,
            },
        });

        let text = "limitReachedAudio";
        let fnCall: FunctionCall | null = null;

        for await (const chunk of stream) {
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            for (const p of parts) {
                if (p.text) {
                    text += p.text;
                    onTextChunk?.(p.text);
                }
                if (p.functionCall && !fnCall) fnCall = p.functionCall;
            }
        }

        if (fnCall) {
            session.history.push({
                role: "model",
                parts: [{ functionCall: fnCall } as Part],
            });

            const fn = getTool(fnCall.name!);
            const args =
                fnCall.args && typeof fnCall.args === "object"
                    ? (fnCall.args as Record<string, unknown>)
                    : {};

            const {
                msg,
                addTools,
                featureName,
                screenName,
                audioName,
                uiAction,
                predefindData,
            } = fn
                ? await fn(args, session)
                : { msg: `Error: tool "${fnCall.name}" not found.` };

            if (featureName) session.activeFeature = featureName;
            if (screenName) response.screenName = screenName;
            if (audioName) response.audioName = audioName;
            if (uiAction) response.uiAction = uiAction;
            if (predefindData)
                response.predefindData = {
                    ...response.predefindData,
                    ...predefindData,
                };
            if (addTools) {
                for (const t of addTools) {
                    if (!session.activeTools.includes(t))
                        session.activeTools.push(t);
                }
            }

            session.history.push({
                role: "function",
                parts: [
                    {
                        functionResponse: {
                            name: fnCall.name!,
                            response: { content: msg },
                        },
                    },
                ],
            });

            await saveSession(session);
            return loop(session, depth + 1, response, onTextChunk);
        }

        session.history.push({ role: "model", parts: [{ text }] });
        session.matchedAction = null;
        await saveSession(session);

        return response;
    } catch (error) {
        console.error("error in loop", error);
        throw error;
    }
}
