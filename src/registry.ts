import type { FeatureDetail, ToolDeclaration, ToolConfig } from "./types";

// ─── Runtime Registry (rebuilt on startup + dashboard writes) ───

export interface RuntimeRegistry {
    features: Map<string, FeatureDetail>;
    declarations: Map<string, ToolDeclaration>;
    toolConfigs: Map<string, ToolConfig>;
    actionToIntent: Map<string, string>;
    audioMap: Map<string, string | null>;
    allUIActions: string[];
}

const registry: RuntimeRegistry = {
    features: new Map(),
    declarations: new Map(),
    toolConfigs: new Map(),
    actionToIntent: new Map(),
    audioMap: new Map(),
    allUIActions: [],
};

// ─── Default system actions (always available even with no features) ───

const SYSTEM_ACTIONS: Array<{ uiAction: string; intent: string }> = [
    { uiAction: "entry", intent: "entry" },
    { uiAction: "none", intent: "generic" },
];

// ─── Rebuild from feature list ───

export function rebuildRegistry(features: FeatureDetail[], baseAudioMap?: Record<string, string | null>): void {
    registry.features.clear();
    registry.declarations.clear();
    registry.toolConfigs.clear();
    registry.actionToIntent.clear();
    registry.audioMap.clear();

    // 1. Load base audio map (from audio_urls.json)
    if (baseAudioMap) {
        for (const [k, v] of Object.entries(baseAudioMap)) {
            registry.audioMap.set(k, v);
        }
    }

    // 2. System actions
    for (const sa of SYSTEM_ACTIONS) {
        registry.actionToIntent.set(sa.uiAction, sa.intent);
    }

    const actionSet = new Set<string>(SYSTEM_ACTIONS.map((a) => a.uiAction));

    // 3. Process each feature
    for (const feat of features) {
        registry.features.set(feat.featureName, feat);

        // Actions -> intent mapping
        for (const am of feat.actions) {
            registry.actionToIntent.set(am.uiAction, am.intent);
            actionSet.add(am.uiAction);
        }

        // Audio mappings
        if (feat.audioMappings) {
            for (const [k, v] of Object.entries(feat.audioMappings)) {
                registry.audioMap.set(k, v);
            }
        }

        // Tool declarations + configs
        for (const tc of feat.tools) {
            const decl: ToolDeclaration = {
                name: tc.name,
                description: tc.declaration.description,
                parameters: tc.declaration.parameters,
            };
            registry.declarations.set(tc.name, decl);
            registry.toolConfigs.set(tc.name, tc);
        }
    }

    registry.allUIActions = Array.from(actionSet);

    console.log(
        `[Registry] rebuilt: ${registry.features.size} features, ` +
        `${registry.declarations.size} tools, ` +
        `${registry.actionToIntent.size} actions, ` +
        `${registry.audioMap.size} audio mappings`,
    );
}

// ─── Getters ───

export function getFeatureFromRegistry(name: string): FeatureDetail | undefined {
    return registry.features.get(name);
}

export function getToolDeclaration(name: string): ToolDeclaration | undefined {
    return registry.declarations.get(name);
}

export function getToolConfig(name: string): ToolConfig | undefined {
    return registry.toolConfigs.get(name);
}

export function getIntentForAction(uiAction: string): string {
    return registry.actionToIntent.get(uiAction) ?? "generic";
}

export function getAudioFromRegistry(key: string): string | null {
    return registry.audioMap.get(key) ?? null;
}

export function getAllUIActions(): string[] {
    return registry.allUIActions;
}

export function getRegisteredFeatures(): FeatureDetail[] {
    return Array.from(registry.features.values());
}

export function getToolDeclarationsByNames(names: string[]): ToolDeclaration[] {
    return names
        .map((n) => registry.declarations.get(n))
        .filter((d): d is ToolDeclaration => !!d);
}

export function getRegistry(): RuntimeRegistry {
    return registry;
}
