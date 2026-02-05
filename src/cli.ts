import {
    connectRedis,
    disconnectRedis,
    seedDefaults,
    getSession,
    saveSession,
    newSession,
} from "./store";
import { resolve, BASE_TOOLS } from "./agent";
import * as readline from "readline";

const SESSION_ID = process.env.SESSION_ID ?? "testUserAjay";

async function main() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();

    let session = await getSession(SESSION_ID);
    if (session) {
        console.log(`-> Resumed session: ${SESSION_ID} (${session.history.length} msgs)`);
    } else {
        session = newSession(SESSION_ID, BASE_TOOLS);
        await saveSession(session);
        console.log(`-> New session: ${SESSION_ID}`);
    }

    console.log("─".repeat(50));
    console.log("Commands: /new (reset) | /tools (active tools) | /exit");
    console.log("─".repeat(50));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const ask = () => {
        rl.question("\nYou: ", async (input) => {
            const trimmed = input.trim();
            if (!trimmed) return ask();

            if (trimmed === "/exit") {
                console.log("Goodbye!");
                await disconnectRedis();
                rl.close();
                return;
            }

            if (trimmed === "/new") {
                session = newSession(SESSION_ID, BASE_TOOLS);
                await saveSession(session!);
                console.log("  ↻ Session reset.");
                return ask();
            }

            if (trimmed === "/tools") {
                console.log("  Active tools:", session!.activeTools.join(", "));
                return ask();
            }

            session!.history.push({ role: "user", parts: [{ text: trimmed }] });

            try {
                const result = await resolve(session!);
                console.dir(`result:  ${result.action.data}`, { depth: null });
                console.log(`\nBot: ${result.response}`);
                console.log(`  -> action: ${result.action.type}`);
                if (Object.keys(result.action.data).length > 0) {
                    console.log(`  -> data:`, JSON.stringify(result.action.data, null, 2));
                }
            } catch (e: any) {
                console.error(`\nError: ${e.message}`);
            }

            ask();
        });
    };

    ask();
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
