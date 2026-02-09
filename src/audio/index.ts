import type { WebSocket } from "ws";
import type { UIActionType } from "../types";
import { AUDIO_CONFIG } from "./config";
import { getAudioUrl, setAudioUrl } from "./mapping";
import { getCached, setCached, fetchBuffer } from "./cache";
import { synthesize } from "./tts";
import { uploadAudio } from "./firebase";

export { preloadAll, cacheStats } from "./cache";
export { AUDIO_CONFIG } from "./config";

export async function resolveAudio(
    actionType: UIActionType,
    responseText: string,
): Promise<Buffer> {
    if (AUDIO_CONFIG.forceTTS) {
        return synthesize(responseText);
    }

    const url = getAudioUrl(actionType);

    if (url) {
        const cached = getCached(actionType);
        if (cached) return cached;

        const buf = await fetchBuffer(url);
        setCached(actionType, buf);
        return buf;
    }

    const audioBuf = await synthesize(responseText);

    if (actionType !== "none") {
        persistGenerated(actionType, audioBuf).catch((e) =>
            console.error(`Audio persist failed for ${actionType}:`, e.message),
        );
    }

    return audioBuf;
}

async function persistGenerated(actionType: string, buf: Buffer): Promise<void> {
    const downloadUrl = await uploadAudio(actionType, buf);
    setAudioUrl(actionType, downloadUrl);
    setCached(actionType, buf);
    console.log(`Audio persisted for ${actionType}`);
}

export function streamAudio(ws: WebSocket, audio: Buffer): void {
    if (ws.readyState !== ws.OPEN) return;

    ws.send(JSON.stringify({ type: "audio_start", contentType: "audio/wav", size: audio.length }));

    const { chunkSize } = AUDIO_CONFIG;
    for (let i = 0; i < audio.length; i += chunkSize) {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(audio.subarray(i, i + chunkSize));
    }

    ws.send(JSON.stringify({ type: "audio_end" }));
}
