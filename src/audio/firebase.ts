import { GoogleAuth } from "google-auth-library";
import { AUDIO_CONFIG } from "./config";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function getAccessToken(): Promise<string> {
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Failed to get GCP access token");
    return token;
}

export async function uploadAudio(name: string, buf: Buffer): Promise<string> {
    const token = await getAccessToken();
    const { firebaseBucket, firebasePath } = AUDIO_CONFIG;
    const objectPath = encodeURIComponent(`${firebasePath}/${name}.wav`);

    const res = await fetch(
        `https://firebasestorage.googleapis.com/upload/storage/v1/b/${firebaseBucket}/o?uploadType=media&name=${firebasePath}/${name}.wav`,
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/wav" }, body: buf },
    );

    if (!res.ok) throw new Error(`Firebase upload failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { downloadTokens?: string };
    return `https://firebasestorage.googleapis.com/v0/b/${firebaseBucket}/o/${objectPath}?alt=media&token=${data.downloadTokens ?? ""}`;
}
