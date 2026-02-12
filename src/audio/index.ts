import type { WebSocket } from "ws";
import type { UIActionType } from "../types";
import { AUDIO_CONFIG } from "./config";
import { getAudioUrl, setAudioUrl } from "./mapping";
import { getCached, setCached, fetchBuffer } from "./cache";
import { synthesize } from "./tts";
import { uploadAudio } from "./firebase";

export { preloadAll, cacheStats } from "./cache";
export { AUDIO_CONFIG } from "./config";
export { createStreamingWavHeader } from "./tts";

/**
 * Resolve audio for a given action type.
 * Returns a complete WAV buffer (with header).
 */
export async function resolveAudio(actionType: UIActionType, responseText: string): Promise<Buffer> {
    if (AUDIO_CONFIG.forceTTS) return synthesize(responseText);

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
            console.error(`Audio persist failed for ${actionType}:`, (e as Error).message),
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

/**
 * Stream audio as raw binary chunks.
 * Yields WAV header first, then PCM data in chunks.
 */
export function* streamAudioRaw(audio: Buffer): Generator<Buffer> {
    const { chunkSize } = AUDIO_CONFIG;
    for (let i = 0; i < audio.length; i += chunkSize) {
        yield audio.subarray(i, i + chunkSize);
    }
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

export function streamAudioSSE(controller: ReadableStreamDefaultController<Uint8Array>, audio: Buffer): void {
    const encoder = new TextEncoder();
    const { chunkSize } = AUDIO_CONFIG;

    controller.enqueue(encoder.encode(`event: audio_start\ndata: ${JSON.stringify({ contentType: "audio/wav", size: audio.length })}\n\n`));

    for (let i = 0; i < audio.length; i += chunkSize) {
        const chunk = audio.subarray(i, i + chunkSize);
        controller.enqueue(encoder.encode(`event: audio_chunk\ndata: ${chunk.toString("base64")}\n\n`));
    }

    controller.enqueue(encoder.encode(`event: audio_end\ndata: {}\n\n`));
}
