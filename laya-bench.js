// laya-bench.js - Compare Laya decision models and question phrasings on a home-assistant routing task.
// Requires @qvac/sdk >= 0.22. Runs every model x every phrasing on 40 labelled requests (10 per intent).
//
// Usage: node laya-bench.js
//        MODELS=LAYA_421M_Q8_0,LAYA_TYPED_DECISIONS_421M_Q8_0 node laya-bench.js
//        DEVICE=gpu THRESHOLD=0.7 FASTPATH=0.9 node laya-bench.js
// Output: a summary table, the confusion matrix of the best combination, and a JSON file with every prediction.
import os from 'node:os'
import fs from 'node:fs'
import * as sdk from '@qvac/sdk'
const { loadModel, decide, unloadModel, close } = sdk

const MODELS = (process.env.MODELS || 'LAYA_MULTILINGUAL_322M_Q8_0,LAYA_421M_Q8_0,LAYA_TYPED_DECISIONS_421M_Q8_0')
  .split(',').map((s) => s.trim()).filter(Boolean)
const DEVICE = process.env.DEVICE || 'cpu'
const THRESHOLD = Number(process.env.THRESHOLD || 0.7) // below this, the router asks the user
const FASTPATH = Number(process.env.FASTPATH || 0.9)   // at or above this, a command runs without calling an LLM
const INTENTS = ['action', 'search', 'document', 'chat']

const VERSIONS = {
  // v1: first attempt
  v1: {
    instructions: 'What does the user want the home assistant to do?',
    criteria: {
      action: 'control a device at home, or set a reminder or timer',
      search: 'needs current information from the internet',
      document: "a question about one of the user's own documents",
      chat: 'general conversation, writing or knowledge the assistant already has',
    },
  },
  // v2: detailed descriptions with examples
  v2: {
    instructions: 'Classify what the user is asking a home assistant to do.',
    criteria: {
      action: 'a command for the home: switch a device on or off, or set a reminder, timer or alarm',
      search: 'needs live or recent information from the internet: weather, news, sports results, traffic, prices',
      document: "a question about the user's own files: their insurance policy, contract, bills, PDFs, notes or meeting minutes",
      chat: 'anything the assistant can answer by itself: explanations, writing, maths, advice, conversation',
    },
  },
  // v3: short descriptions of similar length, no examples
  v3: {
    instructions: 'What should the home assistant do with this request?',
    criteria: {
      action: 'a command to control the home or set a reminder',
      search: 'a question that needs live information from the internet',
      document: "a question about the user's own files or notes",
      chat: 'a request answered from general knowledge or writing',
    },
  },
}

// [request, expected intent] - 10 per intent
const CASES = [
  ['Turn off the lights in the living room', 'action'],
  ['Switch off the heating in the bedroom', 'action'],
  ['Remind me to buy milk tomorrow at 8', 'action'],
  ['Set a timer for 12 minutes', 'action'],
  ['Turn the thermostat up to 21 degrees', 'action'],
  ['Open the garage door', 'action'],
  ['Wake me up at 6:30 tomorrow', 'action'],
  ['Lock the front door', 'action'],
  ['Dim the kitchen lights to 30 percent', 'action'],
  ['Start the robot vacuum', 'action'],
  ["What's the weather in Geneva tomorrow?", 'search'],
  ['Who won the Servette match last night?', 'search'],
  ['Is the A1 motorway open right now near Lausanne?', 'search'],
  ["What's the price of bitcoin right now?", 'search'],
  ['What time does the supermarket in Carouge close today?', 'search'],
  ['What is the latest news about the Swiss elections?', 'search'],
  ['Is my 8:12 train to Zurich on time?', 'search'],
  ['Which films are showing at the cinema tonight?', 'search'],
  ["What's today's euro to Swiss franc exchange rate?", 'search'],
  ['Are there storm warnings for Geneva this weekend?', 'search'],
  ['What does my car insurance policy say about windscreen damage?', 'document'],
  ['When does the rental contract I uploaded expire?', 'document'],
  ["Summarise the PDF from yesterday's meeting", 'document'],
  ['How much was my last electricity bill?', 'document'],
  ['Find the warranty for my washing machine', 'document'],
  ['What did the school letter say about the trip date?', 'document'],
  ["List the action items from my notes of Monday's call", 'document'],
  ["What's the notice period in my gym membership contract?", 'document'],
  ['Which page of my boiler manual explains the reset?', 'document'],
  ['What did I write in my notes about the garden fence?', 'document'],
  ['Explain the difference between a mortgage and a loan', 'chat'],
  ['Write me a short poem about autumn', 'chat'],
  ["What's 17% of 240?", 'chat'],
  ['Explain how a heat pump works', 'chat'],
  ['Suggest a name for a black cat', 'chat'],
  ['Translate "good morning" into Spanish', 'chat'],
  ['Give me a recipe for mushroom risotto', 'chat'],
  ['What is the capital of Australia?', 'chat'],
  ['Help me write a polite email declining an invitation', 'chat'],
  ['Tell me a joke about programmers', 'chat'],
]

const pick = (answer) => {
  const probs = answer?.probabilities || {}
  const choice = answer?.choice ?? Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0]
  return { choice, p: probs[choice] ?? 0 }
}
const pct = (x) => (100 * x).toFixed(0) + '%'

console.log(`Device: ${DEVICE} | CPU: ${os.cpus()[0].model} x${os.cpus().length} | ${CASES.length} requests | threshold ${THRESHOLD} | fast path ${FASTPATH}`)
const results = { host: os.hostname(), date: new Date().toISOString(), device: DEVICE, threshold: THRESHOLD, fastPath: FASTPATH, runs: [] }
const summary = []

try {
  for (const modelName of MODELS) {
    const src = sdk[modelName]
    if (!src) { console.log(`\nSkipping unknown model ${modelName}`); continue }
    let modelId
    try {
      const t0 = performance.now()
      modelId = await loadModel({ modelSrc: src, modelType: 'llamacpp-decision', modelConfig: { device: DEVICE } })
      console.log(`\n${modelName}: loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
    } catch (err) {
      console.log(`\n${modelName}: load failed - ${err.message}`)
      continue
    }
    for (const [version, q] of Object.entries(VERSIONS)) {
      const questions = { intent: { type: 'choice', ...q } }
      const preds = []
      for (const [text, expected] of CASES) {
        const t = performance.now()
        const r = await decide({ modelId, state: text, questions })
        const ms = performance.now() - t
        const { choice, p } = pick(r.answers.intent)
        preds.push({ text, expected, choice, p, ms })
      }
      const correct = preds.filter((x) => x.choice === x.expected).length
      const perClass = Object.fromEntries(INTENTS.map((c) => {
        const of = preds.filter((x) => x.expected === c)
        return [c, `${of.filter((x) => x.choice === c).length}/${of.length}`]
      }))
      const asked = preds.filter((x) => x.p < THRESHOLD).length
      const wrongActed = preds.filter((x) => x.p >= THRESHOLD && x.choice !== x.expected).length
      const fast = preds.filter((x) => x.choice === 'action' && x.p >= FASTPATH)
      const fastOk = fast.filter((x) => x.expected === 'action').length
      const avgMs = preds.reduce((s, x) => s + x.ms, 0) / preds.length
      summary.push({
        model: modelName.replace('_Q8_0', ''), version,
        accuracy: `${correct}/${preds.length}`, ...perClass,
        'asks user': asked, 'acts wrong': wrongActed,
        'fast path': `${fastOk} ok, ${fast.length - fastOk} wrong`,
        'avg ms': Math.round(avgMs),
      })
      results.runs.push({ model: modelName, version, correct, total: preds.length, avgMs, preds })
      process.stdout.write(`  ${version}: ${correct}/${preds.length}\n`)
    }
    await unloadModel({ modelId })
  }

  console.log('\nSummary')
  console.table(summary)

  const best = [...results.runs].sort((a, b) => b.correct - a.correct || a.avgMs - b.avgMs)[0]
  if (best) {
    console.log(`\nConfusion matrix for the best combination: ${best.model} ${best.version} (rows = expected, columns = predicted)`)
    const matrix = Object.fromEntries(INTENTS.map((e) => [e, Object.fromEntries(INTENTS.map((c) =>
      [c, best.preds.filter((x) => x.expected === e && x.choice === c).length]))]))
    console.table(matrix)
    console.log('Errors of the best combination:')
    for (const x of best.preds.filter((x) => x.choice !== x.expected)) {
      console.log(`  "${x.text}" -> ${x.choice} ${pct(x.p)} (expected ${x.expected})`)
    }
  }

  const file = `laya-bench-${os.hostname()}-${results.date.slice(0, 10)}.json`
  fs.writeFileSync(file, JSON.stringify(results, null, 2))
  console.log(`\nAll predictions saved to ${file}`)
} finally {
  await close()
}
