// Text-to-video smoke test with the QVAC SDK (0.22): Wan 2.1 T2V 1.3B or Wan 2.2 TI2V 5B Turbo.
// Both use a split layout: diffusion model + UMT5-XXL text encoder (~11 GB fp16) + VAE.
// The SDK examples ask for 16 GB of video memory or 20 GB of unified memory; offload_to_cpu lets
// a smaller GPU try, slower.
//
// Usage (PowerShell):
//   node video-test.js                                   # Wan 2.1 1.3B, small and short: a smoke test
//   $env:MODEL="wan22"; node video-test.js               # Wan 2.2 TI2V 5B Turbo, 4 steps
//   $env:FRAMES="33"; $env:WIDTH="480"; $env:HEIGHT="832"; node video-test.js
// Env: MODEL (wan21 | wan22), PROMPT, WIDTH, HEIGHT, FRAMES (4k+1), STEPS, FPS, SEED, DEVICE (gpu | cpu), OUT,
//      MAX_VRAM (GiB budget; negative = headroom to keep free; 0 = off; default -1), VERBOSITY (0-2),
//      VAE_CPU (1 = decode frames on the CPU, default; 0 = GPU)
import fs from 'node:fs'
import os from 'node:os'
import {
  loadModel, unloadModel, video,
  WAN2_1_T2V_1_3B_FP16, WAN2_2_TI2V_5B_Q5_K_S, UMT5_XXL_FP16,
  WAN_2_1_COMFYUI_REPACKAGED_VAE, WAN_2_2_COMFYUI_REPACKAGED_VAE,
} from '@qvac/sdk'

const env = process.env
const which = env.MODEL || 'wan21'
const PRESETS = {
  // Wan 2.1 1.3B: sizes in multiples of 16, flow_shift 3 for visible motion, ~30 steps
  wan21: { src: WAN2_1_T2V_1_3B_FP16, vae: WAN_2_1_COMFYUI_REPACKAGED_VAE, width: 320, height: 576, frames: 17, steps: 20, cfg: 6.0, shift: 3.0, fps: 16,
    prompt: 'a colorful bird flapping its wings over a green meadow, camera slowly panning' },
  // Wan 2.2 TI2V 5B Turbo: sizes in multiples of 32, distilled for 4 steps with guidance off
  wan22: { src: WAN2_2_TI2V_5B_Q5_K_S, vae: WAN_2_2_COMFYUI_REPACKAGED_VAE, width: 352, height: 640, frames: 49, steps: 4, cfg: 1.0, shift: 5.0, fps: 24,
    prompt: 'a white porcelain espresso cup on a dark wooden table, steam curling upward, slow circular camera move, warm morning light' },
}
const p = PRESETS[which]
if (!p) throw new Error(`MODEL must be one of: ${Object.keys(PRESETS).join(', ')}`)

const cfg = {
  prompt: env.PROMPT || p.prompt,
  width: Number(env.WIDTH || p.width),
  height: Number(env.HEIGHT || p.height),
  frames: Number(env.FRAMES || p.frames),
  steps: Number(env.STEPS || p.steps),
  fps: Number(env.FPS || p.fps),
  seed: Number(env.SEED || 42),
  device: env.DEVICE || 'gpu',
}
if ((cfg.frames - 1) % 4 !== 0) throw new Error('FRAMES must be 4k+1 (17, 33, 49, 65, 81...)')

const gb = (n) => (n / 1024 ** 3).toFixed(1)
const used = () => gb(os.totalmem() - os.freemem())
console.log(`Model: ${which} | ${cfg.width}x${cfg.height} | ${cfg.frames} frames at ${cfg.fps} fps (${(cfg.frames / cfg.fps).toFixed(1)} s) | ${cfg.steps} steps | device ${cfg.device}`)
console.log(`CPU: ${os.cpus()[0].model} x${os.cpus().length} | RAM ${gb(os.totalmem())} GB, used before load ${used()} GB`)

let t = performance.now()
const modelId = await loadModel({
  modelSrc: p.src,
  modelType: 'sdcpp-generation',
  modelConfig: {
    mode: 'video',
    device: cfg.device,
    threads: 4,
    t5XxlModelSrc: UMT5_XXL_FP16,
    vaeModelSrc: p.vae,
    diffusion_fa: true,
    offload_to_cpu: true,
    ...(which === 'wan21' ? { params_backend: 'vae=cpu' } : {}),
    // Decode frames on the CPU: on an 8 GB GPU the Wan 2.2 VAE decode crashed the worker (0xC0000005)
    // right after the 4 denoising steps. VAE_CPU=0 runs it on the GPU again.
    ...(env.VAE_CPU !== '0' ? { backend: 'vae=cpu' } : {}),
    vae_tiling: true,
    // 8 GB laptop GPUs: cut the graph into segments that fit the free VRAM (negative = keep that many GiB free)
    // and stream diffusion layers from CPU RAM. MAX_VRAM=0 turns segmenting off.
    max_vram: Number(env.MAX_VRAM ?? -1),
    stream_layers: Number(env.MAX_VRAM ?? -1) !== 0,
    verbosity: Number(env.VERBOSITY ?? 2),
  },
  onProgress: (x) => {
    if (x?.percentage != null) process.stdout.write(`\rdownload ${x.percentage.toFixed(0)}% (${(x.downloaded / 1e9).toFixed(2)} / ${(x.total / 1e9).toFixed(2)} GB)   `)
  },
})
console.log(`\nLoaded in ${((performance.now() - t) / 1000).toFixed(1)} s | RAM used ${used()} GB`)

t = performance.now()
let last = t
const { progressStream, outputs, stats } = video({
  modelId,
  mode: 'txt2vid',
  prompt: cfg.prompt,
  negative_prompt: 'blurry, low quality, static, jittery, flickering, watermark, text',
  width: cfg.width,
  height: cfg.height,
  video_frames: cfg.frames,
  fps: cfg.fps,
  steps: cfg.steps,
  cfg_scale: p.cfg,
  flow_shift: p.shift,
  seed: cfg.seed,
  vae_tiling: true,
})
for await (const { step, totalSteps } of progressStream) {
  const now = performance.now()
  console.log(`step ${step}/${totalSteps}  ${((now - last) / 1000).toFixed(1)} s  (total ${((now - t) / 1000).toFixed(0)} s)`)
  last = now
}
const buffers = await outputs
const genS = (performance.now() - t) / 1000
const out = env.OUT || `video-${which}-${cfg.width}x${cfg.height}-${cfg.frames}f.avi`
fs.writeFileSync(out, buffers[0])
console.log(`\nGenerated in ${genS.toFixed(0)} s (${(genS / 60).toFixed(1)} min) | peak RAM seen ${used()} GB | saved ${out}`)
console.log('Stats:', await stats)
await unloadModel({ modelId, clearStorage: false })
process.exit(0)
