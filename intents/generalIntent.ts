import type { IntentConfig } from "../types";

const generalIntent: IntentConfig = {
    name: "generalIntent",
    description: "General assistant for casual conversation and queries",

    systemPrompt: `
You are RAAHI, a helpful general assistant.
Answer the user's questions, have a friendly conversation, and help with whatever they need.
If the user wants to do something specific (like verifying Aadhaar), just respond normally – the system will detect the intent change and re‑route automatically.
Be concise.
`.trim(),

    tools: [],
    toolHandlers: {},
};

export default generalIntent;
