import type { Session } from "../types";
import { getDB } from "./client";

const COLLECTION = "usersSession";
const SEARCH_COLLECTION = "raahiSearch";
const DEBOUNCE_MS = 5_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Session>();

export function scheduleFirestoreSync(session: Session): void {
    const id = session.id;
    pending.set(id, structuredClone(session));

    const existing = timers.get(id);
    if (existing) clearTimeout(existing);

    timers.set(
        id,
        setTimeout(() => {
            timers.delete(id);
            const snap = pending.get(id);
            pending.delete(id);
            if (snap) writeToFirestore(snap).catch((e) => console.error(`[Firestore] sync failed for ${id}:`, e.message));
        }, DEBOUNCE_MS),
    );
}

export async function flushSession(sessionId: string): Promise<void> {
    const timer = timers.get(sessionId);
    if (timer) { clearTimeout(timer); timers.delete(sessionId); }
    const snap = pending.get(sessionId);
    pending.delete(sessionId);
    if (snap) await writeToFirestore(snap);
}

export async function loadSessionFromFirestore(sessionId: string): Promise<Session | null> {
    try {
        const doc = await getDB().collection(COLLECTION).doc(sessionId).get();
        if (!doc.exists) return null;
        const data = doc.data();
        if (!data?.session) return null;
        console.log(`[Firestore] restored session ${sessionId}`);
        return data.session as Session;
    } catch (e: unknown) {
        console.error(`[Firestore] load failed for ${sessionId}:`, (e as Error).message);
        return null;
    }
}

async function writeToFirestore(session: Session): Promise<void> {
    await getDB().collection(COLLECTION).doc(session.id).set(
        { session, sessionId: session.id, updatedAt: session.updatedAt },
        { merge: true },
    );
    console.log(`[Firestore] synced session ${session.id}`);
}

export async function logSearchToFirestore(opts: {
    driverId: string;
    pickupCity?: string;
    dropCity?: string;
    usedGeo: boolean;
    tripsCount: number;
    leadsCount: number;
}): Promise<void> {
    try {
        await getDB()
            .collection("drivers")
            .doc(opts.driverId)
            .collection(SEARCH_COLLECTION)
            .add({
                pickup_city: opts.pickupCity ?? "ALL",
                drop_city: opts.dropCity ?? "N/A",
                used_geo: opts.usedGeo,
                trips_count: opts.tripsCount,
                leads_count: opts.leadsCount,
                timestamp: new Date(),
            });
    } catch (e: unknown) {
        console.error("[Firestore] search log failed:", (e as Error).message);
    }
}
