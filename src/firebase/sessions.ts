import type { Session } from "../types";
import { getDB } from "./client";

const COLLECTION = "usersSession";
const DEBOUNCE_MS = 5_000;


const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, Session>();

/**
 * Schedule a Firestore write for this session.
 * Fire-and-forget — never blocks the caller.
 * If called multiple times within DEBOUNCE_MS, only the last state is written.
 */
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
            if (snap) {
                writeToFirestore(snap).catch((e) =>
                    console.error(`[Firestore] sync failed for ${id}:`, e.message),
                );
            }
        }, DEBOUNCE_MS),
    );
}

/**
 * Force-flush a session to Firestore immediately (e.g. on disconnect).
 * Still async, but skips the debounce.
 */
export async function flushSession(sessionId: string): Promise<void> {
    const timer = timers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        timers.delete(sessionId);
    }

    const snap = pending.get(sessionId);
    pending.delete(sessionId);

    if (snap) {
        await writeToFirestore(snap);
    }
}

/**
 * Load a session from Firestore. Returns null if not found.
 * Used as fallback when Redis misses.
 */
export async function loadSessionFromFirestore(sessionId: string): Promise<Session | null> {
    try {
        const doc = await getDB().collection(COLLECTION).doc(sessionId).get();
        if (!doc.exists) return null;

        const data = doc.data();
        if (!data?.session) return null;

        const session = data.session as Session;
        console.log(`[Firestore] restored session ${sessionId}`);
        return session;
    } catch (e: any) {
        console.error(`[Firestore] load failed for ${sessionId}:`, e.message);
        return null;
    }
}


async function writeToFirestore(session: Session): Promise<void> {
    await getDB()
        .collection(COLLECTION)
        .doc(session.id)
        .set(
            {
                session: session,
                sessionId: session.id,
                updatedAt: session.updatedAt,
            },
            { merge: true },
        );
    console.log(`[Firestore] synced session ${session.id}`);
}
