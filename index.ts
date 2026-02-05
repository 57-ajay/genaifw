import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
    vertexai: true,
    project: "cabswale-ai",
    location: "asia-south1"
});
