// laya-test.js - Laya (QVAC SDK >= 0.22): a small model that makes decisions instead of writing text.
// Experiment: use it as the router of a home assistant, before calling an LLM.
// Compares two phrasings of the same questions (v1 = first attempt, v2 = clearer criteria).
//
// Usage: node laya-test.js                         (multilingual Laya 322M Q8_0, CPU)
//        MODEL=LAYA_421M_Q8_0 DEVICE=gpu node laya-test.js
//        FALLBACK=<url or path>   alternate source if the registry download fails (must match the registry file)
//        SRC=<url or path>        load a GGUF directly, bypassing the registry
//        THRESHOLD=0.7            below this confidence the router asks the user instead of acting
import os from 'node:os'
import * as sdk from '@qvac/sdk'
const { loadModel, decide, unloadModel, close } = sdk

const MODEL_NAME = process.env.MODEL || 'LAYA_MULTILINGUAL_322M_Q8_0'
const MODEL = process.env.SRC || sdk[MODEL_NAME]
if (!MODEL) { console.error(`Unknown model: ${MODEL_NAME}`); process.exit(1) }
if (typeof decide !== 'function') { console.error('decide() not found: @qvac/sdk >= 0.22 is required'); process.exit(1) }
const THRESHOLD = Number(process.env.THRESHOLD || 0.7)

const V1 = {
  intent: {
    type: 'choice',
    instructions: 'What does the user want the home assistant to do?',
    criteria: {
      action: 'control a device at home, or set a reminder or timer',
      search: 'needs current information from the internet',
      document: "a question about one of the user's own documents",
      chat: 'general conversation, writing or knowledge the assistant already has',
    },
  },
  needsWeb: { type: 'noul', instructions: 'Answering requires up-to-date information from the internet.' },
}

const V2 = {
  intent: {
    type: 'choice',
    instructions: 'Classify what the user is asking a home assistant to do.',
    criteria: {
      action: 'a command for the home: switch a device on or off, or set a reminder, timer or alarm',
      search: 'needs live or recent information from the internet: weather, news, sports results, traffic, prices',
      document: "a question about the user's own files: their insurance policy, contract, bills, PDFs, notes or meeting minutes",
      chat: 'anything the assistant can answer by itself: explanations, writing, maths, advice, conversation',
    },
  },
  needsWeb: {
    type: 'noul',
    instructions: "To answer, the assistant must look up live or recent information on the internet, not in the user's own files.",
  },
}

// [request, expected intent]
const CASES = [
  ['Turn off the lights in the living room', 'action'],
  ['Switch off the heating in the bedroom', 'action'],
  ['Remind me to buy milk tomorrow at 8', 'action'],
  ["What's the weather in Geneva tomorrow?", 'search'],
  ['Who won the Servette match last night?', 'search'],
  ['Is the A1 motorway open right now near Lausanne?', 'search'],
  ['What does my car insurance policy say about windscreen damage?', 'document'],
  ['When does the rental contract I uploaded expire?', 'document'],
  ["Summarise the PDF from yesterday's meeting", 'document'],
  ['Explain the difference between a mortgage and a loan', 'chat'],
  ['Write me a short poem about autumn', 'chat'],
  ["What's 17% of 240?", 'chat'],
]

const pct = (x) => (typeof x === 'number' ? (100 * x).toFixed(0) + '%' : '-')
const pick = (answer) => {
  const probs = answer?.probabilities || {}
  const choice = answer?.choice ?? Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0]
  return { choice, p: probs[choice] }
}

console.log(`Model: ${process.env.SRC || MODEL_NAME} | device: ${process.env.DEVICE || 'cpu'} | CPU: ${os.cpus()[0].model} x${os.cpus().length} | threshold: ${THRESHOLD}`)
let t = performance.now()
const modelId = await loadModel({
  modelSrc: MODEL,
  ...(process.env.FALLBACK ? { fallbackSrc: process.env.FALLBACK } : {}),
  modelType: 'llamacpp-decision',
  modelConfig: { device: process.env.DEVICE || 'cpu' },
  onProgress: (p) => process.stdout.write(`\rdownload/load: ${JSON.stringify(p).slice(0, 80)}   `),
})
console.log(`\nLoad time: ${((performance.now() - t) / 1000).toFixed(1)} s`)

try {
  const rows = []
  const score = { v1: 0, v2: 0, v1ms: 0, v2ms: 0, v2asked: 0, v2wrongActed: 0 }
  for (const [text, expected] of CASES) {
    t = performance.now()
    const r1 = await decide({ modelId, state: text, questions: V1 })
    score.v1ms += performance.now() - t
    t = performance.now()
    const r2 = await decide({ modelId, state: text, questions: V2 })
    const ms2 = performance.now() - t
    score.v2ms += ms2
    const a1 = pick(r1.answers.intent)
    const a2 = pick(r2.answers.intent)
    if (a1.choice === expected) score.v1++
    if (a2.choice === expected) score.v2++
    const confident = a2.p >= THRESHOLD
    if (!confident) score.v2asked++
    if (confident && a2.choice !== expected) score.v2wrongActed++
    rows.push({
      request: text.slice(0, 40),
      expected,
      v1: `${a1.choice} ${pct(a1.p)}`,
      v2: `${a2.choice} ${pct(a2.p)}`,
      'v1 ok': a1.choice === expected ? 'yes' : 'NO',
      'v2 ok': a2.choice === expected ? 'yes' : 'NO',
      'v2 route': confident ? a2.choice : 'ask user',
      'web v1': pct(r1.answers.needsWeb?.noul),
      'web v2': pct(r2.answers.needsWeb?.noul),
      'v2 ms': Math.round(ms2),
    })
  }
  console.table(rows)
  const n = CASES.length
  console.log(`Correct intent: v1 ${score.v1}/${n}, v2 ${score.v2}/${n}`)
  console.log(`Average latency per request: v1 ${Math.round(score.v1ms / n)} ms, v2 ${Math.round(score.v2ms / n)} ms`)
  console.log(`v2 with threshold ${THRESHOLD}: asks the user ${score.v2asked}/${n} times, acts on a wrong intent ${score.v2wrongActed}/${n} times`)

  t = performance.now()
  const batch = await decide({ modelId, states: CASES.map((c) => c[0]), questions: V2 })
  const msBatch = performance.now() - t
  console.log(`v2 batch of ${n}: ${Math.round(msBatch)} ms total, ${Math.round(msBatch / n)} ms per request`)
  console.log(`Batch result is ${Array.isArray(batch) ? `an array of ${batch.length}` : 'a single object'}`)
} finally {
  await unloadModel({ modelId })
  await close()
}
