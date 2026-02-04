import type { UserState, ChatMessage } from "../types";

// ── In‑memory store – drop‑in replaceable with Redis later ──
const store = new Map<string, UserState>();

export const getOrCreateUser = (userId: string): UserState => {
    if (!store.has(userId)) {
        const state: UserState = {
            userId,
            currentIntent: null,
            chatHistory: [],
            context: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        store.set(userId, state);
    }
    return store.get(userId)!;
};

export const updateIntent = (userId: string, intent: string): UserState => {
    const state = getOrCreateUser(userId);
    if (state.currentIntent !== intent) {
        state.currentIntent = intent;
        state.context = {};              // reset context on intent switch
    }
    state.updatedAt = new Date();
    return state;
};

export const pushMessage = (userId: string, msg: ChatMessage): void => {
    const state = getOrCreateUser(userId);
    state.chatHistory.push(msg);
    state.updatedAt = new Date();
};

export const setContext = (userId: string, key: string, value: any): void => {
    const state = getOrCreateUser(userId);
    state.context[key] = value;
    state.updatedAt = new Date();
};

export const getContext = (userId: string, key: string): any => {
    return getOrCreateUser(userId).context[key] ?? null;
};

export const clearState = (userId: string): void => {
    store.delete(userId);
};
