import type { FunctionDeclaration } from "@google/genai";

export interface IntentConfig {
    name: string;
    description: string;
    systemPrompt: string;
    tools: FunctionDeclaration[];
    toolHandlers: Record<string, (args: Record<string, any>) => Promise<any>>;
}

export interface UserState {
    userId: string;
    currentIntent: string | null;
    chatHistory: ChatMessage[];
    context: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

export interface ChatMessage {
    role: "user" | "model";
    text: string;
}
