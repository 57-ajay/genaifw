import { GoogleAuth } from "google-auth-library";
import { AUDIO_CONFIG } from "./config";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function getAccessToken(): Promise<string> {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to get GCP access token");
    return token;
}

/**
 * Create a WAV file header for LINEAR16 PCM audio.
 */
export function createWavHeader(opts?: {
    sampleRate?: number;
    bitsPerSample?: number;
    channels?: number;
    dataSize?: number;
}): Buffer {
    const sampleRate = opts?.sampleRate ?? 24000;
    const bitsPerSample = opts?.bitsPerSample ?? 16;
    const channels = opts?.channels ?? 1;
    const dataSize = opts?.dataSize ?? 0;

    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    const riffSize = Math.min(36 + dataSize, 0xFFFFFFFF);
    const clampedDataSize = Math.min(dataSize, 0xFFFFFFFF);

    const header = Buffer.alloc(44);
    let offset = 0;

    // RIFF header
    header.write("RIFF", offset); offset += 4;
    header.writeUInt32LE(riffSize, offset); offset += 4;
    header.write("WAVE", offset); offset += 4;

    // fmt sub-chunk
    header.write("fmt ", offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4;          // sub-chunk size
    header.writeUInt16LE(1, offset); offset += 2;           // PCM format
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data sub-chunk
    header.write("data", offset); offset += 4;
    header.writeUInt32LE(clampedDataSize, offset);

    return header;
}

/**
 * Create a streaming WAV header with "infinite" data size.
 * Players will stream until EOF instead of waiting for a known length.
 */
export function createStreamingWavHeader(): Buffer {
    return createWavHeader({ dataSize: 0xFFFFFFFF - 44 });
}

/**
 * Synthesize speech via Google Cloud TTS REST API.
 * Returns a complete WAV buffer (header + PCM data).
 */
export async function synthesize(text: string): Promise<Buffer> {
    const token = await getAccessToken();
    const { languageCode, voiceName, ssmlGender, encoding, sampleRateHertz, model } = AUDIO_CONFIG.tts;

    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            input: { text, prompt: "Read aloud in a warm, welcoming tone." },
            voice: { languageCode, name: voiceName, ssmlGender, modelName: model },
            audioConfig: { audioEncoding: encoding, sampleRateHertz },
        }),
    });

    if (!res.ok) throw new Error(`TTS failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { audioContent: string };
    const pcmData = Buffer.from(data.audioContent, "base64");

    const wavHeader = createWavHeader({ dataSize: pcmData.length });
    return Buffer.concat([wavHeader, pcmData]);
}
