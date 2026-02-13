import { getAllMappedUrls } from "./mapping";

const store = new Map<string, Buffer>();

export function getCached(key: string): Buffer | null {
    return store.get(key) ?? null;
}

export function setCached(key: string, buf: Buffer): void {
    store.set(key, buf);
}

export async function fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

export async function preloadAll(): Promise<void> {
    const mapped = getAllMappedUrls();
    const entries = Array.from(mapped.entries());
    console.log(`Preloading ${entries.length} audio files...`);

    const results = await Promise.allSettled(
        entries.map(async ([key, url]) => { store.set(key, await fetchBuffer(url)); return key; }),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status === "rejected").length;
    console.log(`Audio preloaded: ${ok} ok, ${fail} failed`);
}

export function cacheStats(): { total: number; keys: string[] } {
    return { total: store.size, keys: Array.from(store.keys()) };
}
