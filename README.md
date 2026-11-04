# qvac-lab

[![Built with QVAC](https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-green-light.svg)](https://github.com/tetherto/qvac)

Hands-on measurements of Tether's [QVAC SDK](https://github.com/tetherto/qvac) (`@qvac/sdk` 0.21 to 0.23) on four home machines, from a Pentium NUC without AVX to a desktop with an RTX 3060. October–November 2026.

This is a personal lab, not affiliated with Tether. Each figure comes from a few runs of three prompts: good for orders of magnitude, not a rigorous benchmark. The full log, with every run and the reasoning behind it, is in [`MEASUREMENTS.md`](MEASUREMENTS.md). Issues met while setting up the SDK, with suggestions, are in [`SDK-FEEDBACK.md`](SDK-FEEDBACK.md).

## Machines

| Machine | CPU | RAM | GPU |
| --- | --- | --- | --- |
| NUC01 | Pentium Silver J5040, 4 cores, no AVX | 8 GB | Intel UHD 605 |
| chiaminer01 | i5-8500, 6 cores | 16 GB | Intel UHD 630 |
| omen01 | i7-10700K, 8 cores / 16 threads | 32 GB | GeForce RTX 3060 (12 GB) since November 2026; GT 1030 (2 GB) before |
| Legion | Ryzen 9 7945HX, 16 cores | 32 GB | NVIDIA discrete |

## Key results

**A 12 GB GPU turned the home server into a voice assistant.** omen01 with an RTX 3060, Qwen3 4B Q4_K_M through `qvac serve`, a three-sentence answer (about 70 tokens):

| Setup | Answer time | Generation | Time to first token |
| --- | --- | --- | --- |
| i7-10700K CPU, SDK 0.21 | 5.7 s | ~15 tok/s | ~0.35 s |
| RTX 3060, SDK 0.21 | 1.1 s | | |
| RTX 3060, SDK 0.23 (CLI 0.18) | 0.88 s | 84 tok/s | 36 ms |

The bandwidth rule below predicts ~145 tok/s for the 3060 (360 GB/s ÷ 2.5 GB); 84 tok/s is about 58% of that.

**Speech recognition moved from the slowest step to one of the fastest.** Whisper small (Q8), one spoken question of a few seconds, inside the [home-router](https://github.com/cloudeeo/home-router) voice assistant: ~2.4 s on the CPU, ~1.1–1.3 s on the GT 1030, ~0.3–0.4 s on the RTX 3060. End to end, from the end of the question to the first spoken word: 0.9 s for a question answered without the LLM, 2.4 s for a general question when the reply is spoken after the whole answer, 1.4 s when each sentence is spoken as soon as the LLM finishes it.

**The Windows registry error was a 32-bit overflow, not a broken store.** "Invalid device file, was modified" came from `bare-fs` 4.5.5–4.8.3, which computes file times in milliseconds with a 32-bit `long` on Windows, so the store's own creation time never matched. `npm update bare-fs` (4.8.4) fixes it without deleting anything ([tetherto/qvac#5407](https://github.com/tetherto/qvac/issues/5407)). Cached models skip the registry, so `registry-open.js` lists the registry to make sure the store is opened.

**The same model is a different product on each machine.** Llama 3.2 1B Q4_0, best backend per machine:

| Machine | Backend | Time to first token | Generation |
| --- | --- | --- | --- |
| NUC01 | CPU | ~3.2 s | ~8.5 tok/s |
| chiaminer01 | CPU | ~0.25 s | ~24 tok/s |
| omen01 | CPU | ~0.15 s | ~47 tok/s |
| Legion | GPU | ~0.03 s | ~161 tok/s |

**With the original hardware, the CPU beat the GPU on three machines out of four.** Integrated graphics and a 2 GB card were slower than the CPU. Only the laptop's discrete GPU won. The backend should be measured on first run, not assumed.

**Generation speed follows memory bandwidth.** tok/s ≈ bandwidth ÷ size of the active weights. On omen01 (~37 GB/s): Qwen3 4B Q4_K_M (2.5 GB) was predicted at 15 tok/s and measured at 14.8. The Qwen3.6 35B-A3B MoE (~3B active parameters) ran at ~11 tok/s, faster than the dense 8B (~8 tok/s).

**Reasoning control matters more than the prompt.** With Qwen3.6 35B-A3B, `/no_think` in the prompt did not stop reasoning (500–990 tokens, ~80 s for a one-line translation). `reasoning_budget: 0` in `modelConfig` did: 16 tokens, 2.2 s, correct answer.

**To use another machine, HTTP beats RPC.** Qwen3 4B, chiaminer01 as client, omen01 as server, gigabit LAN:

| Setup | Generation |
| --- | --- |
| chiaminer01 alone | 7.2 tok/s |
| chiaminer01 → omen01, llama.cpp RPC | 5.4 tok/s |
| chiaminer01 → omen01, `qvac serve` over HTTP | 13 tok/s |
| omen01 alone (reference) | 14.8 tok/s |

RPC was slower than running locally, even with omen01 calling its own RPC server, so the cost is in the RPC path, not the network. RPC is for pooling memory across machines, not for speed.

**A small decision model can route requests, if its confidence is calibrated.** SDK 0.22 added Laya, a model that answers typed questions instead of writing text. Used as a router for a home assistant (action, search, document or chat), Laya typed decisions 421M got 34 of 40 requests right at ~240 ms on CPU. With a 0.45 confidence threshold it routed half the requests immediately with no errors and handed the rest to an LLM. A first run on 12 requests had pointed to the opposite conclusion.

**No safety check before loading.** A 27B model (17.6 GB) loaded on a 32 GB laptop with other apps open and froze the machine. `assessModelFit` exists in the SDK but is not part of the default flow.

## Scripts

| File | What it does |
| --- | --- |
| `measure.js` | Loads a model with the SDK and measures load time, TTFT, tok/s and RAM on three prompts |
| `http-bench.js` | Same prompts against any OpenAI-compatible server (e.g. `qvac serve`), streaming; no SDK needed |
| `rpc-serve.js` | Starts a llama.cpp RPC server through the SDK, with LAN discovery |
| `rpc-client.js` | Loads a model on the local machine with its layers on the RPC server |
| `laya-test.js` | SDK 0.22: Laya as a home-assistant router on 12 requests, two phrasings side by side |
| `laya-bench.js` | SDK 0.22: three Laya models × three phrasings on 40 labelled requests, with confidence analysis and a JSON of every prediction |
| `voice-test.js` | Text to speech (Supertonic, Chatterbox) and speech to text (Whisper small/turbo, Parakeet) in Italian and French, with word error rate |
| `tts-one.js`, `tts-voices.js` | Several sentences with one Supertonic model; every voice (F1–F5, M1–M5) at a chosen speed |
| `video-test.js` | Text-to-video with Wan 2.1 / 2.2 (diffusion), with VRAM, layer streaming and CPU-VAE options |
| `backend-repro.js` | Which backend (CUDA or Vulkan) a model actually loads on ([tetherto/qvac#5345](https://github.com/tetherto/qvac/issues/5345)) |
| `registry-repro.js`, `registry-open.js` | Registry download, and a registry listing that always opens the local store ([tetherto/qvac#5407](https://github.com/tetherto/qvac/issues/5407)) |
| `<machine>/` | Raw output of the runs, one folder per machine |

### measure.js

```bash
npm install
MODEL=QWEN3_4B_INST_Q4_K_M DEVICE=cpu node measure.js
```

| Variable | Meaning |
| --- | --- |
| `MODEL` | SDK model constant, default `LLAMA_3_2_1B_INST_Q4_0` |
| `DEVICE` | `gpu` (default) or `cpu` |
| `NOTHINK` | any value appends `/no_think` to each prompt |
| `REASONING` | value for `reasoning_budget` (`0` turns reasoning off) |
| `FALLBACK` | HTTP URL of a GGUF file, used if the registry download fails |

### http-bench.js

```bash
cp .env.example .env    # then fill in URL, KEY, MODEL
node --env-file=.env http-bench.js
```

### RPC

Both machines need `libibverbs1` (`sudo apt install libibverbs1`), even without RDMA. The server also needs the RPC provider bundled into the worker:

```bash
cp qvac.config.json.server-example qvac.config.json
npx @qvac/cli bundle sdk
DEVICE=cpu TOPIC=my-topic node rpc-serve.js        # server
TOPIC=my-topic MODEL=QWEN3_4B_INST_Q4_K_M node rpc-client.js   # client
```

The RPC server has no authentication: use it only on a trusted LAN.
