import { GoogleGenAI } from "@google/genai";

export const PROJECT_ID = process.env.GCP_PROJECT ?? "cabswale-ai";
export const LOCATION = process.env.GCP_LOCATION ?? "us-central1";
export const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-multilingual-embedding-002";

export const ai = new GoogleGenAI({
    project: PROJECT_ID,
    location: LOCATION,
    vertexai: true,
});
