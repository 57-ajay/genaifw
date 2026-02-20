export const AUDIO_CONFIG = {
    enabled: process.env.AUDIO_ENABLED !== "false",
    forceTTS: process.env.FORCE_TTS === "true",
    chunkSize: parseInt(process.env.AUDIO_CHUNK_SIZE ?? "16384"),
    firebaseBucket: process.env.FIREBASE_BUCKET ?? "bwi-cabswalle.appspot.com",
    firebasePath: process.env.FIREBASE_AUDIO_PATH ?? "Raahi",
    tts: {
        languageCode: process.env.TTS_LANG ?? "hi-IN",
        voiceName: process.env.TTS_VOICE ?? "hi-IN-Neural2-A",
        ssmlGender: process.env.TTS_GENDER ?? "FEMALE",
        encoding: "LINEAR16" as const,
        sampleRateHertz: parseInt(process.env.TTS_SAMPLE_RATE ?? "24000"),
        model: process.env.TTS_MODEL ?? "gemini-2.5-flash-lite-preview-tts",
    },
};
console.log("[AudioConfig]", JSON.stringify(AUDIO_CONFIG, null, 2));
