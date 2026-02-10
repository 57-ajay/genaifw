import { readFileSync, existsSync } from "fs";
import type { IntentType } from "../types";

let config: Record<string, string | null> = {};

export function loadAudioConfig(path = "config/audio_urls.json"): void {
    if (!existsSync(path)) {
        console.warn(`Audio config not found: ${path}`);
        return;
    }
    try {
        config = JSON.parse(readFileSync(path, "utf-8"));
        console.log(`Audio config loaded: ${Object.keys(config).length} mappings`);
    } catch (e: unknown) {
        console.error("Failed to load audio config:", (e as Error).message);
    }
}

export function getAudioUrl(
    intent: IntentType,
    opts?: { interactionCount?: number; isHome?: boolean; requestCount?: number },
): string | null {
    const { interactionCount, isHome = true, requestCount } = opts ?? {};

    if (intent === "entry" && !isHome && requestCount != null && requestCount > 0) {
        const url = config["entry_request_count"];
        if (url) return url;
    }

    if (intent === "entry" && !isHome) {
        const url = config["entry_2"];
        if (url) return url;
    }

    if (interactionCount != null && interactionCount >= 5) {
        const short = config[`${intent}_short`];
        if (short) return short;
    }

    return config[intent] ?? null;
}

export function getAudioUrlDirect(key: string): string | null {
    return config[key] ?? null;
}
