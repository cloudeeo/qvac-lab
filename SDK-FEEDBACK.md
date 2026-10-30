# QVAC SDK: issues found while setting it up

Friction points met while installing and using `@qvac/sdk` 0.21.0 and `@qvac/cli` on four home machines (Ubuntu 24.04, Windows 11), 9–11 October 2026. Each item says what happened, how it was worked around, and what would have helped. They are observations from one user's setup, not confirmed bugs; numbers and raw logs are in [`MEASUREMENTS.md`](MEASUREMENTS.md).

## Loading models

**1. Registry download failed with an unclear error.**
Qwen3 4B Q4_K_M from the registry failed on Windows with "Invalid device file, was modified". The same file from Hugging Face through `fallbackSrc` worked.
*Would help:* an error that says what to do (clear the local store, retry), and an automatic HTTP fallback for registry models.

**2. No memory check before loading.**
A 27B model (17.6 GB) loaded on a 32 GB laptop with other apps open. The machine froze before the first token and the process had to be killed. `assessModelFit` exists but is not part of the default flow or the getting-started guide.
*Would help:* run the fit check by default inside `loadModel` (with an opt-out), or at least feature it in the quickstart.

**3. The GPU default was the slower choice on three machines out of four.**
With `device` left at its default (`gpu`), integrated graphics (UHD 605, UHD 630) and a 2 GB GT 1030 were slower than the CPU. On the Pentium NUC the GPU gave a 14 s TTFT against 3 s on CPU. Only a recent discrete GPU won.
*Would help:* pick the backend with a short benchmark on first run and cache the result, or document when to prefer `cpu`.

**4. The first prompt on GPU is always slow.**
1–2.5 s extra on the first prompt after loading, on every GPU tested.
*Would help:* a documented warm-up call, or an option to warm up during `loadModel`.

**5. Turning reasoning off depends on the model family.**
With Qwen3.6 35B-A3B, `/no_think` in the prompt was ignored: 500–990 reasoning tokens per answer, ~80 s for a one-line translation. `reasoning_budget: 0` in `modelConfig` fixed it (2.2 s). With Qwen3, `/no_think` works but leaves empty `<think></think>` tags in the output.
*Would help:* one documented switch that works across model families, and stripping empty think tags in the SDK.

**6. No prompt-cache reuse between requests.**
`cacheTokens` was 0 on every request, so a fixed system prompt is processed again each time. On slow devices this dominates TTFT (prefill at ~17 tok/s on the NUC).
*Would help:* reuse of a cached prefix across requests, or docs on how to enable it.

**7. RAM not released after unloading on integrated GPU (single observation).**
After `unloadModel` on the UHD 630, used RAM stayed at 4.2 GB, against 1.3 GB after the same run on CPU.

## Distributed inference

**8. Where delegated inference lives was hard to find.**
The 0.19.0 changelog says "Provider mode and DHT delegation are gone", and in October 2026 the SDK docs did not say where it went. *Update, 30 October 2026:* QVAC's "Local AI 101" part 4 says delegated inference is available in the separate `@qvac/core` package (devices paired by invite, encrypted peer-to-peer link). Not tested here yet.
*Would help:* a short "using another device" page that lists the options side by side: `qvac serve` over HTTP, delegated inference in `@qvac/core`, and cluster inference over the local network, with when to use each.

**9. RPC setup needs several undocumented steps.** They surfaced one error at a time:
- `startRpcServer` rejects `0.0.0.0` and needs a concrete private IPv4 address;
- the default worker has no RPC provider ("No RPC server provider registered"): it needs `rpcServerProvider` in `qvac.config.json` and `npx @qvac/cli bundle sdk`;
- the client fails with "no RPC backend registered" until `libibverbs1` is installed, on the client as well as the server, even without RDMA;
- discovery by topic took about 21 s.

*Would help:* a prerequisites list on the RPC page, and error messages that name the fix.

**10. RPC has no authentication.**
`allowNonLoopbackHost: true` exposes the server to the LAN with no authentication or encryption. A warning in the docs would help.

**11. RPC was slower than running locally.**
Qwen3 4B, gigabit LAN: 5.4 tok/s through RPC against 7.2 tok/s locally on the client. A client calling an RPC server on its own machine was even slower (~3 tok/s), so the cost is in the RPC path, not the network. The same two machines reached 13 tok/s with `qvac serve` over HTTP.
*Would help:* docs saying RPC is for pooling memory, not speed, with rough expected numbers.

## CLI server (`qvac serve`)

**12. Command syntax changed.** `qvac serve openai` is deprecated in favour of `qvac serve --openai`; older examples still use the first form.

**13. CORS blocks webview-based clients.**
- `--cors-origin` rejects `*` and `capacitor://`, so mobile apps built on Capacitor cannot be allowed directly.
- With `https://localhost` allowed, the preflight passes, but streaming responses come back without `Access-Control-Allow-Origin` (checked with curl and an `Origin` header). The webview discards them.

Native clients and curl work fine.

**14. Responses API status is unclear.** Responses carry `X-QVAC-Stub: responses-volatile`, which the docs do not explain.

**15. No `usage` in responses.** `/v1/chat/completions` does not return token counts, so clients cannot measure or display usage.

## Found while testing 0.22.0 (23 October 2026)

Two items above are partly addressed in 0.22: `modelFitPolicy: 'refuse'` gives an opt-in check before loading (item 2, not yet tested here), and `backend` accepts an ordered list (item 3). The registry error now suggests `fallbackSrc` (item 1).

**16. `backend` type differs from the release notes.** The example passes `backend: 'cuda,vulkan'`; the SDK requires an array and fails with "expected array, received string". Reported as [tetherto/qvac#5345](https://github.com/tetherto/qvac/issues/5345); confirmed by the QVAC team, who are fixing the release notes.

**17. Stats do not say which GPU backend ran.** `backendDevice` is `"gpu"` for both CUDA and Vulkan runs, so a benchmark cannot confirm the backend actually used.

**18. Registry download still fails on Windows, because of the local store.** Laya failed on the Legion with "Invalid device file, was modified", like the Qwen3 4B on 0.21; the same models downloaded fine on Linux. The 0.22 error blames the network, but the cause was the local store: renaming `%USERPROFILE%\.qvac` fixed it at once. Reported as [tetherto/qvac#5407](https://github.com/tetherto/qvac/issues/5407). The QVAC team confirmed the cause: the registry keeps a Hypercore store in `.qvac\registry-corestore` that refuses to open if it looks moved or copied. Deleting only that folder is enough (models in `.qvac\models` stay), and a fix that resets the store automatically is in review ([tetherto/qvac#5408](https://github.com/tetherto/qvac/pull/5408)).

**19. `fallbackSrc` must be byte-identical to the registry file.** A GGUF of the same model from another publisher fails with "Checksum validation failed" and no hint why. Saying "the fallback must match the registry checksum" in the error would save time.

**20. Laya confidence scales differ by checkpoint.** In a 40-request routing test, the multilingual 322M was often confidently wrong (up to 95–98%), while typed decisions 421M kept every answer below 70%, right or wrong. A note on calibration, or recommended thresholds per checkpoint, would help anyone using `decide()` for routing.

**21. Batch `decide()` was slower per request than sequential calls** (~186 ms vs ~139 ms per request, 12 states, CPU).

## What worked well

- One SDK for LLM, embeddings, speech and RAG, with the same calls on Linux and Windows.
- Models run on a Pentium without AVX.
- `fallbackSrc` made a failing registry download recoverable in one line.
- `decide()` is simple to use: a router over four intents took a few lines, at 60–240 ms per decision on a desktop CPU.
- `qvac serve` with an API key, published over Tailscale HTTPS, gave phones and Open WebUI access to a 35B MoE model on a desktop CPU at ~11 tok/s.
