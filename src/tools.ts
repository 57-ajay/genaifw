import { Type } from "@google/genai";
import type { ToolDeclaration, ToolFn, KBEntry, MatchedAction } from "./types";
import { ALL_UI_ACTIONS } from "./types";
import { searchKnowledgeBase, getFeatureDetail } from "./store";

export const RESPOND_TOOL = "respondToUser";


const declarations: Record<string, ToolDeclaration> = {

    fetchKnowledgeBase: {
        name: "fetchKnowledgeBase",
        description:
            "Search knowledge base for info or features matching user query. " +
            "Call this on the FIRST user message or when the user changes topic. " +
            "Do NOT call if you are already handling a feature flow and the user is continuing it.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: { type: Type.STRING, description: "Keywords from user query" },
            },
            required: ["query"],
        },
    },

    fetchFeaturePrompt: {
        name: "fetchFeaturePrompt",
        description: "Get full instructions and tools for a feature. Call with featureName from KB results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                featureName: { type: Type.STRING, description: "Exact featureName from knowledge base" },
            },
            required: ["featureName"],
        },
    },

    sendAadharOtpTool: {
        name: "sendAadharOtpTool",
        description: "Send Aadhaar verification OTP to a 12-digit Aadhaar number",
        parameters: {
            type: Type.OBJECT,
            properties: {
                aadharNumber: { type: Type.STRING, description: "12-digit Aadhaar number" },
            },
            required: ["aadharNumber"],
        },
    },

    verifyAadharOtpTool: {
        name: "verifyAadharOtpTool",
        description: "Verify Aadhaar using a 4-digit OTP",
        parameters: {
            type: Type.OBJECT,
            properties: {
                otp: { type: Type.STRING, description: "4-digit OTP" },
            },
            required: ["otp"],
        },
    },

    searchCabsTool: {
        name: "searchCabsTool",
        description: "Search available cabs for outstation trip",
        parameters: {
            type: Type.OBJECT,
            properties: {
                pickup: { type: Type.STRING, description: "Pickup location" },
                destination: { type: Type.STRING, description: "Destination" },
                date: { type: Type.STRING, description: "Travel date (optional)" },
            },
            required: ["pickup", "destination"],
        },
    },
};


function formatKBResults(entries: KBEntry[]): string {
    if (!entries.length) return "No relevant info found in knowledge base.";

    const lines: string[] = [];
    for (const e of entries) {
        if (e.type === "info") {
            lines.push(`[INFO] ${e.desc}`);
        } else {
            lines.push(
                `[FEATURE] featureName="${e.featureName}" — ${e.desc}\n` +
                `  -> Call fetchFeaturePrompt(featureName="${e.featureName}") to get instructions.`
            );
        }
    }
    return lines.join("\n\n");
}


const implementations: Record<string, ToolFn> = {

    fetchKnowledgeBase: async (args, session) => {
        const results = await searchKnowledgeBase(args["query"] ?? "");

        const featureEntry = results.find((r) => r.type === "feature") as
            | Extract<KBEntry, { type: "feature" }>
            | undefined;

        if (featureEntry && featureEntry.featureName !== session.activeFeature) {
            session.activeFeature = null;
            session.matchedAction = null;
        }

        return { msg: formatKBResults(results) };
    },

    fetchFeaturePrompt: async (args, session) => {
        const name = args["featureName"] ?? "";
        const detail = await getFeatureDetail(name);
        if (!detail) return { msg: `Feature "${name}" not found.` };

        session.matchedAction = {
            actionType: detail.actionType,
            dataSchema: detail.dataSchema,
        };

        return {
            msg: detail.prompt,
            addTools: detail.tools,
            featureName: name,
        };
    },

    sendAadharOtpTool: async (args) => {
        console.log(`  → OTP sent to Aadhaar: ${args["aadharNumber"]}`);
        return { msg: "OTP sent successfully to the registered mobile number." };
    },

    verifyAadharOtpTool: async (args) => {
        const otp = args["otp"] ?? "";
        const ok = otp === "6969";
        console.log(`  → OTP verify: ${otp} → ${ok ? "✓" : "✗"}`);
        return {
            msg: ok
                ? "Aadhaar verified successfully. User identity confirmed."
                : "Incorrect OTP. Verification failed.",
        };
    },

    searchCabsTool: async (args) => {
        const pickup = args["pickup"] ?? "unknown";
        const dest = args["destination"] ?? "unknown";
        console.log(`  → Searching cabs: ${pickup} → ${dest}`);
        return {
            msg: JSON.stringify({
                results: [
                    { driver: "Raju", car: "Swift Dzire", price: 2500, rating: 4.5 },
                    { driver: "Amit", car: "Innova", price: 4200, rating: 4.8 },
                ],
            }),
        };
    },
};


export function getDeclarations(names: string[]): ToolDeclaration[] {
    return names
        .map((n) => declarations[n])
        .filter((d): d is ToolDeclaration => d !== undefined);
}

export function getTool(name: string): ToolFn | undefined {
    return implementations[name];
}

export function hasDeclaration(name: string): boolean {
    return name in declarations;
}

export function buildRespondTool(matched: MatchedAction | null): ToolDeclaration {
    const actionEnum = matched ? [matched.actionType] : ALL_UI_ACTIONS;
    const dataSchema = matched?.dataSchema ?? {
        type: Type.OBJECT,
        properties: {},
    };

    return {
        name: "respondToUser",
        description:
            "Send your final Hinglish response and UI action to the user. " +
            "You MUST call this exactly once to finish every conversation turn.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                response: {
                    type: Type.STRING,
                    description: "Concise Hinglish response text (1-2 sentences)",
                },
                action_type: {
                    type: Type.STRING,
                    enum: actionEnum,
                    description: "UI action for the client app",
                },
                action_data: dataSchema,
            },
            required: ["response", "action_type", "action_data"],
        },
    };
}
