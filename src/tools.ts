import { Type } from "@google/genai";
import type {
    ToolDeclaration,
    ToolFn,
    KBEntry,
    MatchedAction,
    Session,
    ToolResult,
} from "./types";
import { searchKnowledgeBase, getFeatureDetail } from "./store";
import {
    getToolDeclarationsByNames,
    getToolConfig,
    getAllUIActions,
} from "./registry";
import { executeDynamicTool } from "./executor";

export const RESPOND_TOOL = "respondToUser";

// ─── Framework Tool Declarations (always available) ───

const frameworkDeclarations: Record<string, ToolDeclaration> = {
    fetchKnowledgeBase: {
        name: "fetchKnowledgeBase",
        description:
            "Search knowledge base for info or features matching user query. " +
            "Call on FIRST user message or when user changes topic. " +
            "Do NOT call if already handling a feature flow.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: "Keywords from user query",
                },
            },
            required: ["query"],
        },
    },
    fetchFeaturePrompt: {
        name: "fetchFeaturePrompt",
        description:
            "Get full instructions and tools for a feature. Call with featureName from KB results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                featureName: {
                    type: Type.STRING,
                    description: "Exact featureName from KB",
                },
            },
            required: ["featureName"],
        },
    },
    playPredefineAudioInApp: {
        name: "playPredefineAudioInApp",
        description:
            "Get full instructions and tools for a feature. Call with featureName from KB results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                audioName: {
                    type: Type.STRING,
                    description: "play a predefined audio in the app",
                },
            },
            required: ["audioName"],
        },
    },
    playCustomAudioInApp: {
        name: "playCustomAudioInApp",
        description:
            "Get full instructions and tools for a feature. Call with featureName from KB results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                audioText: {
                    type: Type.STRING,
                    description: "play a custom audio from text in the app",
                },
            },
            required: ["audioText"],
        },
    },
    changeScreenInApp: {
        name: "changeScreenInApp",
        description: "to change screen in app with optional predefined data",
        parameters: {
            type: Type.OBJECT,
            properties: {
                screenName: {
                    type: Type.STRING,
                    description:
                        "name of the screen where to want to redirect in app",
                },
                predefindData: {
                    type: Type.OBJECT,
                    description:
                        "user's provided data that is mention in instruction",
                },
            },
            required: ["screenName"],
        },
    },
    uiActionInApp: {
        name: "uiActionInApp",
        description:
            "to patch a ui action in app with optional predefined data",
        parameters: {
            type: Type.OBJECT,
            properties: {
                uiAction: {
                    type: Type.STRING,
                    description: "action that we want to patch inside ",
                },
                predefindData: {
                    type: Type.OBJECT,
                    description:
                        "user's provided data that is mention in instruction",
                },
            },
            required: ["uiAction"],
        },
    },
};

// ─── Framework Tool Implementations ───

function formatKBResults(entries: KBEntry[]): string {
    if (!entries.length) return "No relevant info found in knowledge base.";
    return entries
        .map((e) =>
            e.type === "info"
                ? `[INFO] ${e.desc}`
                : `[FEATURE] featureName="${e.featureName}" — ${e.desc}\n  -> Call fetchFeaturePrompt(featureName="${e.featureName}") to get instructions.`,
        )
        .join("\n\n");
}

const frameworkImplementations: Record<string, ToolFn> = {
    fetchKnowledgeBase: async (args, session) => {
        const results = await searchKnowledgeBase(
            (args["query"] as string) ?? "",
        );
        const feat = results.find((r) => r.type === "feature") as
            | Extract<KBEntry, { type: "feature" }>
            | undefined;
        if (feat && feat.featureName !== session.activeFeature) {
            session.activeFeature = null;
            session.matchedAction = null;
        }
        return { msg: formatKBResults(results) };
    },
    fetchFeaturePrompt: async (args, session) => {
        const name = args["featureName"] ?? "";
        const detail = await getFeatureDetail(name as string);
        if (!detail) return { msg: `Feature "${name}" not found.` };

        // Set matched action with ALL possible actions for this feature
        session.matchedAction = {
            actions: detail.actions.map((a) => a.uiAction),
            dataSchema: detail.dataSchema,
        };

        return {
            msg: detail.prompt,
            addTools: detail.tools.map((t) => t.name),
            featureName: name as string,
        };
    },
    playPredefineAudioInApp: async (args, session) => {
        return {
            audioName: args.audioName as string,
            msg: "predefined audio is playing in app",
        };
    },
    playCustomAudioInApp: async (args, session) => {
        return {
            audioText: args.audioText as string,
            msg: "custom audio is playing in app",
        };
    },
    changeScreenInApp: async (args, session) => {
        return {
            screenName: args.screenName as string,
            predefindData: args.predefindData as Record<string, unknown>,
            msg: "changed app screen to " + args.screenName,
        };
    },
    uiActionInApp: async (args, session) => {
        return {
            uiAction: args.uiAction as string,
            predefindData: args.predefindData as Record<string, unknown>,
            msg: args.uiAction + " is happened in app",
        };
    },
};

// ─── Public API ───

/**
 * Get tool declarations by names.
 * Checks framework tools first, then registry (dynamic tools).
 */
export function getDeclarations(names: string[]): ToolDeclaration[] {
    const result: ToolDeclaration[] = [];
    for (const n of names) {
        const fw = frameworkDeclarations[n];
        if (fw) {
            result.push(fw);
            continue;
        }
        // Dynamic tools from registry
        const fromRegistry = getToolDeclarationsByNames([n]);
        result.push(...fromRegistry);
    }
    return result;
}

/**
 * Resolve and execute a tool by name.
 * Checks framework tools first, then dynamic (registry + executor).
 */
export function getTool(name: string): ToolFn | undefined {
    // Framework tool?
    const fw = frameworkImplementations[name];
    if (fw) return fw;

    // Dynamic tool from registry?
    const config = getToolConfig(name);
    if (config) {
        return (
            args: Record<string, unknown>,
            session: Session,
        ): Promise<ToolResult> => executeDynamicTool(name, args, session);
    }

    return undefined;
}

/**
 * Check if a tool declaration exists (framework or dynamic).
 */
export function hasDeclaration(name: string): boolean {
    return name in frameworkDeclarations || !!getToolConfig(name);
}

/**
 * Build the respondToUser tool declaration.
 * Constrains action_type to matched feature's actions or all registered actions.
 */
export function buildRespondTool(
    matched: MatchedAction | null,
): ToolDeclaration {
    const actionEnum = matched?.actions?.length
        ? matched.actions
        : getAllUIActions();
    const dataSchema = matched?.dataSchema ?? {
        type: Type.OBJECT,
        properties: {},
    };

    return {
        name: "respondToUser",
        description:
            "Send your final Hinglish response and UI action to the user. Call exactly once to finish every turn.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                response: {
                    type: Type.STRING,
                    description: "Concise Hinglish response (1-2 sentences)",
                },
                action_type: {
                    type: Type.STRING,
                    enum: actionEnum,
                    description: "UI action for client",
                },
                action_data: dataSchema,
            },
            required: ["response", "action_type", "action_data"],
        },
    };
}
