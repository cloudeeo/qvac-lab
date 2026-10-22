// measure.js - prima misura QVAC sul NUC
// Uso: node measure.js            (modello di default: Llama 3.2 1B Q4_0)
// Misura: tempo di caricamento, time-to-first-token (TTFT), token/s, RAM.
import os from 'node:os'
import * as sdk from '@qvac/sdk'
const { loadModel, completion, unloadModel } = sdk

const MODEL_NAME = process.env.MODEL || 'LLAMA_3_2_1B_INST_Q4_0'
const MODEL = sdk[MODEL_NAME]
if (!MODEL) { console.error(`Modello sconosciuto: ${MODEL_NAME}`); process.exit(1) }
const SUFFIX = process.env.NOTHINK ? ' /no_think' : ''
const PROMPTS = [
  'Explain in two sentences what a KV cache is.',
  'Write a short shopping list for a family dinner for four people.',
  'Translate into Italian: "The meeting is moved to Thursday at 3 pm."',
]

const gb = (b) => (b / 1e9).toFixed(2)
const usedRam = () => gb(os.totalmem() - os.freemem())

console.log(`Modello: ${MODEL_NAME} | device: ${process.env.DEVICE || 'gpu'}${SUFFIX}`)
console.log(`CPU: ${os.cpus()[0].model} x${os.cpus().length} | RAM totale ${gb(os.totalmem())} GB | usata prima del load ${usedRam()} GB`)

let t = performance.now()
const modelId = await loadModel({
  modelSrc: MODEL,
  ...(process.env.FALLBACK ? { fallbackSrc: process.env.FALLBACK } : {}),
  modelType: 'llm',
  modelConfig: { device: process.env.DEVICE || 'gpu', ...(process.env.REASONING !== undefined ? { reasoning_budget: Number(process.env.REASONING) } : {}) },
  onProgress: (p) => process.stdout.write(`\rdownload/load: ${JSON.stringify(p).slice(0, 80)}   `),
})
const loadS = (performance.now() - t) / 1000
console.log(`\nCaricamento: ${loadS.toFixed(1)} s | RAM usata dopo il load ${usedRam()} GB`)

const rows = []
for (const prompt of PROMPTS) {
  t = performance.now()
  const result = completion({ modelId, history: [{ role: 'user', content: prompt + SUFFIX }], stream: true })
  let ttft = null
  let chunks = 0
  let text = ''
  for await (const tok of result.tokenStream) {
    if (ttft === null) ttft = performance.now() - t
    chunks++
    text += tok
  }
  const totalS = (performance.now() - t) / 1000
  const genS = totalS - ttft / 1000
  const stats = await result.stats
  rows.push({
    prompt: prompt.slice(0, 40),
    'TTFT (ms)': Math.round(ttft),
    'token': chunks,
    'token/s': (chunks / genS).toFixed(1),
    'totale (s)': totalS.toFixed(1),
  })
  console.log(`\n> ${prompt}\n${text.trim()}\nstats SDK: ${JSON.stringify(stats)}`)
}

console.log(`\nRAM usata durante l'inferenza: ${usedRam()} GB`)
console.table(rows)
await unloadModel({ modelId })
console.log(`Dopo unload: RAM usata ${usedRam()} GB`)
