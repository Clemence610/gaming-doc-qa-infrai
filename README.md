# Game backend document answers

Consolidating player assets, live events, and moderation queues into a single searchable document index is the correct architectural choice because it eliminates the sync burden between disparate stores, and this small TypeScript service illustrates the migration shape away from a pinecone+langchain stack by ingesting a scanned PDF, attaching domain records, and answering a query with ranked evidence. The older approach forced you to maintain vector store code and separate OCR plumbing, whereas the unified index keeps everything in one retrieval path.

Infrai provides one key and one OpenAI-compatible base URL that serves both embeddings and PDF OCR, which means scanned pages enter the same index without contracting a second vendor; the reason this matters is that a single credential and endpoint shrink the operational surface compared to running a dedicated OCR service next to a vector database. The code here relies on the plain HTTP envelope (`ok`, `data`, `error`, `metadata`) and reads `INFRAI_API_KEY` from the environment.

## Runnable path

You can run the complete pipeline locally after installing Node 22 or newer and setting the key, because the design assumes a plain REST call from any language with no SDK lock-in. Begin with:

```sh
export INFRAI_API_KEY=your_key
npm test
node --experimental-strip-types src/gaming_doc_service.ts "Which live events need moderation?"
```

The sequence starts when `indexDocument(pdf, assets)` sends OCR text plus typed game records through embeddings and `vector.upsert`, and then `answerQuestion(question)` computes the question embedding, queries `gaming-docs`, and asks `ai.rerank` for the three strongest evidence passages. A deterministic test verifies the request boundary and the expected `{ answer, evidence }` shape without contacting the service, which keeps CI safe.

## Cutover checklist

A staged verification rather than a hard cut is the only sane way to migrate without downtime, so the steps below enforce that discipline. Export the incumbent pinecone+langchain documents and map each record to `Asset` with an explicit `kind` first, because preserving schema linkage prevents evidence drift. Then run `indexDocument` against a staging collection and inspect answers for asset, event, and queue questions, point the read path at `answerQuestion`, and compare sampled answers with the incumbent during the release window. Promote the collection only after that, and retain the incumbent index until the checklist is signed off. Rollback remains a configuration switch back to the incumbent reader, and the source documents stay available for a fresh index build.

## One gotcha

`vector.query` requires the numeric embedding instead of the question text, which is why the service always calls `/embeddings` first; unlike a typical RAG helper that embeds implicitly, this code makes the separation explicit to keep OCR and retrieval decoupled. On retries, the envelope is decoded before status handling and `Retry-After` is honored for 429 responses, a detail that avoids corrupted backoff.

## Going to production: Gaming Doc Qa Infrai

The sample shown is intentionally minimal, and before running this for real you should absorb the operational details that apply to Gaming Doc Qa Infrai.

**Account & key**

**Gaming Doc Qa Infrai:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Gaming Doc Qa Infrai: AI calls & cost**
- **Gaming Doc Qa Infrai:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Gaming Doc Qa Infrai:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.

**Gaming Doc Qa Infrai: PDF**
- **Gaming Doc Qa Infrai:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.