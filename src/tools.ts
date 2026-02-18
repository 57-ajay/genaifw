import { Type } from "@google/genai";
import type {
    ToolDeclaration,
    ToolFn,
    KBEntry,
    Session,
    ToolResult,
} from "./types";
import { searchKnowledgeBase, getFeatureDetail } from "./store";
import { getToolDeclarationsByNames, getToolConfig } from "./registry";
import { executeDynamicTool } from "./executor";

//  Framework Tool Declarations
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
            "Load full instructions and tools for a feature. Call with exact featureName from KB results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                featureName: {
                    type: Type.STRING,
                    description: "Exact featureName from KB result",
                },
            },
            required: ["featureName"],
        },
    },

    playPredefineAudioInApp: {
        name: "playPredefineAudioInApp",
        description:
            "Play a predefined audio clip in the app by its key name (e.g. greeting, thank_you).",
        parameters: {
            type: Type.OBJECT,
            properties: {
                audioKey: {
                    type: Type.STRING,
                    description: "Key name of the predefined audio to play",
                },
            },
            required: ["audioKey"],
        },
    },

    playCustomAudioInApp: {
        name: "playCustomAudioInApp",
        description:
            "Speak a custom Hinglish message to the user via text-to-speech. " +
            "This is your VOICE — call it every turn to talk to the user.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                text: {
                    type: Type.STRING,
                    description: "Hinglish text to speak aloud (1-2 sentences)",
                },
            },
            required: ["text"],
        },
    },

    changeScreenInApp: {
        name: "changeScreenInApp",
        description:
            "Navigate the app to a different screen, optionally passing data to pre-fill the screen.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                screen: {
                    type: Type.STRING,
                    description: "Target screen name",
                },
                data: {
                    type: Type.OBJECT,
                    description: "Data to pass to the target screen",
                },
            },
            required: ["screen"],
        },
    },

    uiActionInApp: {
        name: "uiActionInApp",
        description:
            "Perform a UI action in the app (fill forms, tap buttons, toggle settings). " +
            "Pass the action name and any associated data as instructed by the feature prompt.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                action: {
                    type: Type.STRING,
                    description: "UI action identifier",
                },
                data: {
                    type: Type.OBJECT,
                    description:
                        "Data for the action (fields described in feature instructions)",
                },
            },
            required: ["action"],
        },
    },
};

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
        }
        return { msg: formatKBResults(results) };
    },

    fetchFeaturePrompt: async (args, _session) => {
        const name = (args["featureName"] ?? "") as string;
        const detail = await getFeatureDetail(name);
        if (!detail) return { msg: `Feature "${name}" not found.` };

        const actionList = detail.actions.map((a) => a.uiAction).join(", ");
        const schemaProps = (detail.dataSchema as Record<string, unknown>)
            ?.properties;
        const dataFields = schemaProps
            ? Object.entries(
                  schemaProps as Record<string, Record<string, unknown>>,
              )
                  .map(
                      ([k, v]) =>
                          `${k}: ${v?.description ?? k}${v?.nullable ? " (optional)" : ""}`,
                  )
                  .join(", ")
            : "";

        const instructions = [
            detail.prompt,
            "",
            `Use uiActionInApp with one of these actions: [${actionList}]`,
            `Default action: "${detail.defaultAction}"`,
            dataFields ? `Include in data: { ${dataFields} }` : "",
        ]
            .filter(Boolean)
            .join("\n");

        return {
            msg: instructions,
            addTools: detail.tools.map((t) => t.name),
            featureName: name,
        };
    },

    playPredefineAudioInApp: async (args) => {
        const key = (args["audioKey"] ?? "") as string;
        return {
            msg: `Predefined audio "${key}" is playing.`,
            actions: [{ type: "playAudio" as const, key }],
        };
    },

    playCustomAudioInApp: async (args) => {
        const text = (args["text"] ?? "") as string;
        return {
            msg: "Speaking to user.",
            actions: [{ type: "speak" as const, text }],
        };
    },

    changeScreenInApp: async (args) => {
        const screen = (args["screen"] ?? "") as string;
        const data = args["data"] as Record<string, unknown> | undefined;
        return {
            msg: `Navigating to screen "${screen}".`,
            actions: [{ type: "navigate" as const, screen, data }],
        };
    },

    uiActionInApp: async (args) => {
        const action = (args["action"] ?? "") as string;
        const data = args["data"] as Record<string, unknown> | undefined;
        return {
            msg: `UI action "${action}" dispatched.`,
            actions: [{ type: "uiAction" as const, action, data }],
        };
    },
};

export function getDeclarations(names: string[]): ToolDeclaration[] {
    const result: ToolDeclaration[] = [];
    for (const n of names) {
        const fw = frameworkDeclarations[n];
        if (fw) {
            result.push(fw);
            continue;
        }
        const fromRegistry = getToolDeclarationsByNames([n]);
        result.push(...fromRegistry);
    }
    return result;
}

export function getTool(name: string): ToolFn | undefined {
    const fw = frameworkImplementations[name];
    if (fw) return fw;

    const config = getToolConfig(name);
    if (config) {
        return (
            args: Record<string, unknown>,
            session: Session,
        ): Promise<ToolResult> => executeDynamicTool(name, args, session);
    }

    return undefined;
}

export function hasDeclaration(name: string): boolean {
    return name in frameworkDeclarations || !!getToolConfig(name);
}
