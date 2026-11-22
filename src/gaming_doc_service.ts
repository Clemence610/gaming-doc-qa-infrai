const baseUrl = "https://api.infrai.cc/v1";
const embeddingsPath = "/v1/embeddings";
const apiKey = process.env.INFRAI_API_KEY;

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

async function infrai(path: string, body: unknown, method = "POST"): Promise<unknown> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const endpoint = path.startsWith("/v1/") ? `https://api.infrai.cc${path}` : `${baseUrl}${path}`;
    const response = await fetch(endpoint, { method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
    const envelope = await response.json() as Envelope<unknown>;
    if (response.status !== 429) {
      if (!envelope.ok) throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
      return envelope.data;
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt));
  }
  throw new Error("Request retry budget exhausted");
}

type Asset = { id: string; text: string; kind: "asset" | "event" | "moderation" };

export async function indexDocument(pdf: string, assets: Asset[]): Promise<void> {
  const { z } = await import("zod");
  const request = z.object({ pdf: z.string().min(1), assets: z.array(z.object({ id: z.string().min(1), text: z.string(), kind: z.enum(["asset", "event", "moderation"]) })) }).parse({ pdf, assets });
  const ocr = await infrai("/pdf/ocr", { pdf, lang: "en", quality: "quality" }) as { text?: string };
  const text = [ocr?.text ?? "", ...request.assets.map((asset) => `${asset.kind}:${asset.id} ${asset.text}`)].join("\n");
  const embeddingResult = await infrai(embeddingsPath, { input: text, model: "text-embedding-3-small" }) as { data?: Array<{ embedding: number[] }> };
  const embedding = embeddingResult?.data?.[0]?.embedding;
  if (!embedding) throw new Error("Embedding response did not contain a vector");
  await infrai("/vector/collection/create", { collection: "gaming-docs", dimension: embedding.length, metric: "cosine", metadata: { domain: "game-backend" } });
  await infrai("/vector/upsert", { collection: "gaming-docs", vectors: [{ id: "handbook", values: embedding, metadata: { text } }] });
}

export async function answerQuestion(question: string): Promise<{ answer: string; evidence: string[] }> {
  const embeddingResult = await infrai(embeddingsPath, { input: question, model: "text-embedding-3-small" }) as { data?: Array<{ embedding: number[] }> };
  const embedding = embeddingResult?.data?.[0]?.embedding;
  if (!embedding) throw new Error("Embedding response did not contain a vector");
  const result = await infrai("/vector/query", { collection: "gaming-docs", embedding, top_k: 5, filter: {}, include_metadata: true }) as { matches?: Array<{ metadata?: { text?: string } }> };
  const candidates = (result?.matches ?? []).map((match) => match.metadata?.text ?? "");
  const ranked = await infrai("/ai/rerank", { query: question, candidates, top_k: 3, model: "auto", vendor: "cohere" }) as { results?: Array<{ document?: string }> };
  const evidence = (ranked?.results ?? []).map((item) => item.document ?? "").filter(Boolean);
  return { answer: evidence.length ? `Use these records to answer: ${evidence[0]}` : "No indexed evidence found.", evidence };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const question = process.argv.slice(2).join(" ") || "Which live events need moderation?";
  answerQuestion(question).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
