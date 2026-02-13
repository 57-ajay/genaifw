import { readFileSync, existsSync } from "fs";
import { getAudioFromRegistry } from "../registry";

let baseConfig: Record<string, string | null> = {};

export function loadAudioConfig(path = "config/audio_urls.json"): void {
    if (!existsSync(path)) {
        console.warn(`Audio config not found: ${path}`);
        return;
    }
    try {
        baseConfig = JSON.parse(readFileSync(path, "utf-8"));
        console.log(`Audio config loaded: ${Object.keys(baseConfig).length} mappings`);
    } catch (e: unknown) {
        console.error("Failed to load audio config:", (e as Error).message);
    }
}

/**
 * Get the raw base audio map (from JSON file) for registry rebuild.
 */
export function getBaseAudioMap(): Record<string, string | null> {
    return { ...baseConfig };
}

/**
 * Resolve audio URL for an intent, with variant logic.
 * Checks registry first (which includes base + feature overrides), then falls back to base config.
 */
export function getAudioUrl(
    intent: string,
    opts?: { interactionCount?: number; isHome?: boolean; requestCount?: number },
): string | null {
    const { interactionCount, isHome = true, requestCount } = opts ?? {};

    // Entry variants
    if (intent === "entry" && !isHome && requestCount != null && requestCount > 0) {
        const url = resolveKey("entry_request_count");
        if (url) return url;
    }

    if (intent === "entry" && !isHome) {
        const url = resolveKey("entry_2");
        if (url) return url;
    }

    // Short variants for high interaction count
    if (interactionCount != null && interactionCount >= 5) {
        const short = resolveKey(`${intent}_short`);
        if (short) return short;
    }

    return resolveKey(intent);
}

/**
 * Direct key lookup (no variant logic).
 */
export function getAudioUrlDirect(key: string): string | null {
    return resolveKey(key);
}

/**
 * Resolve a key: registry first (has base + overrides), then base config fallback.
 */
function resolveKey(key: string): string | null {
    // Registry has the merged map (base + feature overrides)
    const fromRegistry = getAudioFromRegistry(key);
    if (fromRegistry !== undefined) return fromRegistry;

    // Fallback to base config (in case registry hasn't been built yet during startup)
    return baseConfig[key] ?? null;
}
