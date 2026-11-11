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
- Asking two questions in one `decide()` call (intent + device, typed decisions 421M) took ~373 ms for a command, the same as two separate calls (~268 + ~144 ms after warm-up). The cost grows with the questions asked, so a router should ask the second question only when it is needed.
- Limits: 40 hand-written requests, one run, English only.

## 9. RTX 3060 and SDK 0.23 (3 November 2026)

omen01's GeForce GT 1030 (2 GB) was replaced by a second-hand RTX 3060 12 GB (Gigabyte Gaming OC). Idle: 8 W of 170 W, 31 °C. Driver 580.178.04, CUDA 13.0.

Side effect worth knowing: after the swap, the onboard Realtek network card (r8169) stopped at boot with `AER: can't recover (no error_detected callback)` and PCIe "UnsupReq" errors on its root port. `pcie_aspm=off` on the kernel command line fixed it.

### Qwen3 4B Q4_K_M through `qvac serve` (omen01)

Prompt: "Spiega in tre frasi cos'è un router di casa. /no_think" (about 70 tokens out), timed with curl, non-streaming. The first request after a start includes loading the model into VRAM.

| Setup | First request | Next requests | Server log |
| --- | --- | --- | --- |
| CPU, CLI 0.15 / SDK 0.21 | 5.7 s | | |
| RTX 3060, CLI 0.15 / SDK 0.21 | 9.2 s | 1.10 s | |
| RTX 3060, CLI 0.18 / SDK 0.23 | 4.1 s | 0.88 s | 69 tokens, 83.8 tok/s, TTFT 36 ms, `backend=gpu` |

- Only `"device": "gpu"` changed in `qvac.config.json`; GPU memory used: ~2.8 GB.
- Bandwidth estimate: 360 GB/s ÷ 2.5 GB ≈ 145 tok/s; measured 84 tok/s (~58%).
- 0.23's server log reports tok/s, TTFT and `backend=gpu` per request, but not CUDA vs Vulkan.

### Voice assistant (home-router on omen01, satellite on the Legion over Tailscale)

Whisper small Q8 (one instance per language), Supertonic 3 on CPU, real spoken questions in Italian. Times from the satellite's log.

| Whisper on | Speech to text |
| --- | --- |
| i7-10700K CPU, 8 threads | 2.35–2.43 s |
| GT 1030 | 1.09–1.33 s |
| RTX 3060 | 0.31–0.43 s |

| Question (RTX 3060) | From end of question to first spoken word |
| --- | --- |
| "Che ore sono a New York?" (answered from the server clock, no LLM) | 0.9 s |
| General question, reply spoken after the whole answer | 2.4 s |
| Same question, each sentence spoken as soon as the LLM finishes it | 1.4 s |

- The first question after starting home-router took 22.9 s (first use of every model); warming each model up at startup brought the first question to 2.4 s.
- Whisper's own language detection turned "che ore sono" into French ("que horas o no"); each device now declares its language.
- Qwen3 4B invented live data ("23 °C, cielo sereno" for Geneva in November) and once said that fish breathe with lungs: weather, news and prices now go to a web search after asking, and factual questions need a larger model.
- One run per question: orders of magnitude, not a benchmark.

### Registry error on Windows: root cause

"Invalid device file, was modified" ([tetherto/qvac#5407](https://github.com/tetherto/qvac/issues/5407)) came from `bare-fs`, not from a damaged store. A log line added to `device-file` on a failing run showed the file ID matching and the times negative:

```
{"ino":"43628621391516500","inode":43628621391516500,"mtime":-1894642065,"birthtime":-1894642070,"created":1793401687656}
```

`bare-fs` 4.5.5–4.8.3 computes `time.tv_sec * 1000` with `tv_sec` a 32-bit `long` on Windows, so the multiplication overflows. 4.8.4 casts to `int64_t`. After `npm update bare-fs`, the same store opened, with `mtime` 1793401687663. `registry-repro.js` had not shown this, because a cached model never opens the registry; `registry-open.js` lists the registry and always does.


## 10. Delegated inference over the QVAC mesh (7 November 2026)

The Legion asks, omen01's RTX 3060 answers, over the QVAC mesh (`@qvac/core` 0.11.4, `duck` TUI). No HTTP server, no API key, no port opened by hand: the Legion joined omen01's mesh with a device invite and picked the agent provided by omen01.

- omen01: `QVAC_MODEL=Qwen3.5-4B-Q4_K_M duck --headless --storage <dir>` (the 4B is what duck's device profile recommends for 12 GB of VRAM).
- Legion: `duck --storage <dir> --device-join <invite>`, then the omen01 agent. Both machines on the same home network.
- Prompt: "Spiega in tre frasi cos'è un router di casa." Figures as shown by duck on the asking device.

| Run | Time to first token | Generation | Tokens | Note |
| --- | --- | --- | --- | --- |
| 1st | 28.5 s | 48.6 tok/s | 129 | first use: model downloaded (2.7 GB) and loaded on omen01 just before |
| 2nd | 0.33 s | 65.1 tok/s | 207 | model already loaded |

- On omen01 the duck model sidecar held 4.4 GB of VRAM, next to `qvac serve` with Qwen3 4B (2.8 GB) and home-router's Whisper (1.4 GB): 8.8 of 12 GB in use.
- The reply streams back to the asking device as the model writes, thinking included.
- The first answer had two sentences instead of three; the second had three.
- One run each: orders of magnitude, not a benchmark. Not yet measured: the same question with duck local on omen01.

### HTTP reference: the same model through `qvac serve`

Same model (`QWEN3_5_4B_MULTIMODAL_Q4_K_M`, alias `qwen35-4b`, on the GPU of omen01), same prompt, `http-bench.js` with `RUNS=2`, streaming `/v1/chat/completions`. Time to first token counts reasoning tokens too, as duck does. duck was stopped to free VRAM.

| Path | Time to first token (2nd run) | Generation |
| --- | --- | --- |
| `qvac serve`, client on omen01 (loopback) | 89 ms | 70 tok/s |
| `qvac serve`, client on the Legion over Tailscale HTTPS | 104 ms | 71 tok/s |
| QVAC mesh, Legion asking omen01 (duck) | 327 ms | 65 tok/s |

- Over the home network, Tailscale HTTPS added about 15 ms to the first token; the mesh path about 240 ms. Generation speed is the GPU's in all three.
- The duck figures are those shown by duck (from the request to the first streamed chunk); `http-bench.js` measures from the HTTP request. Close, not identical methods.
- With no reasoning limit, `qwen35-4b` in `qvac serve` often spent its whole token allowance thinking (990 tokens, no answer); one run in four answered. duck limits the thinking and always answered. A `reasoning_budget` in the serve config is the next thing to try.
- CLI 0.18 checks the Host header: requests through `tailscale serve` got `403 host_not_allowed` until the tailnet name was added to `serve.allowedHosts`.
- One or two runs per path.

### Getting there on Windows

- `duck` on Windows needs `bare` called directly (`bare <npm global>/@qvac/core/tui/index.mjs`), as the shim looks for `bare.exe`.
- The TUI then failed with "worker closed before ready": `tui/boot.mjs` builds the harness entry with `new URL(import.meta.resolve(...)).pathname`, which on Windows gives `/C:/Users/...`; the loader then looks in `/C:/C:/Users/...`. Using `fileURLToPath(...)`, as the next line of the same file already does, fixed it on the Legion.
- A device join started while the TUI was failing did not complete, and the Legion stayed on its own mesh ("membership 1", no peers in `/doctor`); joining again after the fix worked.

## 11. BotPsy-0.8B as the router of a home assistant (11 November 2026)

[BotPsy-0.8B](https://huggingface.co/qvac/BotPsy-0.8B-GGUFs) (Tether, tool calling, Q8_0, 0.81 GB) through `qvac serve` on the RTX 3060 (explicit `src` entry, `tools: true`, `ctx_size` 8192), on the same 40 English requests used to choose Laya as home-router's router (10 per intent: action, search, document, chat). The intents become tools: `control_device(device, action, room?, value?)`, `web_search(query)`, `search_documents(query)`; no tool call means chat. Sampling as the model card recommends (temperature 0.3, top_p 0.95, top_k 20, presence_penalty 1.5). One warm-up request per mode, then one run of the 40. Script: `botpsy-route-bench.mjs`.

| Router | Right | action | search | document | chat | Time per request | Also gives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Laya typed decisions 421M (CPU, 23 Oct) | 34/40 | 8-9/10 each (see section 8) | | | | 242 ms mean | intent only; the device needs a second `decide()` |
| BotPsy, thinking on (GPU) | **37/40** | 10/10 | 10/10 | 8/10 | 9/10 | 813 ms median, 1,260 ms mean | device, action, room, value |
| BotPsy, thinking off (GPU) | 30/40 | 9/10 | 7/10 | 4/10 | 10/10 | 466 ms median, 576 ms mean | same |

- With thinking on, BotPsy routed better than Laya and filled the arguments of every command: 10/10 devices right, rooms and values included ("Dim the kitchen lights to 30 percent" → `lights`, `dim`, `kitchen`, `30`). Its three errors were two personal documents sent to web search and "Explain how a heat pump works" sent to search instead of answered.
- Thinking off is faster but worse: it answered most document and live-information requests with "I don't have access…" instead of calling the tool.
- It is 3-5 times slower than Laya per request, on a GPU against Laya on the CPU. For a voice assistant that is the cost of one more sentence of latency, unless BotPsy only handles the requests Laya is unsure about.
- An earlier 8-case check in Italian and French: 7/8 right; it read "Che tempo fa a Ginevra?" as a question about the time, and answered small talk badly (it is a tool caller, not a chat model).
- One run per mode: orders of magnitude, not a benchmark. Laya's figures are from its own run of 23 October.
