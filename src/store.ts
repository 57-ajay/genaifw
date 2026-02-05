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


const SESSION_TTL = 60 * 5;
const sessionKey = (id: string) => `session:${id}`;

export async function getSession(id: string): Promise<Session | null> {
    const raw = await client.get(sessionKey(id));
    return raw ? JSON.parse(raw) : null;
}

export async function saveSession(session: Session): Promise<void> {
    session.updatedAt = Date.now();
    await client.set(sessionKey(session.id), JSON.stringify(session), { EX: SESSION_TTL });
}

export async function deleteSession(id: string): Promise<void> {
    await client.del(sessionKey(id));
}

export function newSession(id: string, baseTools: string[]): Session {
    return {
        id,
        history: [],
        activeTools: [...baseTools],
        matchedAction: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}


const KB_PREFIX = "kb:entry:";
const KB_INDEX_NAME = "idx:kb";

export async function ensureKBIndex(): Promise<void> {
    try {
        await client.ft.info(KB_INDEX_NAME);
    } catch {
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
        console.log("RediSearch index created: " + KB_INDEX_NAME);
    }
}

function makeKBId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function kbToHash(entry: KBEntry, embeddingBuf: Buffer): Record<string, string | Buffer> {
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


export async function addKBEntry(entry: KBEntry): Promise<string> {
    const id = makeKBId();
    const textToEmbed =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const embeddingBuf = await embed(textToEmbed);
    await client.hSet(`${KB_PREFIX}${id}`, kbToHash(entry, embeddingBuf));
    return id;
}

export async function addKBEntries(entries: KBEntry[]): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of entries) ids.push(await addKBEntry(entry));
    return ids;
}

export async function getKBEntry(id: string): Promise<KBEntry | null> {
    const raw = await client.hGetAll(`${KB_PREFIX}${id}`);
    if (!raw || !raw["type"]) return null;
    return hashToKB(raw);
}

export async function updateKBEntry(id: string, entry: KBEntry): Promise<boolean> {
    const exists = await client.exists(`${KB_PREFIX}${id}`);
    if (!exists) return false;
    const textToEmbed =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const embeddingBuf = await embed(textToEmbed);
    await client.del(`${KB_PREFIX}${id}`);
    await client.hSet(`${KB_PREFIX}${id}`, kbToHash(entry, embeddingBuf));
    return true;
}

export async function deleteKBEntry(id: string): Promise<boolean> {
    return (await client.del(`${KB_PREFIX}${id}`)) > 0;
}

export async function getAllKBEntries(): Promise<Array<KBEntry & { id: string }>> {
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
        for (const key of batch) await client.del(key as string);
    }
}


export async function searchKnowledgeBase(query: string, topK = 5): Promise<KBEntry[]> {
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
            const score = parseFloat((doc.value["score"] as string) ?? "1");
            return score < 0.5;
        })
        .map((doc) => hashToKB(doc.value as Record<string, string>));
}


const FEAT_PREFIX = "feature:";
const FEAT_INDEX = "feature:index";

export async function addFeature(detail: FeatureDetail): Promise<void> {
    await client.set(`${FEAT_PREFIX}${detail.featureName}`, JSON.stringify(detail));
    await client.sAdd(FEAT_INDEX, detail.featureName);
}

export async function getFeatureDetail(name: string): Promise<FeatureDetail | null> {
    const raw = await client.get(`${FEAT_PREFIX}${name}`);
    return raw ? JSON.parse(raw) : null;
}

export async function updateFeature(detail: FeatureDetail): Promise<boolean> {
    const exists = await client.exists(`${FEAT_PREFIX}${detail.featureName}`);
    if (!exists) return false;
    await client.set(`${FEAT_PREFIX}${detail.featureName}`, JSON.stringify(detail));
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
    for (const n of names) await client.del(`${FEAT_PREFIX}${n}`);
    await client.del(FEAT_INDEX);
}


async function cleanStaleKeys(): Promise<void> {
    for await (const keys of client.scanIterator({ MATCH: `${KB_PREFIX}*` })) {
        const batch = Array.isArray(keys) ? keys : [keys];
        for (const key of batch) {
            const keyType = await client.type(key as string);
            if (keyType === "string" && (key as string).startsWith(KB_PREFIX)) {
                await client.del(key as string);
            }
        }
    }
    try { await client.del("kb:index"); } catch { }
}

export async function seedDefaults(): Promise<void> {
    await ensureKBIndex();
    await cleanStaleKeys();

    const existing = await getAllKBEntries();
    if (existing.length > 0) {
        console.log(`KB has ${existing.length} entries, skipping seed`);
        return;
    }

    console.log("⏳ Seeding KB + features...");

    await addKBEntries([
        { type: "info", desc: "CabsWale is a travel platform where users book outstation trips by choosing drivers directly" },
        { type: "info", desc: "Joining CabsWale is free. Profile creation has no cost" },
        { type: "info", desc: "Customers pay driver directly via cash or UPI. CabsWale takes no commission from trip fare" },
        { type: "info", desc: "Verification requires RC Registration Certificate, Driving License DL, and Aadhaar Card" },
        { type: "info", desc: "Verification is mandatory to get duties. No duties without verification for safety and trust" },
        { type: "info", desc: "Drivers can add multiple vehicles to their profile" },
        { type: "info", desc: "Wallet recharge is required to access premium features or view contact details" },
        { type: "info", desc: "Premium drivers get a Premium Badge, higher priority in search, and exclusive high-value duties" },
        { type: "info", desc: "Raahi is an AI assistant that helps drivers find duties, nearby services, and CabsWale information" },
    ]);

    await addKBEntries([
        { type: "feature", desc: "Find duties trips transport between cities route booking", featureName: "find_duties", tools: [] },
        { type: "feature", desc: "CNG pump gas station nearby CNG kahan hai", featureName: "nearby_cng", tools: [] },
        { type: "feature", desc: "Petrol pump fuel station nearby", featureName: "nearby_petrol", tools: [] },
        { type: "feature", desc: "Parking space gaadi park truck parking", featureName: "nearby_parking", tools: [] },
        { type: "feature", desc: "Nearby drivers dusre driver paas mein", featureName: "nearby_drivers", tools: [] },
        { type: "feature", desc: "Towing service tow truck breakdown", featureName: "nearby_towing", tools: [] },
        { type: "feature", desc: "Toilet restroom washroom bathroom", featureName: "nearby_toilets", tools: [] },
        { type: "feature", desc: "Taxi stand cab stand auto stand", featureName: "nearby_taxi_stands", tools: [] },
        { type: "feature", desc: "Auto parts spare parts dukaan shop", featureName: "nearby_auto_parts", tools: [] },
        { type: "feature", desc: "Car repair mechanic gaadi repair workshop", featureName: "nearby_car_repair", tools: [] },
        { type: "feature", desc: "Hospital emergency medical clinic", featureName: "nearby_hospital", tools: [] },
        { type: "feature", desc: "Police station thana police help", featureName: "nearby_police", tools: [] },
        { type: "feature", desc: "Fraud check scam warning dhoka", featureName: "check_fraud", tools: [] },
        { type: "feature", desc: "Advance payment commission dena", featureName: "advance_payment", tools: [] },
        { type: "feature", desc: "Goodbye thanks bye end conversation shukriya dhanyavaad", featureName: "end_conversation", tools: [] },
        { type: "feature", desc: "Verify aadhaar card identity verification aadhaar number", featureName: "aadhaar_verification", tools: ["sendAadharOtpTool", "verifyAadharOtpTool"] },
        { type: "feature", desc: "Book outstation cab trip booking ride", featureName: "book_trip", tools: ["searchCabsTool"] },
    ]);


    const simpleFeature = (
        featureName: string,
        desc: string,
        actionType: string,
        responseHint: string,
    ): FeatureDetail => ({
        featureName,
        desc,
        prompt: `User wants ${desc}. Respond in Hinglish: "${responseHint}" or similar.`,
        tools: [],
        actionType: actionType as any,
        dataSchema: { type: "OBJECT", properties: {} },
    });

    const simpleFeatures: FeatureDetail[] = [
        simpleFeature("nearby_cng", "nearby CNG stations", "show_cng_stations", "Aapke paas CNG stations dhund rahi hoon"),
        simpleFeature("nearby_petrol", "nearby petrol pumps", "show_petrol_stations", "Petrol pumps locate kar rahi hoon"),
        simpleFeature("nearby_parking", "nearby parking", "show_parking", "Parking spots dhund rahi hoon"),
        simpleFeature("nearby_drivers", "nearby drivers", "show_nearby_drivers", "Aas-paas ke drivers search kar rahi hoon"),
        simpleFeature("nearby_towing", "towing services", "show_towing", "Towing services locate kar rahi hoon"),
        simpleFeature("nearby_toilets", "nearby toilets restrooms", "show_toilets", "Toilets dhund rahi hoon"),
        simpleFeature("nearby_taxi_stands", "nearby taxi stands", "show_taxi_stands", "Taxi stands show kar rahi hoon"),
        simpleFeature("nearby_auto_parts", "auto parts shops", "show_auto_parts", "Auto parts shops dhund rahi hoon"),
        simpleFeature("nearby_car_repair", "car repair shops", "show_car_repair", "Car repair shops locate kar rahi hoon"),
        simpleFeature("nearby_hospital", "nearby hospitals", "show_hospital", "Hospitals search kar rahi hoon"),
        simpleFeature("nearby_police", "nearby police stations", "show_police_station", "Police station show kar rahi hoon"),
        simpleFeature("check_fraud", "fraud check information", "show_fraud", "Fraud information show kar rahi hoon"),
        simpleFeature("advance_payment", "advance or commission payment", "show_advance", "Advance payment ka option open kar rahi hoon"),
        simpleFeature("end_conversation", "end conversation goodbye", "show_end", "Shukriya! Aapki yatra mangalmay ho"),
    ];

    for (const f of simpleFeatures) await addFeature(f);

    await addFeature({
        featureName: "find_duties",
        desc: "Find duties/trips between cities",
        prompt: `User wants to find duties/trips. Extract from_city and to_city from their message.
If multiple destination cities mentioned, use ONLY the first one as to_city.
If only one city mentioned, that is from_city (source).`,
        tools: [],
        actionType: "show_duties_list",
        dataSchema: {
            type: "OBJECT",
            properties: {
                from_city: { type: "STRING", description: "Source city", nullable: true },
                to_city: { type: "STRING", description: "Destination city (first only if multiple)", nullable: true },
                trip_type: { type: "STRING", description: "one_way or round_trip", nullable: true },
                date: { type: "STRING", description: "Travel date if mentioned", nullable: true },
            },
        },
    });

    await addFeature({
        featureName: "aadhaar_verification",
        desc: "Verify aadhaar card via aadhaar number",
        prompt: `Handle Aadhaar verification.
Tools: sendAadharOtpTool, verifyAadharOtpTool.
RULES: You MUST call verifyAadharOtpTool to verify OTP. Never judge OTP yourself.
FLOW:
1. If user provided Aadhaar number, proceed. Otherwise ask for 12-digit number.
2. Call sendAadharOtpTool with the number.
3. Tell user OTP was sent, ask for it.
4. When user gives OTP, call verifyAadharOtpTool.
5. Report result from tool.
Set step field: need_aadhaar → otp_sent → verified/failed.`,
        tools: ["sendAadharOtpTool", "verifyAadharOtpTool"],
        actionType: "show_otp_input",
        dataSchema: {
            type: "OBJECT",
            properties: {
                step: {
                    type: "STRING",
                    description: "Current step in flow",
                    enum: ["need_aadhaar", "otp_sent", "verified", "failed"],
                },
                masked_phone: { type: "STRING", description: "Masked phone number", nullable: true },
                verified: { type: "BOOLEAN", description: "Whether verification passed", nullable: true },
            },
        },
    });

    console.log("KB + features seeded");
}
