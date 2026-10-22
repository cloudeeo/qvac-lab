// rpc-client.js - da lanciare sul nodo che chiede aiuto (es. chiaminer01 o Legion)
// Uso: TOPIC=casa-qvac node rpc-client.js
//      SERVER=<ip-del-server>:50052 node rpc-client.js   (salta la discovery)
// Stesse variabili di measure.js: MODEL, FALLBACK, NOTHINK
import os from 'node:os'
import * as sdk from '@qvac/sdk'
const { loadModel, completion, unloadModel } = sdk

const TOPIC = process.env.TOPIC || 'casa-qvac'
const MODEL_NAME = process.env.MODEL || 'LLAMA_3_2_1B_INST_Q4_0'
const MODEL = sdk[MODEL_NAME]
if (!MODEL) { console.error(`Modello sconosciuto: ${MODEL_NAME}`); process.exit(1) }
const SUFFIX = process.env.NOTHINK ? ' /no_think' : ''
const PROMPTS = [
  'Explain in two sentences what a KV cache is in LLM inference.',
  'Write a short shopping list for a family dinner for four people.',
  'Translate into Italian: "The meeting is moved to Thursday at 3 pm."',
]
const strip = (u) => u.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '')

let servers
let t = performance.now()
if (process.env.SERVER) {
  servers = [{ url: process.env.SERVER, rdmaAvailable: false, devices: [] }]
  console.log(`Server indicato a mano: ${process.env.SERVER}`)
} else {
  console.log(`Cerco server RPC sul topic "${TOPIC}"...`)
  servers = await sdk.discoverRpcServers({ topic: TOPIC, timeoutMs: 20000 })
  console.log(`Discovery: ${((performance.now() - t) / 1000).toFixed(1)} s ->`, JSON.stringify(servers))
  if (!servers.length) { console.error('Nessun server trovato.'); process.exit(1) }
}
const endpoints = servers.map((s) => (process.env.SERVER ? s.url : s.url)).join(',')
let devicesOpt = {}
try {
  const map = sdk.getRpcDeviceMap(servers)
  console.log('Mappa dispositivi:', JSON.stringify(map))
  if (map.length) devicesOpt = { devices: map.map((d) => d.alias).join(',') }
} catch (e) { console.log('getRpcDeviceMap non disponibile:', e.message) }

const modelConfig = { device: 'gpu', 'rpc-servers': endpoints, ...devicesOpt, 'split-mode': 'layer' }
console.log('modelConfig:', JSON.stringify(modelConfig))
t = performance.now()
const modelId = await loadModel({
  modelSrc: MODEL,
  ...(process.env.FALLBACK ? { fallbackSrc: process.env.FALLBACK } : {}),
  modelType: 'llm',
  modelConfig,
  onProgress: (p) => process.stdout.write(`\rload: ${JSON.stringify(p).slice(0, 80)}   `),
})
console.log(`\nCaricamento (con invio dei pesi al server): ${((performance.now() - t) / 1000).toFixed(1)} s`)

for (const prompt of PROMPTS) {
  const result = completion({ modelId, history: [{ role: 'user', content: prompt + SUFFIX }], stream: true })
  let text = ''
  for await (const tok of result.tokenStream) text += tok
  console.log(`\n> ${prompt}\n${text.trim()}\nstats SDK: ${JSON.stringify(await result.stats)}`)
}
await unloadModel({ modelId })
console.log(`Client: ${os.hostname()} | RAM usata ${((os.totalmem() - os.freemem()) / 1e9).toFixed(2)} GB`)
