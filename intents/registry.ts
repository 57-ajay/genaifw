import type { IntentConfig } from "../types";

// ── Central registry: intent name → config ──
const registry = new Map<string, IntentConfig>();

export const registerIntent = (config: IntentConfig): void => {
    registry.set(config.name, config);
};

export const getIntentConfig = (name: string): IntentConfig | undefined => {
    return registry.get(name);
};

export const getAllIntentNames = (): string[] => {
    return [...registry.keys()];
};

export const getAllIntentDescriptions = (): { name: string; description: string }[] => {
    return [...registry.values()].map(c => ({
        name: c.name,
        description: c.description,
    }));
};
