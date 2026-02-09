import { startServer } from "./server";
import { startWS } from "./ws";
import { preloadAll, AUDIO_CONFIG } from "./audio";

const WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);

async function main() {
    await startServer();

    if (AUDIO_CONFIG.enabled && !AUDIO_CONFIG.forceTTS) {
        await preloadAll();
    }

    startWS(WS_PORT);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
