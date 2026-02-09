import WebSocket from "ws";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3001";
const MESSAGE = process.argv[2] ?? "Delhi se Jaipur duty chahiye";
const SESSION = process.env.SESSION_ID ?? "test-audio-01";

const ws = new WebSocket(WS_URL);
const audioChunks: Buffer[] = [];

ws.on("open", () => {
    console.log("Connected to", WS_URL);
    ws.send(JSON.stringify({
        sessionId: SESSION,
        message: MESSAGE,
        audio: true,
        userData: { name: "Ajay", phoneNo: "9876543210", date: new Date().toISOString().split("T")[0] },
    }));
    console.log(`Sent: "${MESSAGE}"\n`);
});

ws.on("message", (data, isBinary) => {
    if (isBinary) {
        const buf = Buffer.from(data as ArrayBuffer);
        audioChunks.push(buf);
        process.stdout.write(`  ♪ chunk ${audioChunks.length} (${buf.length} bytes)\n`);
        return;
    }

    const msg = JSON.parse(data.toString());

    if (msg.type === "chunk") {
        process.stdout.write(msg.text);
        return;
    }

    if (msg.type === "response") {
        console.log(`\n\nBot: ${msg.response}`);
        console.log(`Action: ${msg.action.type}`, JSON.stringify(msg.action.data));
    } else if (msg.type === "audio_start") {
        console.log(`\nAudio incoming: ${msg.contentType}, ${msg.size} bytes`);
    } else if (msg.type === "audio_end") {
        const full = Buffer.concat(audioChunks);
        const outPath = `test-output-${Date.now()}.wav`;
        require("fs").writeFileSync(outPath, full);
        console.log(`\n✓ Audio saved: ${outPath} (${full.length} bytes)`);
        ws.close();
    } else if (msg.type === "audio_error") {
        console.error("Audio error:", msg.error);
        ws.close();
    } else if (msg.type === "error") {
        console.error("Error:", msg.error);
        ws.close();
    } else {
        console.log("Unknown:", msg);
    }
});

ws.on("close", () => {
    console.log("Disconnected");
    process.exit(0);
});

ws.on("error", (e) => {
    console.error("WS error:", e.message);
    process.exit(1);
});
