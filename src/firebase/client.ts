import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let db: Firestore;

export function getDB(): Firestore {
    if (!db) {
        if (!getApps().length) initializeApp({ credential: applicationDefault() });
        db = getFirestore();
    }
    return db;
}
