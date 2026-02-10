import type { UIActionType } from "../types";
import { ACTION_TO_INTENT } from "../types";
import { getAudioUrlDirect } from "../services/audio-config";

const overrides = new Map<string, string>();

export function getAudioUrl(actionType: UIActionType): string | null {
    if (overrides.has(actionType)) return overrides.get(actionType)!;
    const intent = ACTION_TO_INTENT[actionType];
    if (intent) return getAudioUrlDirect(intent);
    return null;
}

export function setAudioUrl(actionType: string, url: string): void {
    overrides.set(actionType, url);
}

export function getAllMappedUrls(): Map<string, string> {
    const mapped = new Map<string, string>();
    // Collect from audio config + overrides
    for (const [k, v] of overrides) mapped.set(k, v);
    return mapped;
}
