import {
    createClient,
    type RedisClientType,
} from "redis";
import type { Session, KBEntry, FeatureDetail } from "./types";
import { embed, VECTOR_DIM } from "./embeddings";

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

//  KNOWLEDGE BASE — Redis Hash + RediSearch Vector Index
//
//  Each KB entry is a Redis Hash at key  kb:entry:<id>
//  Fields: type, desc, featureName, tools (JSON), embedding (VECTOR)
//
//  RediSearch index "idx:kb" enables KNN vector similarity search.

const KB_PREFIX = "kb:entry:";
const KB_INDEX_NAME = "idx:kb";

/**
 * Create the RediSearch index for KB entries.
 * Safe to call multiple times — skips if index already exists.
 */
export async function ensureKBIndex(): Promise<void> {
    try {
        await client.ft.info(KB_INDEX_NAME);
        // Index exists, nothing to do
    } catch {
        // Index doesn't exist, create it
        await client.ft.create(
            KB_INDEX_NAME,
            {
                type: { type: "TAG" as const },
                desc: { type: "TEXT" as const },
                featureName: { type: "TAG" as const },
                embedding: {
                    type: "VECTOR" as const,
                    ALGORITHM: "HNSW" as const,
                    TYPE: "FLOAT32",
                    DIM: VECTOR_DIM,
                    DISTANCE_METRIC: "COSINE",
                },
            },
            { ON: "HASH", PREFIX: KB_PREFIX }
        );
        console.log("✓ RediSearch index created: " + KB_INDEX_NAME);
    }
}

function makeKBId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a KBEntry to flat hash fields for Redis. */
function kbToHash(
    entry: KBEntry,
    embeddingBuf: Buffer
): Record<string, string | Buffer> {
    const fields: Record<string, string | Buffer> = {
        type: entry.type,
        desc: entry.desc,
        embedding: embeddingBuf,
    };
    if (entry.type === "feature") {
        fields["featureName"] = entry.featureName;
        fields["tools"] = JSON.stringify(entry.tools);
    }
    return fields;
}

/** Reconstruct KBEntry from Redis hash fields. */
function hashToKB(fields: Record<string, string>): KBEntry {
    if (fields["type"] === "feature") {
        return {
            type: "feature",
            desc: fields["desc"] ?? "",
            featureName: fields["featureName"] ?? "",
            tools: JSON.parse(fields["tools"] ?? "[]"),
        };
    }
    return { type: "info", desc: fields["desc"] ?? "" };
}

//  KB CRUD

export async function addKBEntry(entry: KBEntry): Promise<string> {
    const id = makeKBId();
    const textToEmbed =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const embeddingBuf = await embed(textToEmbed);
    const fields = kbToHash(entry, embeddingBuf);
    await client.hSet(`${KB_PREFIX}${id}`, fields);
    return id;
}

export async function addKBEntries(entries: KBEntry[]): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of entries) {
        ids.push(await addKBEntry(entry));
    }
    return ids;
}

export async function getKBEntry(id: string): Promise<KBEntry | null> {
    const raw = await client.hGetAll(`${KB_PREFIX}${id}`);
    if (!raw || !raw["type"]) return null;
    return hashToKB(raw);
}

export async function updateKBEntry(
    id: string,
    entry: KBEntry
): Promise<boolean> {
    const exists = await client.exists(`${KB_PREFIX}${id}`);
    if (!exists) return false;
    const textToEmbed =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const embeddingBuf = await embed(textToEmbed);

    // Delete old hash and write new one (clean replace)
    await client.del(`${KB_PREFIX}${id}`);
    await client.hSet(`${KB_PREFIX}${id}`, kbToHash(entry, embeddingBuf));
    return true;
}

export async function deleteKBEntry(id: string): Promise<boolean> {
    const removed = await client.del(`${KB_PREFIX}${id}`);
    return removed > 0;
}

export async function getAllKBEntries(): Promise<
    Array<KBEntry & { id: string }>
> {
    const results: Array<KBEntry & { id: string }> = [];
    for await (const keys of client.scanIterator({ MATCH: `${KB_PREFIX}*` })) {
        const batch = Array.isArray(keys) ? keys : [keys];
        for (const key of batch) {
            const fields = await client.hGetAll(key as string);
            if (fields["type"]) {
                const id = (key as string).replace(KB_PREFIX, "");
                results.push({ ...hashToKB(fields), id });
            }
        }
    }
    return results;
}

export async function clearKB(): Promise<void> {
    for await (const keys of client.scanIterator({ MATCH: `${KB_PREFIX}*` })) {
        const batch = Array.isArray(keys) ? keys : [keys];
        for (const key of batch) {
            await client.del(key as string);
        }
    }
}

//  KB Vector Search

export async function searchKnowledgeBase(
    query: string,
    topK = 5
): Promise<KBEntry[]> {
    const queryBuf = await embed(query);

    const results = await client.ft.search(
        KB_INDEX_NAME,
        `*=>[KNN ${topK} @embedding $BLOB AS score]`,
        {
            PARAMS: { BLOB: queryBuf },
            SORTBY: { BY: "score", DIRECTION: "ASC" },
            DIALECT: 2,
            RETURN: ["type", "desc", "featureName", "tools", "score"],
        }
    );

    if (!results.total) return [];

    return results.documents
        .filter((doc) => {
            // Filter out low-relevance results (cosine distance > 0.5)
            const score = parseFloat((doc.value["score"] as string) ?? "1");
            return score < 0.5;
        })
        .map((doc) => {
            const v = doc.value as Record<string, string>;
            return hashToKB(v);
        });
}

//  FEATURES — simple key-value (no vector search needed)

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

export async function updateFeature(detail: FeatureDetail): Promise<boolean> {
    const exists = await client.exists(`${FEAT_PREFIX}${detail.featureName}`);
    if (!exists) return false;
    await client.set(
        `${FEAT_PREFIX}${detail.featureName}`,
        JSON.stringify(detail)
    );
    return true;
}

export async function deleteFeature(name: string): Promise<boolean> {
    const removed = await client.del(`${FEAT_PREFIX}${name}`);
    if (removed > 0) {
        await client.sRem(FEAT_INDEX, name);
        return true;
    }
    return false;
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

/**
 * Cleans up stale keys from previous versions that used a different
 * storage format (plain strings instead of hashes). Without this,
 * Redis throws WRONGTYPE errors when we try hSet on old string keys.
 */
async function cleanStaleKeys(): Promise<void> {
    const prefixes = [KB_PREFIX, "kb:index"];
    for (const pattern of prefixes) {
        for await (const keys of client.scanIterator({
            MATCH: pattern.endsWith("*") ? pattern : `${pattern}*`,
        })) {
            const batch = Array.isArray(keys) ? keys : [keys];
            for (const key of batch) {
                const keyType = await client.type(key as string);
                // If it's a leftover string key where we now expect a hash, delete it
                if (keyType === "string" && (key as string).startsWith(KB_PREFIX)) {
                    await client.del(key as string);
                }
                // Also clean up the old kb:index set if it exists
                if ((key as string) === "kb:index") {
                    await client.del(key as string);
                }
            }
        }
    }
}

export async function seedDefaults(): Promise<void> {
    await ensureKBIndex();
    await cleanStaleKeys();

    const existing = await getAllKBEntries();
    if (existing.length > 0) {
        console.log(`✓ KB has ${existing.length} entries, skipping seed`);
        return;
    }

    console.log("⏳ Seeding KB + features (generating embeddings)...");

    await addKBEntries([
        { type: "info", desc: "Cabswale is a driver and user matching system" },
        { type: "info", desc: "Users can book outstation trips" },
        {
            type: "info",
            desc: "Drivers can set availability and preferred routes",
        },
        {
            type: "feature",
            desc: "Verify aadhaar card via aadhaar number for identity verification",
            featureName: "aadhar_verification",
            tools: ["sendAadharOtpTool", "verifyAadharOtpTool"],
        },
        {
            type: "feature",
            desc: "Book an outstation cab trip with pickup drop and dates",
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

    console.log("✓ Default KB + features seeded with embeddings");
}
