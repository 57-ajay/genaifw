import { GoogleAuth } from "google-auth-library";
import { AUDIO_CONFIG } from "./config";

const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function getAccessToken(): Promise<string> {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to get GCP access token");
    return token;
}

export async function synthesize(text: string): Promise<Buffer> {
    const token = await getAccessToken();
    const { languageCode, voiceName, ssmlGender, encoding, sampleRateHertz, model } = AUDIO_CONFIG.tts;

    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: { text, prompt: "Read aloud in a warm, welcoming tone." },
            voice: { languageCode, name: voiceName, ssmlGender, modelName: model },
            audioConfig: { audioEncoding: encoding, sampleRateHertz },
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`TTS failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { audioContent: string };
    return Buffer.from(data.audioContent, "base64");
}
