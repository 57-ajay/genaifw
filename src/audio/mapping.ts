import { getIntentForAction } from "../registry";
import { getAudioUrlDirect } from "../services/audio-config";

const overrides = new Map<string, string>();

export function getAudioUrl(actionType: string): string | null {
    if (overrides.has(actionType)) return overrides.get(actionType)!;
    const intent = getIntentForAction(actionType);
    if (intent) return getAudioUrlDirect(intent);
    return null;
}

export function setAudioUrl(actionType: string, url: string): void {
    overrides.set(actionType, url);
}

export function getAllMappedUrls(): Map<string, string> {
    const mapped = new Map<string, string>();
    for (const [k, v] of overrides) mapped.set(k, v);
    return mapped;
}
