import { GoogleGenAI } from "@google/genai";
import { createAgent } from "./agent/agent";
import { bootstrapIntents } from "./intents/bootstrap";
import { getOrCreateUser } from "./state/memoryStore";
import * as readline from "readline";

const ai = new GoogleGenAI({
    vertexai: true,
    project: "cabswale-ai",
    location: "us-central1",
});

bootstrapIntents();
const agent = createAgent(ai);

const USER_ID = "cli-user";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const prompt = () => rl.question("\nyou > ", handleInput);

const handleInput = async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
        prompt();
        return;
    }

    if (trimmed === "/quit" || trimmed === "/exit") {
        console.log("\nGoodbye");
        rl.close();
        process.exit(0);
    }

    if (trimmed === "/state") {
        const state = getOrCreateUser(USER_ID);
        console.log("\n── session state ──");
        console.log(JSON.stringify(state, null, 2));
        prompt();
        return;
    }

    if (trimmed === "/help") {
        console.log(`
Commands:
  /state   – dump current session state
  /help    – show this help
  /quit    – exit
        `.trim());
        prompt();
        return;
    }

    try {
        const reply = await agent.run(USER_ID, trimmed);
        console.log(`\nraahi > ${reply}`);
    } catch (err: any) {
        console.error(`\n[error] ${err.message}`);
    }

    prompt();
};

console.log("╔══════════════════════════════════════════╗");
console.log("║       RAAHI – Dynamic AI Agent           ║");
console.log("║  type /help for commands, /quit to exit   ║");
console.log("╚══════════════════════════════════════════╝");
prompt();
