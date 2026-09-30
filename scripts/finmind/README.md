# FinMind captures

The FinMind diorama (`src/three/scenes/finmind.js`) shows the product's own
output. Nothing in it is invented. These files are where that output came from,
captured on 2026-09-30 from the product repo (`HYDRABATH_HACK/ai-money-mentor`,
commit `13c7f4f`), running on this laptop against a scratch copy of its `data/`
folder, so the product's own database wasn't touched.

| File | What | How |
|---|---|---|
| `captures/fire-published.json` | The stage timings the case study quotes (37 ms calc, 222 ms retrieval, 5.3 s LLM, 6 ms safety), trust 100, success 37% | Parsed from the product's own capture, `data/sse-fire.txt` |
| `captures/fire-request.json` | The FIRE inputs behind that run (age 29, retire at 50, ₹1,20,000 income, ₹60,000 expenses, and so on) | Reconstructed. `POST /api/fire/calc` returns the same 45 steps, ₹6.99 Cr, ₹74,500 and 37% |
| `captures/fire-calc.json` | The 45 calculation steps and the 1,000-scenario bands | `POST /api/fire/calc` |
| `captures/fire-languages.json` | The same plan explained in en, hi, te and ta (the `X-Language` header), each with its trust report | `capture_fire.py en hi te ta` against `/api/fire/stream`. The English run needed the one retry ("Asking the model to fix: Numbers match calculator") and then passed 4/4 |
| `captures/fire-model-missing.json` | The template explanation, from a run whose narrative model isn't installed ("Model output was malformed; explanation from templates", trust 85) | A second instance with `--mentor.llm.structured-model` pointing at a model that doesn't exist |
| `captures/retrieval.json` | For 4 questions: the vector top 8, the keyword top 8 and the RRF top 4 | `capture_retrieval.py`, which replicates `KnowledgeService.retrieve` over the same Qdrant and FTS5 index. Its fused scores match `/api/knowledge/search` exactly for all 4 |

Timings in the new captures are slower than the published run, because the
embedder shared the GPU with the chat model (the product pins it to the CPU).
The diorama quotes the published timings and uses the new captures only for
text and rankings.

If Ollama itself is unreachable, Spring AI retries with backoff for longer
than the stream's 240 s timeout. So the diorama doesn't claim a quick "model
offline" fallback.
