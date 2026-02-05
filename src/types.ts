import type { Type } from "@google/genai";


export type KBEntry =
    | { type: "info"; desc: string }
    | { type: "feature"; desc: string; featureName: string; tools: string[] };

export interface FeatureDetail {
    featureName: string;
    desc: string;
    prompt: string;
    tools: string[];
}


export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: {
        type: typeof Type.OBJECT;
        properties: Record<
            string,
            { type: typeof Type.STRING; description: string }
        >;
        required: string[];
    };
}

export type ToolFn = (args: Record<string, string>) => Promise<ToolResult>;

export interface ToolResult {
    msg: string;
    addTools?: string[];
}


export interface Session {
    id: string;
    history: ChatMessage[];
    activeTools: string[];
    createdAt: number;
    updatedAt: number;
}

export interface ChatMessage {
    role: "user" | "model" | "function";
    parts: Part[];
}

export type Part =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, string> } }
    | { functionResponse: { name: string; response: { content: string } } };


export interface APIResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}
