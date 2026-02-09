import { startServer } from "./server";
import { startWS } from "./ws";

const WS_PORT = parseInt(process.env.WS_PORT ?? "3001", 10);

async function main() {
    await startServer();
    startWS(WS_PORT);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
