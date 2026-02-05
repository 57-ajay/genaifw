import { createClient, type RedisClientType } from "redis";
import type { Session, KBEntry, FeatureDetail } from "./types";

let client: RedisClientType;

export async function connectRedis(url = "redis://localhost:6379") {
    client = createClient({ url });
    client.on("error", (e) => console.error("Redis:", e.message));
    await client.connect();
    console.log("✓ Redis connected");
}

export async function disconnectRedis() {
    await client?.quit();
}

export function getClient() {
    return client;
}


const sessionKey = (id: string) => `session:${id}`;

export async function getSession(id: string): Promise<Session | null> {
    const raw = await client.get(sessionKey(id));
    return raw ? JSON.parse(raw) : null;
}

export async function saveSession(session: Session): Promise<void> {
    session.updatedAt = Date.now();
    await client.set(sessionKey(session.id), JSON.stringify(session));
}

export async function deleteSession(id: string): Promise<void> {
    await client.del(sessionKey(id));
}

export function newSession(id: string, baseTools: string[]): Session {
    return {
        id,
        history: [],
        activeTools: [...baseTools],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

// Knowledge Base CRUD
// Each entry stored as kb:entry:<id> with an index set at kb:index

const KB_PREFIX = "kb:entry:";
const KB_INDEX = "kb:index";

export async function addKBEntry(entry: KBEntry): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await client.set(`${KB_PREFIX}${id}`, JSON.stringify(entry));
    await client.sAdd(KB_INDEX, id);
    return id;
}

export async function addKBEntries(entries: KBEntry[]): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of entries) {
        ids.push(await addKBEntry(entry));
    }
    return ids;
}

export async function getAllKBEntries(): Promise<KBEntry[]> {
    const ids = await client.sMembers(KB_INDEX);
    if (!ids.length) return [];
    const entries: KBEntry[] = [];
    for (const id of ids) {
        const raw = await client.get(`${KB_PREFIX}${id}`);
        if (raw) entries.push(JSON.parse(raw));
    }
    return entries;
}

export async function clearKB(): Promise<void> {
    const ids = await client.sMembers(KB_INDEX);
    for (const id of ids) {
        await client.del(`${KB_PREFIX}${id}`);
    }
    await client.del(KB_INDEX);
}

/**
 * Word-level search across KB entries.
 * Splits query into words, matches if ANY word appears in the entry desc/featureName.
 * This replaces the broken substring match that failed on "verify aadhar" vs "aadhaar".
 *
 * In production: replace with RediSearch FT.SEARCH + vector embeddings.
 */
export async function searchKnowledgeBase(query: string): Promise<KBEntry[]> {
    const all = await getAllKBEntries();
    if (!all.length) return [];

    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

    if (!words.length) return all;

    return all.filter((entry) => {
        const haystack = entry.desc.toLowerCase() +
            (entry.type === "feature" ? ` ${entry.featureName.toLowerCase()}` : "");
        return words.some((w) => haystack.includes(w));
    });
}

//  Features CRUD

const FEAT_PREFIX = "feature:";
const FEAT_INDEX = "feature:index";

export async function addFeature(detail: FeatureDetail): Promise<void> {
    await client.set(
        `${FEAT_PREFIX}${detail.featureName}`,
        JSON.stringify(detail)
    );
    await client.sAdd(FEAT_INDEX, detail.featureName);
}

export async function getFeatureDetail(
    name: string
): Promise<FeatureDetail | null> {
    const raw = await client.get(`${FEAT_PREFIX}${name}`);
    return raw ? JSON.parse(raw) : null;
}

export async function getAllFeatures(): Promise<FeatureDetail[]> {
    const names = await client.sMembers(FEAT_INDEX);
    const features: FeatureDetail[] = [];
    for (const n of names) {
        const raw = await client.get(`${FEAT_PREFIX}${n}`);
        if (raw) features.push(JSON.parse(raw));
    }
    return features;
}

export async function clearFeatures(): Promise<void> {
    const names = await client.sMembers(FEAT_INDEX);
    for (const n of names) {
        await client.del(`${FEAT_PREFIX}${n}`);
    }
    await client.del(FEAT_INDEX);
}

// Seed defaults

export async function seedDefaults(): Promise<void> {
    const existing = await client.sMembers(KB_INDEX);
    if (existing.length > 0) {
        console.log("✓ KB already populated, skipping seed");
        return;
    }

    await addKBEntries([
        { type: "info", desc: "Cabswale is a driver and user matching system" },
        { type: "info", desc: "Users can book outstation trips" },
        { type: "info", desc: "Drivers can set availability and preferred routes" },
        {
            type: "feature",
            desc: "Verify aadhaar card via aadhaar number",
            featureName: "aadhar_verification",
            tools: ["sendAadharOtpTool", "verifyAadharOtpTool"],
        },
        {
            type: "feature",
            desc: "Book an outstation cab trip",
            featureName: "book_trip",
            tools: ["searchCabsTool"],
        },
    ]);

    await addFeature({
        featureName: "aadhar_verification",
        desc: "Verify aadhaar card via aadhaar number",
        prompt: `You are now handling Aadhaar verification.
Tools: sendAadharOtpTool, verifyAadharOtpTool.

RULES:
- You MUST call verifyAadharOtpTool to verify OTP. Never judge OTP yourself.
- You do NOT know the correct OTP. Only verifyAadharOtpTool can check.

FLOW:
1. If user already provided Aadhaar number, proceed. Otherwise ask for 12-digit Aadhaar number.
2. Call sendAadharOtpTool with the aadhaar number.
3. Tell user OTP was sent, ask them to provide it.
4. When user gives OTP, IMMEDIATELY call verifyAadharOtpTool with the OTP.
5. Report result based on tool response.`,
        tools: ["sendAadharOtpTool", "verifyAadharOtpTool"],
    });

    await addFeature({
        featureName: "book_trip",
        desc: "Book an outstation cab trip",
        prompt: `You are now handling cab booking.
Tools: searchCabsTool.

FLOW:
1. Ask for pickup location, destination, and optionally date/time.
2. Call searchCabsTool with the details.
3. Present available options to the user.`,
        tools: ["searchCabsTool"],
    });

    console.log("✓ Default KB + features seeded");
}
