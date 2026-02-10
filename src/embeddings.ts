import { ai, EMBED_MODEL } from "./config";

export const VECTOR_DIM = 768;

export async function embed(text: string): Promise<Buffer> {
    const res = await ai.models.embedContent({ model: EMBED_MODEL, contents: text });
    const values = res.embeddings?.[0]?.values;
    if (!values?.length) throw new Error("Empty embedding response");

    const buf = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i]!, i * 4);
    return buf;
}
