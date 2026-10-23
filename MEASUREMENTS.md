# QVAC SDK measurements on home hardware

Lab log, 9–11 October 2026, `@qvac/sdk` 0.21.0 and `@qvac/cli`, Node 22. Each figure comes from a few runs of the same three prompts (a technical explanation, a shopping list, a one-line translation into Italian). Values are taken after the first prompt unless stated, because the first prompt on GPU always includes a warm-up. Raw output for each run is in the per-machine folders.

## 1. NUC01: Pentium Silver J5040, 4 cores, no AVX, 8 GB RAM, Intel UHD 605

Model: Llama 3.2 1B Instruct Q4_0 (773 MB).

| Backend | Load | Extra RAM after load | TTFT | Prefill | Generation |
| --- | --- | --- | --- | --- | --- |
| GPU (Vulkan, UHD 605) | 10.6 s | +1.55 GB | 14.4–14.7 s | 3.6–3.9 tok/s | 3.7–4.2 tok/s |
| CPU | 6.9 s | +0.36 GB | 3.1–3.3 s | 16.7–17.5 tok/s | 7.8–9.1 tok/s |

- First start (download from the QVAC registry plus load): 83 s.
- On this device the CPU beats the GPU on everything: TTFT 4.7× lower, generation 2.3× faster, a quarter of the RAM. The CPU path works without AVX.
- Prefill is as slow as generation on the GPU: 15 s before the first word is not usable for a voice assistant.
- At ~4–8 tok/s, response length is the main latency lever: 300 tokens take 40–100 s.
- `cacheTokens` was 0 on every request: a fixed system prompt is processed again each time.
- Quality: the 1B model got the translation wrong (wrong weekday, "3 pm" mistranslated) on every run, and answers changed from run to run. Evaluation needs several runs per prompt at a fixed temperature.

## 2. Legion: Ryzen 9 7945HX, 16 cores / 32 threads, 32 GB RAM, NVIDIA discrete GPU (Windows)

Llama 3.2 1B Q4_0:

| Backend | Load | Extra RAM | TTFT | Prefill | Generation |
| --- | --- | --- | --- | --- | --- |
| GPU | 39.7 s (incl. download) | +0.86 GB | 1.73 s on the first prompt, then ~30 ms | ~1,800 tok/s | 161–162 tok/s |
| CPU | 3.6 s | +1.50 GB | 78–130 ms | 399–730 tok/s | 57–59 tok/s |

Larger models:

- **Qwen3 4B Q4_K_M:** the registry download failed with "Invalid device file, was modified" on the local store. The same file from Hugging Face via `fallbackSrc` worked. On GPU: TTFT ~55 ms, ~79 tok/s, +3.0 GB RAM. The translation became correct.
- **Qwen3.6 27B (17.6 GB, already cached by the desktop app):** loaded in 45.5 s, RAM went from 22.6 to 28.6 GB, and the laptop became unresponsive before the first token. The process had to be killed. Nothing checked available memory before loading.
- With `/no_think`, Qwen3 still emits empty `<think></think>` tags that the client has to strip.

## 3. omen01: i7-10700K, 8 cores / 16 threads, 32 GB RAM, GeForce GT 1030 (2 GB), Ubuntu Server 24.04

| Model | Backend | Load | TTFT | Generation | Extra RAM |
| --- | --- | --- | --- | --- | --- |
| Llama 3.2 1B | CPU | 3.6 s | 150–220 ms | ~47 tok/s | +1.0 GB |
| Llama 3.2 1B | GPU GT 1030 | 14.9 s | ~130 ms | ~44 tok/s | +0.9 GB |
| Qwen3 4B | CPU | 8.5 s | 320–380 ms | ~14.8 tok/s | +2.4 GB |
| Qwen3 4B | GPU GT 1030 | 36.6 s | 1.2–1.4 s | ~13.3 tok/s | +1.2 GB (rest in VRAM) |

The GT 1030 does not help: it ties with the CPU on the 1B and is slower on everything with the 4B, which does not fit in 2 GB.

### Larger models on CPU

| Model | Size | Predicted | Measured | TTFT |
| --- | --- | --- | --- | --- |
| Qwen3 4B Q4_K_M | 2.5 GB | ~15 tok/s | 14.8 tok/s | ~0.35 s |
| Qwen3 8B Q4_K_M | ~5 GB | ~7 tok/s | 8.1 tok/s | ~0.6 s |
| Qwen3.6 35B-A3B Q4_K_M (MoE) | ~21 GB, ~3B active | 10–15 tok/s | 10.9–11.8 tok/s | ~0.8 s |

- The rule holds: generation speed ≈ memory bandwidth (~37 GB/s here) ÷ GB of weights active per token. The MoE model is faster than the dense 8B while being four times larger.
- `os.freemem` underestimates RAM for large models, because memory-mapped weights land in the OS page cache.
- With `/no_think` in the prompt, the 35B-A3B still reasoned for 500–990 tokens per answer, ~80 s for a one-line translation. With `reasoning_budget: 0` in `modelConfig`: 42 / 108 / 16 tokens, 10.3–11.4 tok/s, the translation in 2.2 s and correct. Reasoning control changes response time by 40×, and model families handle it differently, so the app should decide it rather than the prompt.

## 4. chiaminer01: HP EliteDesk 800 G4, i5-8500, 6 cores, 16 GB RAM, Intel UHD 630, spinning system disk

| Model | Backend | TTFT | Generation |
| --- | --- | --- | --- |
| Llama 3.2 1B | CPU | ~250 ms | ~23.7 tok/s |
| Llama 3.2 1B | GPU UHD 630 | ~1.1 s | ~14.2 tok/s |
| Qwen3 4B | CPU | ~0.55 s | ~7.2 tok/s |
| Qwen3 4B | GPU UHD 630 | ~4.2 s | ~4.2 tok/s |

- Again the CPU wins on integrated graphics: 1.7× on generation, 4–8× on TTFT.
- After unloading the 4B on the integrated GPU, used RAM stayed at 4.17 GB (1.34 GB after the CPU run). Single observation.
- ~7 tok/s for the 4B is at the edge of comfortable reading: a mid-range PC should default to a 1–2B model.

## 5. Summary across machines

| Machine | 1B: TTFT / generation | 4B: TTFT / generation |
| --- | --- | --- |
| NUC01 (CPU) | ~3.2 s / ~8.5 tok/s | not measured |
| chiaminer01 (CPU) | ~0.25 s / ~24 tok/s | ~0.55 s / ~7.2 tok/s |
| omen01 (CPU) | ~0.15 s / ~47 tok/s | ~0.35 s / ~15 tok/s |
| Legion (GPU) | ~0.03 s / ~161 tok/s | ~0.06 s / ~79 tok/s |

- The same 1B model spans a factor of 19 in generation speed and ~100 in TTFT across these devices.
- The best backend was the CPU on three machines out of four. A short benchmark on first run would pick it better than a fixed GPU default.
- Quality depends on the model, not the hardware: the 4B translates correctly on every machine, the 1B on none.
- Large models should be blocked or discouraged before loading when RAM and VRAM are not enough. `assessModelFit` and `getSystemResources` exist in the SDK for this.

## 6. Using another machine on the home network

As of 0.19.0, delegated P2P inference (`startQVACProvider`, the `delegate` option of `loadModel`) has been removed: "Provider mode and DHT delegation are gone. Models load and run locally only." Two ways remain to use another machine.

### 6a. llama.cpp RPC through the SDK

Setup: omen01 runs `startRpcServer` (CPU, 16 threads), discovered by topic; chiaminer01 loads Qwen3 4B with `rpc-servers` and `devices: RPC0`, split by layer.

Prerequisites found along the way:
- the host must be a concrete private IPv4 address; `0.0.0.0` is rejected;
- `allowNonLoopbackHost: true` to accept LAN connections (no authentication or encryption: trusted LAN only);
- the default worker has no RPC provider: `rpcServerProvider` in `qvac.config.json` plus `npx @qvac/cli bundle sdk`;
- `libibverbs1` on both server and client, even without RDMA;
- discovery by topic took 21.4 s.

| Setup (Qwen3 4B) | TTFT | Generation |
| --- | --- | --- |
| chiaminer01 alone | ~0.55 s | ~7.2 tok/s |
| omen01 alone | ~0.35 s | ~14.8 tok/s |
| chiaminer01 → omen01 via RPC | ~1.35 s | ~5.3–5.5 tok/s |
| omen01 → its own RPC server | 0.8–2.1 s | 2.7–3.1 tok/s |

Investigation of the slowdown:
- Both machines are wired to the same gigabit switch; iperf3 showed 935 Mbit/s with no retransmissions.
- Ping was 1.7 ms, traced to CPU power-saving states on omen01 (0.44 ms with the CPU kept busy). My first estimate blamed per-token network round trips, but keeping both CPUs awake (`/dev/cpu_dma_latency=0`) did not improve the RPC result at all.
- omen01 calling its own RPC server, with no physical network, was even slower. The cost is in the RPC path itself, not the network.

RPC is a way to pool memory across machines for models that do not fit in one. It does not speed up a model that already fits.

### 6b. OpenAI-compatible server over HTTP

Setup: `qvac serve --openai --no-default` on omen01, models declared in `serve.models`, API key file. Client: `http-bench.js` (Node and fetch only, no SDK), `/v1/chat/completions` with streaming.

| Setup (Qwen3 4B) | TTFT | Generation |
| --- | --- | --- |
| chiaminer01 → omen01 via HTTP | ~0.54–0.60 s | ~13 tok/s |

- 88% of omen01's own speed and almost twice what chiaminer01 manages alone; the network adds ~0.2 s to TTFT.
- Same computers, model and network: RPC made delegation 25% slower, request/response made it 80% faster.
- The client needs no QVAC at all, so any OpenAI-compatible app can use it.
- The response does not include `usage`, so tokens were counted as SSE chunks.
- `qvac serve openai` is deprecated in favour of `qvac serve --openai`.

## 7. Clients for the home server

- A webview-based Android client (Chatbox) failed:
  1. the CORS preflight was rejected until `--cors-origin https://localhost --cors-origin http://localhost` was set (`*` and `capacitor://` are refused);
  2. with CORS configured, the streaming response still had no `Access-Control-Allow-Origin` header (checked with curl and an `Origin` header), so the webview discarded it.
- Responses API calls return `X-QVAC-Stub: responses-volatile`.
- A native Android client (ChatterUI) works over Tailscale with `/v1/chat/completions`; it returned 400 until the model name was set.
- Open WebUI in Docker on chiaminer01 works against the server through its Tailscale HTTPS name. The LAN IP did not work from the container, because the server listens on 127.0.0.1 and is published only with `tailscale serve`.

## Final setup

- omen01: `qvac serve --openai --no-default --host 127.0.0.1 --port 11434 --api-key-file …`, Qwen3.6 35B-A3B (`reasoning_budget: 0`) and Qwen3 4B on CPU, published inside the tailnet only with `tailscale serve --https=443`.
- Clients: ChatterUI on the phone over Tailscale, Open WebUI on chiaminer01 with a knowledge base synced from a folder.

## 8. SDK 0.22 (23 October 2026)

### Upgrade notes

- On the Legion (Windows), Node 22.13 still ran the SDK; `qvac bundle` needs `^22.21.0 || >=24.9.0`. Upgraded with `winget upgrade OpenJS.NodeJS.22`.
- `modelConfig.backend` must be an array (`['cuda']`). The release-notes example passes a string (`'cuda,vulkan'`), which fails validation.
- On the Legion, the registry download of Laya failed with "Invalid device file, was modified", the same error as the Qwen3 4B on 9 October. The message now suggests `fallbackSrc`.
- `fallbackSrc` only accepts a file identical to the registry one: the ggml-org Laya GGUF failed the checksum. Loaded directly as a path, it failed with "expected a laya model, got 'modern-bert'" (a different conversion).
- The same models downloaded without problems on omen01 (Linux), so the Laya tests below ran there, in a separate folder so the running `qvac serve` (0.21) was not touched.

### CUDA vs Vulkan (Legion, Qwen3 4B Q4_K_M, `/no_think`)

| Backend | Load | First prompt TTFT | Later TTFT | Generation |
| --- | --- | --- | --- | --- |
| `['cuda']` | 10.3 s | 1.45 s | ~50 ms | ~79–80 tok/s |
| `['vulkan']` | 8.2 s | 72 ms | ~50 ms | ~76–80 tok/s |

- No generation gain from CUDA on a 4B model: the limit is memory bandwidth, as in section 3.
- CUDA has a heavier first-prompt warm-up.
- The SDK stats only report `backendDevice: "gpu"`, so the run does not confirm which backend actually ran.

### Laya as a router for a home assistant (omen01, CPU)

Idea: before calling an LLM, a small decision model classifies each request as **action** (control the home, set a reminder), **search** (needs live internet data), **document** (about the user's own files) or **chat** (general knowledge, writing, maths). One `choice` question per request; three phrasings of the criteria:

- v1: short first attempt;
- v2: detailed descriptions with examples;
- v3: short descriptions of equal length, no examples.

**First run, 12 requests (multilingual 322M):** v1 9/12, v2 7/12. The detailed v2 looked worse.

**Second run, 40 requests (10 per intent), three models × three phrasings** (`laya-bench.js`, raw data in `omen01/laya-bench-omen01-2026-10-23.json`):

| Model | v1 | v2 | v3 | ms per decision |
| --- | --- | --- | --- | --- |
| Laya multilingual 322M | 27/40 | 25/40 | 27/40 | 62–95 |
| Laya 421M | 27/40 | 33/40 | 30/40 | 154–242 |
| Laya typed decisions 421M | 30/40 | 34/40 | 29/40 | 154–242 |

- The 12-case run pointed the wrong way: the detailed v2 hurts the small multilingual model but clearly helps both 421M models.
- Confidence matters more than accuracy, and its scale differs by checkpoint:
  - the multilingual 322M is often confidently wrong (wrong answers up to 95–98%), so no threshold makes it safe;
  - with v2, both 421M models keep wrong answers low (highest wrong answer at 45–46%). With a threshold of 0.45–0.5 they route about 20 of 40 requests immediately with no errors, and hand the other 20 to an LLM;
  - typed decisions spreads probabilities across options, so a 0.7 threshold would hand off every request. Thresholds have to be calibrated per model.
- Longer criteria cost time: ~155 → ~240 ms per decision, still below the Qwen3 4B time to first token on the same machine (~350 ms).
- All six errors of the best combination (typed decisions, v2) went to "chat", with 34–45% confidence.
- `decide()` with `states` (batch) took ~186 ms per request, slower than sequential calls (~139 ms).
- Limits: 40 hand-written requests, one run, English only.
