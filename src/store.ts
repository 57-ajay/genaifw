import { createClient, type RedisClientType } from "redis";
import type {
    Session,
    KBEntry,
    FeatureDetail,
    UserData,
    DriverProfile,
    Location,
} from "./types";
import { embed, VECTOR_DIM } from "./embeddings";
import { scheduleFirestoreSync, loadSessionFromFirestore } from "./firebase";
import {
    saveFeatureToFirestore,
    deleteFeatureFromFirestore,
    loadAllFeaturesFromFirestore,
    clearFeaturesFromFirestore,
    saveKBEntryToFirestore,
    deleteKBEntryFromFirestore,
    loadAllKBFromFirestore,
} from "./firebase";
import { rebuildRegistry, getRegistry } from "./registry";
import { getBaseAudioMap } from "./services/audio-config";

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

//  Sessions
const SESSION_TTL = 60 * 5;
const sessionKey = (id: string) => `session:${id}`;

export async function getSession(id: string): Promise<Session | null> {
    const raw = await client.get(sessionKey(id));
    if (raw) return JSON.parse(raw);
    const restored = await loadSessionFromFirestore(id);
    if (restored)
        await client.set(sessionKey(id), JSON.stringify(restored), {
            EX: SESSION_TTL,
        });
    return restored;
}

export async function saveSession(session: Session): Promise<void> {
    session.updatedAt = Date.now();
    await client.set(sessionKey(session.id), JSON.stringify(session), {
        EX: SESSION_TTL,
    });
    scheduleFirestoreSync(session);
}

export async function deleteSession(id: string): Promise<void> {
    await client.del(sessionKey(id));
}

export function newSession(
    id: string,
    baseTools: string[],
    userData?: UserData | null,
    driverProfile?: DriverProfile | null,
    location?: Location | null,
): Session {
    return {
        id,
        history: [],
        activeTools: [...baseTools],
        activeFeature: null,
        userData: userData ?? null,
        driverProfile: driverProfile ?? null,
        currentLocation: location ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

//  Knowledge Base
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
            { ON: "HASH", PREFIX: KB_PREFIX },
        );
        console.log("RediSearch index created: " + KB_INDEX_NAME);
    }
}

function makeKBId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function kbToHash(
    entry: KBEntry,
    embeddingBuf: Buffer,
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
    const text =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const buf = await embed(text);
    await client.hSet(`${KB_PREFIX}${id}`, kbToHash(entry, buf));
    saveKBEntryToFirestore(id, entry).catch(() => {});
    return id;
}

export async function addKBEntries(entries: KBEntry[]): Promise<string[]> {
    const ids: string[] = [];
    for (const e of entries) ids.push(await addKBEntry(e));
    return ids;
}

export async function getKBEntry(id: string): Promise<KBEntry | null> {
    const raw = await client.hGetAll(`${KB_PREFIX}${id}`);
    if (!raw?.["type"]) return null;
    return hashToKB(raw);
}

export async function updateKBEntry(
    id: string,
    entry: KBEntry,
): Promise<boolean> {
    if (!(await client.exists(`${KB_PREFIX}${id}`))) return false;
    const text =
        entry.type === "feature"
            ? `${entry.desc} ${entry.featureName}`
            : entry.desc;
    const buf = await embed(text);
    await client.del(`${KB_PREFIX}${id}`);
    await client.hSet(`${KB_PREFIX}${id}`, kbToHash(entry, buf));
    saveKBEntryToFirestore(id, entry).catch(() => {});
    return true;
}

export async function deleteKBEntry(id: string): Promise<boolean> {
    const removed = (await client.del(`${KB_PREFIX}${id}`)) > 0;
    if (removed) deleteKBEntryFromFirestore(id).catch(() => {});
    return removed;
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
                results.push({
                    ...hashToKB(fields),
                    id: (key as string).replace(KB_PREFIX, ""),
                });
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

export async function searchKnowledgeBase(
    query: string,
    topK = 5,
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
        },
    );
    if (!results.total) return [];
    return results.documents
        .filter(
            (doc) => parseFloat((doc.value["score"] as string) ?? "1") < 0.5,
        )
        .map((doc) => hashToKB(doc.value as Record<string, string>));
}

//  Features
const FEAT_PREFIX = "feature:";
const FEAT_INDEX = "feature:index";

export async function addFeature(
    detail: FeatureDetail,
    skipRefresh = false,
): Promise<void> {
    await client.set(
        `${FEAT_PREFIX}${detail.featureName}`,
        JSON.stringify(detail),
    );
    await client.sAdd(FEAT_INDEX, detail.featureName);
    saveFeatureToFirestore(detail).catch(() => {});
    if (!skipRefresh) await refreshRegistry();
}

export async function getFeatureDetail(
    name: string,
): Promise<FeatureDetail | null> {
    const raw = await client.get(`${FEAT_PREFIX}${name}`);
    if (raw) return JSON.parse(raw);

    try {
        const features = await loadAllFeaturesFromFirestore();
        const found = features.find((f) => f.featureName === name);
        if (found) {
            await client.set(`${FEAT_PREFIX}${name}`, JSON.stringify(found));
            await client.sAdd(FEAT_INDEX, name);
            return found;
        }
    } catch {}

    return null;
}

export async function updateFeature(detail: FeatureDetail): Promise<boolean> {
    if (!(await client.exists(`${FEAT_PREFIX}${detail.featureName}`)))
        return false;
    await client.set(
        `${FEAT_PREFIX}${detail.featureName}`,
        JSON.stringify(detail),
    );
    saveFeatureToFirestore(detail).catch(() => {});
    await refreshRegistry();
    return true;
}

export async function deleteFeature(name: string): Promise<boolean> {
    const removed = await client.del(`${FEAT_PREFIX}${name}`);
    if (removed > 0) {
        await client.sRem(FEAT_INDEX, name);
        deleteFeatureFromFirestore(name).catch(() => {});
        await refreshRegistry();
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
    clearFeaturesFromFirestore().catch(() => {});
    await refreshRegistry();
}

//  Registry Rebuild

export async function refreshRegistry(): Promise<void> {
    const features = await getAllFeatures();
    const baseAudio = getBaseAudioMap();
    rebuildRegistry(features, baseAudio);
    const merged: Record<string, string | null> = {};
    for (const [k, v] of getRegistry().audioMap) merged[k] = v;
    await syncAudioUrls(merged);
}

//  Audio URL Redis Sync

const AUDIO_URL_HASH = "audio:urls";

export async function syncAudioUrls(
    urlMap: Record<string, string | null>,
): Promise<void> {
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(urlMap)) {
        if (v) entries[k] = v;
    }
    if (Object.keys(entries).length === 0) return;
    await client.hSet(AUDIO_URL_HASH, entries);
}

export async function getAudioUrlFromRedis(key: string): Promise<string | null> {
    return (await client.hGet(AUDIO_URL_HASH, key)) ?? null;
}

//  Cold Start Recovery
async function recoverFromFirestore(): Promise<void> {
    console.log("[Recovery] Checking Firestore for features...");
    const features = await loadAllFeaturesFromFirestore();
    if (features.length) {
        for (const f of features) {
            await client.set(
                `${FEAT_PREFIX}${f.featureName}`,
                JSON.stringify(f),
            );
            await client.sAdd(FEAT_INDEX, f.featureName);
        }
        console.log(
            `[Recovery] restored ${features.length} features from Firestore`,
        );
    }

    const kbEntries = await getAllKBEntries();
    if (kbEntries.length === 0) {
        console.log("[Recovery] Checking Firestore for KB entries...");
        const firestoreKB = await loadAllKBFromFirestore();
        if (firestoreKB.length) {
            for (const entry of firestoreKB) {
                const { id: _, ...kbEntry } = entry;
                const text =
                    kbEntry.type === "feature"
                        ? `${kbEntry.desc} ${kbEntry.featureName}`
                        : kbEntry.desc;
                const buf = await embed(text);
                await client.hSet(
                    `${KB_PREFIX}${entry.id}`,
                    kbToHash(kbEntry, buf),
                );
            }
            console.log(
                `[Recovery] re-embedded ${firestoreKB.length} KB entries from Firestore`,
            );
        }
    }
}

//  Seed
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
    try {
        await client.del("kb:index");
    } catch {}
}

export async function seedDefaults(): Promise<void> {
    await ensureKBIndex();
    await cleanStaleKeys();

    const existingFeatures = await getAllFeatures();
    if (existingFeatures.length === 0) {
        await recoverFromFirestore();
    }

    const existingKB = await getAllKBEntries();
    if (existingKB.length > 0) {
        console.log(`KB has ${existingKB.length} entries, skipping seed`);
        await refreshRegistry();
        return;
    }

    console.log("Seeding KB + features...");

    // KB Info Entries
    await addKBEntries([
        {
            type: "info",
            desc: "CabsWale is a travel platform where users book outstation trips by choosing drivers directly",
        },
        {
            type: "info",
            desc: "Joining CabsWale is free. Profile creation has no cost",
        },
        {
            type: "info",
            desc: "Customers pay driver directly via cash or UPI. CabsWale takes no commission from trip fare",
        },
        {
            type: "info",
            desc: "Verification requires RC Registration Certificate, Driving License DL, and Aadhaar Card",
        },
        {
            type: "info",
            desc: "Verification is mandatory to get duties. No duties without verification for safety and trust",
        },
        {
            type: "info",
            desc: "Drivers can add multiple vehicles to their profile",
        },
        {
            type: "info",
            desc: "Wallet recharge is required to access premium features or view contact details",
        },
        {
            type: "info",
            desc: "Premium drivers get a Premium Badge, higher priority in search, and exclusive high-value duties",
        },
        {
            type: "info",
            desc: "Raahi is an AI assistant that helps drivers find duties, nearby services, and CabsWale information",
        },
    ]);

    // KB Feature Entries
    await addKBEntries([
        {
            type: "feature",
            desc: "Find duties trips transport between cities route booking",
            featureName: "find_duties",
            tools: [],
        },
        {
            type: "feature",
            desc: "CNG pump gas station nearby CNG kahan hai",
            featureName: "nearby_cng",
            tools: [],
        },
        {
            type: "feature",
            desc: "Petrol pump fuel station nearby",
            featureName: "nearby_petrol",
            tools: [],
        },
        {
            type: "feature",
            desc: "Parking space gaadi park truck parking",
            featureName: "nearby_parking",
            tools: [],
        },
        {
            type: "feature",
            desc: "Nearby drivers dusre driver paas mein",
            featureName: "nearby_drivers",
            tools: [],
        },
        {
            type: "feature",
            desc: "Towing service tow truck breakdown",
            featureName: "nearby_towing",
            tools: [],
        },
        {
            type: "feature",
            desc: "Toilet restroom washroom bathroom",
            featureName: "nearby_toilets",
            tools: [],
        },
        {
            type: "feature",
            desc: "Taxi stand cab stand auto stand",
            featureName: "nearby_taxi_stands",
            tools: [],
        },
        {
            type: "feature",
            desc: "Auto parts spare parts dukaan shop",
            featureName: "nearby_auto_parts",
            tools: [],
        },
        {
            type: "feature",
            desc: "Car repair mechanic gaadi repair workshop",
            featureName: "nearby_car_repair",
            tools: [],
        },
        {
            type: "feature",
            desc: "Hospital emergency medical clinic",
            featureName: "nearby_hospital",
            tools: [],
        },
        {
            type: "feature",
            desc: "Police station thana police help",
            featureName: "nearby_police",
            tools: [],
        },
        {
            type: "feature",
            desc: "Fraud check scam warning dhoka",
            featureName: "check_fraud",
            tools: [],
        },
        {
            type: "feature",
            desc: "Advance payment commission dena",
            featureName: "advance_payment",
            tools: [],
        },
        {
            type: "feature",
            desc: "Border tax information toll naka",
            featureName: "border_tax",
            tools: [],
        },
        {
            type: "feature",
            desc: "State tax information rajya kar",
            featureName: "state_tax",
            tools: [],
        },
        {
            type: "feature",
            desc: "PUC pollution under control certificate",
            featureName: "puc_info",
            tools: [],
        },
        {
            type: "feature",
            desc: "AITP All India Tourist Permit",
            featureName: "aitp_info",
            tools: [],
        },
        {
            type: "feature",
            desc: "Goodbye thanks bye end conversation shukriya dhanyavaad",
            featureName: "end_conversation",
            tools: [],
        },
        {
            type: "feature",
            desc: "Verify aadhaar card identity verification aadhaar number",
            featureName: "aadhaar_verification",
            tools: ["sendAadharOtpTool", "verifyAadharOtpTool"],
        },
        {
            type: "feature",
            desc: "Book outstation cab trip booking ride",
            featureName: "book_trip",
            tools: ["searchCabsTool"],
        },
    ]);

    // Feature Details

    const simple = (
        name: string,
        desc: string,
        uiAction: string,
        intent: string,
        hint: string,
    ): FeatureDetail => ({
        featureName: name,
        desc,
        prompt: `User wants ${desc}. Respond in Hinglish: "${hint}" or similar.`,
        tools: [],
        actions: [{ uiAction, intent }],
        defaultAction: uiAction,
        dataSchema: { type: "OBJECT", properties: {} },
    });

    const simpleFeatures = [
        simple(
            "nearby_cng",
            "nearby CNG stations",
            "show_cng_stations",
            "cng_pumps",
            "Aapke paas CNG stations dhund rahi hoon",
        ),
        simple(
            "nearby_petrol",
            "nearby petrol pumps",
            "show_petrol_stations",
            "petrol_pumps",
            "Petrol pumps locate kar rahi hoon",
        ),
        simple(
            "nearby_parking",
            "nearby parking",
            "show_parking",
            "parking",
            "Parking spots dhund rahi hoon",
        ),
        simple(
            "nearby_drivers",
            "nearby drivers",
            "show_nearby_drivers",
            "nearby_drivers",
            "Aas-paas ke drivers search kar rahi hoon",
        ),
        simple(
            "nearby_towing",
            "towing services",
            "show_towing",
            "towing",
            "Towing services locate kar rahi hoon",
        ),
        simple(
            "nearby_toilets",
            "nearby toilets restrooms",
            "show_toilets",
            "toilets",
            "Toilets dhund rahi hoon",
        ),
        simple(
            "nearby_taxi_stands",
            "nearby taxi stands",
            "show_taxi_stands",
            "taxi_stands",
            "Taxi stands show kar rahi hoon",
        ),
        simple(
            "nearby_auto_parts",
            "auto parts shops",
            "show_auto_parts",
            "auto_parts",
            "Auto parts shops dhund rahi hoon",
        ),
        simple(
            "nearby_car_repair",
            "car repair shops",
            "show_car_repair",
            "car_repair",
            "Car repair shops locate kar rahi hoon",
        ),
        simple(
            "nearby_hospital",
            "nearby hospitals",
            "show_hospital",
            "hospital",
            "Hospitals search kar rahi hoon",
        ),
        simple(
            "nearby_police",
            "nearby police stations",
            "show_police_station",
            "police_station",
            "Police station show kar rahi hoon",
        ),
        simple(
            "advance_payment",
            "advance or commission payment",
            "show_advance",
            "advance",
            "Advance payment ka option open kar rahi hoon",
        ),
        simple(
            "border_tax",
            "border tax information",
            "show_border_tax",
            "border_tax",
            "Border tax ki jaankari show kar rahi hoon",
        ),
        simple(
            "state_tax",
            "state tax information",
            "show_state_tax",
            "state_tax",
            "State tax ki jaankari show kar rahi hoon",
        ),
        simple(
            "puc_info",
            "PUC pollution control",
            "show_puc",
            "puc",
            "PUC ki jaankari show kar rahi hoon",
        ),
        simple(
            "aitp_info",
            "All India Tourist Permit",
            "show_aitp",
            "aitp",
            "AITP ki jaankari show kar rahi hoon",
        ),
        simple(
            "end_conversation",
            "end conversation goodbye",
            "show_end",
            "end",
            "Shukriya! Aapki yatra mangalmay ho",
        ),
    ];

    for (const f of simpleFeatures) await addFeature(f, true);

    await addFeature(
        {
            featureName: "check_fraud",
            desc: "fraud check information",
            prompt: `User wants to check fraud information. Respond in Hinglish: "Fraud information show kar rahi hoon" or similar.`,
            tools: [],
            actions: [
                { uiAction: "show_fraud", intent: "fraud" },
                { uiAction: "show_fraud_result", intent: "fraud_check_found" },
            ],
            defaultAction: "show_fraud",
            postProcessor: "fraud",
            dataSchema: { type: "OBJECT", properties: {} },
        },
        true,
    );

    await addFeature(
        {
            featureName: "find_duties",
            desc: "Find duties/trips between cities",
            prompt: `User wants to find duties/trips. Extract from_city and to_city from their message.
If multiple destination cities mentioned, use ONLY the first one as to_city.
If only one city mentioned, that is from_city (source).`,
            tools: [],
            actions: [{ uiAction: "show_duties_list", intent: "get_duties" }],
            defaultAction: "show_duties_list",
            postProcessor: "duties",
            dataSchema: {
                type: "OBJECT",
                properties: {
                    from_city: {
                        type: "STRING",
                        description: "Source city",
                        nullable: true,
                    },
                    to_city: {
                        type: "STRING",
                        description:
                            "Destination city (first only if multiple)",
                        nullable: true,
                    },
                    trip_type: {
                        type: "STRING",
                        description: "one_way or round_trip",
                        nullable: true,
                    },
                    date: {
                        type: "STRING",
                        description: "Travel date if mentioned",
                        nullable: true,
                    },
                },
            },
        },
        true,
    );

    await addFeature(
        {
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
5. Report result from tool.`,
            tools: [
                {
                    name: "sendAadharOtpTool",
                    declaration: {
                        description:
                            "Send Aadhaar verification OTP to a 12-digit Aadhaar number",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                aadharNumber: {
                                    type: "STRING",
                                    description: "12-digit Aadhaar number",
                                },
                            },
                            required: ["aadharNumber"],
                        },
                    },
                    implementation: {
                        type: "static" as const,
                        response:
                            "OTP sent successfully to the registered mobile number.",
                    },
                },
                {
                    name: "verifyAadharOtpTool",
                    declaration: {
                        description: "Verify Aadhaar using a 4-digit OTP",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                otp: {
                                    type: "STRING",
                                    description: "4-digit OTP",
                                },
                            },
                            required: ["otp"],
                        },
                    },
                    implementation: {
                        type: "builtin" as const,
                        handler: "verifyAadharOtp",
                    },
                },
            ],
            actions: [
                { uiAction: "show_otp_input", intent: "generic" },
                { uiAction: "show_verification_result", intent: "generic" },
            ],
            defaultAction: "show_otp_input",
            dataSchema: {
                type: "OBJECT",
                properties: {
                    step: {
                        type: "STRING",
                        description: "Current step",
                        enum: [
                            "need_aadhaar",
                            "otp_sent",
                            "verified",
                            "failed",
                        ],
                    },
                    masked_phone: {
                        type: "STRING",
                        description: "Masked phone",
                        nullable: true,
                    },
                    verified: {
                        type: "BOOLEAN",
                        description: "Verification passed",
                        nullable: true,
                    },
                },
            },
        },
        true,
    );

    await addFeature(
        {
            featureName: "book_trip",
            desc: "Book outstation cab trip",
            prompt: `User wants to book a cab. Extract pickup and destination. Call searchCabsTool.`,
            tools: [
                {
                    name: "searchCabsTool",
                    declaration: {
                        description:
                            "Search available cabs for outstation trip",
                        parameters: {
                            type: "OBJECT",
                            properties: {
                                pickup: {
                                    type: "STRING",
                                    description: "Pickup location",
                                },
                                destination: {
                                    type: "STRING",
                                    description: "Destination",
                                },
                                date: {
                                    type: "STRING",
                                    description: "Travel date (optional)",
                                },
                            },
                            required: ["pickup", "destination"],
                        },
                    },
                    implementation: {
                        type: "builtin" as const,
                        handler: "searchCabs",
                    },
                },
            ],
            actions: [{ uiAction: "show_duties_list", intent: "get_duties" }],
            defaultAction: "show_duties_list",
            dataSchema: { type: "OBJECT", properties: {} },
        },
        true,
    );

    console.log("KB + features seeded");
    await refreshRegistry();
}
