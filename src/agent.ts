import { ai, MODEL } from "./config";
import type { Part, Session, ServerAction } from "./types";
import { saveSession } from "./store";
import { getTool, getDeclarations } from "./tools";
import type { FunctionCall } from "@google/genai";

//  System Prompt
const SYSTEM_PROMPT = `You are RAAHI, a helpful female AI assistant that CONTROLS the CabsWale app on behalf of the user.
You ALWAYS respond in HINGLISH (natural mix of Hindi and English). Never pure English or pure Hindi.
Use respectful tone — "Aap" not "Tu".

## Your Role
You are an APP CONTROL AGENT. You take ACTION inside the app by calling tools.
When a user says something, figure out what they need and execute by calling tools:
- playCustomAudioInApp: Speak to the user in Hinglish (your VOICE — call EVERY turn)
- playPredefineAudioInApp: Play a predefined audio clip by key
- changeScreenInApp: Navigate to a different screen
- uiActionInApp: Interact with UI elements (fill forms, tap buttons, etc.)

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

3. After loading feature, follow its instructions. Use uiActionInApp with the action name
   and data fields specified in the feature instructions.

4. ALWAYS call playCustomAudioInApp to verbally respond. Then chain additional tools as needed.
   Example:
   - User says "Mujhe Delhi se Jaipur duty chahiye"
   → playCustomAudioInApp(text="Bilkul, Delhi se Jaipur ki duties dhund rahi hoon!")
   → uiActionInApp(action="show_duties_list", data={ from_city: "Delhi", to_city: "Jaipur" })

## Rules
- NEVER respond with plain text only. ALWAYS use tools.
- playCustomAudioInApp is your voice — call it every turn.
- Be concise — 1-2 sentences max.
- NEVER skip fetchFeaturePrompt when a [FEATURE] is found.
- If user already provided info, don't ask again — use it directly.

## Fallback
NOTE: If user asks something which is not in KB(knowledge base) do following:
  If user asks something outside your features, call playCustomAudioInApp with a helpful Hinglish
  message suggesting they contact CabsWale support.`;

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

//  Agent Loop
export const BASE_TOOLS = [
    "fetchKnowledgeBase",
    "fetchFeaturePrompt",
    "playPredefineAudioInApp",
    "playCustomAudioInApp",
    "changeScreenInApp",
    "uiActionInApp",
];

const MAX_DEPTH = 15;

/**
 * Run the agent loop. Returns an ordered array of ServerActions
 * collected from tool calls during the conversation turn.
 */
export async function resolve(session: Session): Promise<ServerAction[]> {
    const actions: ServerAction[] = [];
    await loop(session, 0, actions);
    return actions;
}

async function loop(
    session: Session,
    depth: number,
    actions: ServerAction[],
): Promise<void> {
    try {
        if (depth >= MAX_DEPTH) {
            console.warn(
                `[Agent] Max depth (${MAX_DEPTH}) reached for session ${session.id}`,
            );
            return;
        }

        const toolDecls = getDeclarations(session.activeTools);
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
                if (p.text) text += p.text;
                if (p.functionCall && !fnCall) fnCall = p.functionCall;
            }
        }

        //  Function call -> execute tool, collect actions, recurse
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

            const result = fn
                ? await fn(args, session)
                : { msg: `Error: tool "${fnCall.name}" not found.` };

            // Collect actions produced by this tool
            if (result.actions) {
                actions.push(...result.actions);
            }

            // Update session state
            if (result.featureName) session.activeFeature = result.featureName;
            if (result.addTools) {
                for (const t of result.addTools) {
                    if (!session.activeTools.includes(t))
                        session.activeTools.push(t);
                }
            }

            // Feed tool result back to model
            session.history.push({
                role: "function",
                parts: [
                    {
                        functionResponse: {
                            name: fnCall.name!,
                            response: { content: result.msg },
                        },
                    },
                ],
            });

            await saveSession(session);
            return loop(session, depth + 1, actions);
        }

        // No function call -> agent turn is done
        if (text) {
            session.history.push({ role: "model", parts: [{ text }] });
        }
        await saveSession(session);
    } catch (error) {
        console.error("[Agent] Error in loop:", error);
        throw error;
    }
}
