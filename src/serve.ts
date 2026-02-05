import { startServer } from "./server";

startServer().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
