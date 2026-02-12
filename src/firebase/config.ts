import type { FeatureDetail, KBEntry } from "../types";
import { getDB } from "./client";

const FEATURES_COLLECTION = "raahiConfig";
const FEATURES_DOC_PREFIX = "feature:";
const KB_COLLECTION = "raahiKB";


export async function saveFeatureToFirestore(detail: FeatureDetail): Promise<void> {
    try {
        await getDB()
            .collection(FEATURES_COLLECTION)
            .doc(`${FEATURES_DOC_PREFIX}${detail.featureName}`)
            .set(detail, { merge: true });
    } catch (e: unknown) {
        console.error(`[Firestore] feature save failed for ${detail.featureName}:`, (e as Error).message);
    }
}

export async function deleteFeatureFromFirestore(featureName: string): Promise<void> {
    try {
        await getDB()
            .collection(FEATURES_COLLECTION)
            .doc(`${FEATURES_DOC_PREFIX}${featureName}`)
            .delete();
    } catch (e: unknown) {
        console.error(`[Firestore] feature delete failed for ${featureName}:`, (e as Error).message);
    }
}

export async function loadAllFeaturesFromFirestore(): Promise<FeatureDetail[]> {
    try {
        const snap = await getDB()
            .collection(FEATURES_COLLECTION)
            .where("featureName", "!=", "")
            .get();

        if (snap.empty) return [];

        const features: FeatureDetail[] = [];
        for (const doc of snap.docs) {
            const data = doc.data() as FeatureDetail;
            if (data.featureName && data.prompt) features.push(data);
        }
        console.log(`[Firestore] restored ${features.length} features`);
        return features;
    } catch (e: unknown) {
        console.error("[Firestore] features load failed:", (e as Error).message);
        return [];
    }
}

export async function clearFeaturesFromFirestore(): Promise<void> {
    try {
        const snap = await getDB().collection(FEATURES_COLLECTION).get();
        const batch = getDB().batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
    } catch (e: unknown) {
        console.error("[Firestore] features clear failed:", (e as Error).message);
    }
}


export async function saveKBEntryToFirestore(id: string, entry: KBEntry): Promise<void> {
    try {
        await getDB()
            .collection(KB_COLLECTION)
            .doc(id)
            .set({ ...entry, updatedAt: new Date() }, { merge: true });
    } catch (e: unknown) {
        console.error(`[Firestore] KB save failed for ${id}:`, (e as Error).message);
    }
}

export async function deleteKBEntryFromFirestore(id: string): Promise<void> {
    try {
        await getDB().collection(KB_COLLECTION).doc(id).delete();
    } catch (e: unknown) {
        console.error(`[Firestore] KB delete failed for ${id}:`, (e as Error).message);
    }
}

export async function loadAllKBFromFirestore(): Promise<Array<KBEntry & { id: string }>> {
    try {
        const snap = await getDB().collection(KB_COLLECTION).get();
        if (snap.empty) return [];

        const entries: Array<KBEntry & { id: string }> = [];
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data["type"] && data["desc"]) {
                if (data["type"] === "feature") {
                    entries.push({
                        id: doc.id,
                        type: "feature",
                        desc: data["desc"] as string,
                        featureName: data["featureName"] as string,
                        tools: (data["tools"] as string[]) ?? [],
                    });
                } else {
                    entries.push({ id: doc.id, type: "info", desc: data["desc"] as string });
                }
            }
        }
        console.log(`[Firestore] restored ${entries.length} KB entries`);
        return entries;
    } catch (e: unknown) {
        console.error("[Firestore] KB load failed:", (e as Error).message);
        return [];
    }
}

export async function clearKBFromFirestore(): Promise<void> {
    try {
        const snap = await getDB().collection(KB_COLLECTION).get();
        const batch = getDB().batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
    } catch (e: unknown) {
        console.error("[Firestore] KB clear failed:", (e as Error).message);
    }
}
