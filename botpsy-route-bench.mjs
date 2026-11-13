// BotPsy routing benchmark through `qvac serve` (OpenAI-compatible API, tool calling).
//
// The 40 labelled cases below are the same as in home-router/scripts/route-eval.js
// and qvac-022/laya-bench.js, so the results are comparable with the Laya benchmark.
//
// Each intent maps to a tool: control_device -> action, web_search -> search,
// search_documents -> document, no tool call -> chat.
// Two modes are measured: think (reasoning on) and nothink (reasoning_budget 0).
// One warm-up request per mode is sent first and not counted.
//
// Usage: node botpsy-route-bench.mjs
// Env: URL (default http://127.0.0.1:11434/v1/chat/completions), MODEL (default botpsy),
//      KEY_FILE (default ./api-key.txt), OUT (default botpsy-route-bench-omen01),
//      CASES_FILE (JSON array of [text, intent]; default the built-in English cases)
// The API key is read from the file and never printed.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import os from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const URL = process.env.URL || 'http://127.0.0.1:11434/v1/chat/completions'
const MODEL = process.env.MODEL || 'botpsy'
const KEY_FILE = process.env.KEY_FILE || join(HERE, 'api-key.txt')
const OUT = process.env.OUT || 'botpsy-route-bench-omen01'
const KEY = readFileSync(KEY_FILE, 'utf8').trim()

// Same 40 cases as home-router/scripts/route-eval.js (copied verbatim).
const CASES_EN = [
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
// CASES_FILE: optional JSON array of [text, intent] pairs replacing the built-in English cases.
const CASES_FILE = process.env.CASES_FILE || ''
const CASES = CASES_FILE ? JSON.parse(readFileSync(CASES_FILE, 'utf8')) : CASES_EN
const CASES_LABEL = CASES_FILE ? `file ${CASES_FILE}` : 'built-in English cases'
const INTENTS = ['action', 'search', 'document', 'chat']

const SYSTEM = 'You are a home assistant. Call a tool when one fits the request; otherwise answer directly.'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'control_device',
      description: 'Control a smart home device or set a reminder, timer or alarm.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', enum: ['lights', 'heating', 'garage', 'door', 'vacuum', 'reminder'] },
          action: { type: 'string', description: 'What to do, e.g. on, off, open, lock, set, start.' },
          room: { type: 'string' },
          value: { type: 'string', description: 'Optional value, e.g. a temperature, a percentage, a time or a reminder text.' },
        },
        required: ['device', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for live or public information: weather, news, prices, opening hours, facts about the world.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description: "Search the user's own uploaded files and notes: contracts, bills, manuals, meeting notes.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
]
const TOOL_TO_INTENT = { control_device: 'action', web_search: 'search', search_documents: 'document' }

const MODES = {
  think: { reasoning_budget: -1, chat_template_kwargs: { enable_thinking: true } },
  nothink: { reasoning_budget: 0, chat_template_kwargs: { enable_thinking: false } },
}

// Lenient expected device for action cases, from keywords in the text (for the report only).
function expectedDevice(text) {
  // English and Italian keywords.
  const t = text.toLowerCase()
  if (t.includes('light') || t.includes('luci')) return 'lights'
  if (t.includes('heating') || t.includes('thermostat') || t.includes('riscaldamento') || t.includes('termostato')) return 'heating'
  if (t.includes('garage')) return 'garage'
  if (t.includes('door') || t.includes('porta')) return 'door'
  if (t.includes('vacuum') || t.includes('aspirapolvere')) return 'vacuum'
  if (t.includes('remind') || t.includes('timer') || t.includes('wake') || t.includes('ricordami') || t.includes('svegliami')) return 'reminder'
  return null
}

function parseArgs(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return { _raw: String(raw) } }
}

async function ask(text, mode) {
  const body = {
    model: MODEL,
    stream: false,
    max_tokens: 2048,
    temperature: 0.3,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 1.5,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text },
    ],
    tools: TOOLS,
    ...MODES[mode],
  }
  const t0 = performance.now()
  let res, json, error = null
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    })
    const txt = await res.text()
    try { json = JSON.parse(txt) } catch { json = null }
    if (!res.ok) error = `HTTP ${res.status}: ${txt.slice(0, 300)}`
  } catch (e) {
    error = String(e?.message || e)
  }
  const ms = Math.round(performance.now() - t0)
  const msg = json?.choices?.[0]?.message || {}
  const calls = (msg.tool_calls || []).map((c) => ({ name: c.function?.name, args: parseArgs(c.function?.arguments) }))
  const first = calls[0] || null
  const content = typeof msg.content === 'string' ? msg.content : ''
  return {
    ms,
    error,
    calls,
    toolName: first?.name ?? null,
    args: first?.args ?? null,
    content: content.slice(0, 400),
    // Flag tool calls that leaked into the text instead of tool_calls (scored as chat anyway).
    toolCallInContent: /<tool_call>|"name"\s*:\s*"(control_device|web_search|search_documents)"/.test(content),
    reasoningChars: (msg.reasoning_content || msg.reasoning || '').length,
    finishReason: json?.choices?.[0]?.finish_reason ?? null,
    completionTokens: json?.usage?.completion_tokens ?? null,
  }
}

const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
const mean = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null)

const lines = []
const log = (s = '') => { console.log(s); lines.push(s) }

const started = new Date()
log(`BotPsy routing benchmark - ${started.toISOString()}`)
log(`Host: ${os.hostname()} | model: ${MODEL} | endpoint: local qvac serve`)
log('Sampling: temperature 0.3, top_p 0.95, top_k 20, presence_penalty 1.5, max_tokens 2048, stream false')
log(`Cases: ${CASES.length} from ${CASES_LABEL}` + (CASES_FILE ? '' : ' (same as home-router/scripts/route-eval.js and qvac-022/laya-bench.js)'))
log()

const allRows = []
const summary = {}

for (const mode of Object.keys(MODES)) {
  log(`=== Mode: ${mode} ===`)
  const w = await ask('Hello, are you there?', mode)
  log(`Warm-up (not counted): ${w.ms} ms${w.error ? ' ERROR ' + w.error : ''}`)

  const rows = []
  for (let i = 0; i < CASES.length; i++) {
    const [text, expected] = CASES[i]
    const r = await ask(text, mode)
    const predicted = r.error ? 'error' : r.toolName ? (TOOL_TO_INTENT[r.toolName] || `unknown:${r.toolName}`) : 'chat'
    const row = { mode, i: i + 1, text, expected, predicted, correct: predicted === expected, ...r }
    if (expected === 'action') {
      row.expectedDevice = expectedDevice(text)
      row.device = r.toolName === 'control_device' ? (r.args?.device ?? null) : null
    }
    rows.push(row)
    allRows.push(row)
    console.log(`[${mode} ${i + 1}/${CASES.length}] ${row.correct ? 'ok ' : 'NO '} ${expected} -> ${predicted} ${r.ms} ms ${r.completionTokens ?? '-'} tok | ${text}`)
  }

  const ok = rows.filter((r) => r.correct).length
  const ms = rows.filter((r) => !r.error).map((r) => r.ms)
  const tok = rows.map((r) => r.completionTokens).filter((x) => typeof x === 'number')
  const perIntent = Object.fromEntries(INTENTS.map((k) => {
    const sub = rows.filter((r) => r.expected === k)
    return [k, `${sub.filter((r) => r.correct).length}/${sub.length}`]
  }))
  const action = rows.filter((r) => r.expected === 'action')
  const deviceRight = action.filter((r) => r.device && r.device === r.expectedDevice).length
  const s = {
    accuracy: `${ok}/${rows.length}`,
    perIntent,
    medianMs: median(ms),
    meanMs: mean(ms),
    medianCompletionTokens: median(tok),
    meanCompletionTokens: mean(tok),
    errors: rows.filter((r) => r.error).length,
    toolCallInContent: rows.filter((r) => r.toolCallInContent).length,
    actionDeviceRight: `${deviceRight}/${action.length}`,
  }
  summary[mode] = s

  log()
  log(`Accuracy: ${s.accuracy}  |  action ${perIntent.action}, search ${perIntent.search}, document ${perIntent.document}, chat ${perIntent.chat}`)
  log(`Wall time: median ${s.medianMs} ms, mean ${s.meanMs} ms`)
  log(`Completion tokens: median ${s.medianCompletionTokens ?? '-'}, mean ${s.meanCompletionTokens ?? '-'}`)
  log(`HTTP/transport errors: ${s.errors}  |  tool calls leaked into text: ${s.toolCallInContent}`)
  log()
  log('Wrong routes:')
  const wrong = rows.filter((r) => !r.correct)
  if (!wrong.length) log('  (none)')
  for (const r of wrong) {
    log(`  - "${r.text}" expected ${r.expected}, got ${r.predicted}` +
      (r.toolName ? ` [${r.toolName} ${JSON.stringify(r.args)}]` : '') +
      (r.error ? ` [${r.error}]` : '') +
      (!r.toolName && !r.error ? ` [text: ${JSON.stringify(r.content.slice(0, 120))}]` : ''))
  }
  log()
  log(`Action cases, device chosen (lenient auto-check ${s.actionDeviceRight}; verify by eye):`)
  for (const r of action) {
    const mark = r.device == null ? '--' : r.device === r.expectedDevice ? 'ok' : '??'
    log(`  ${mark} device=${r.device ?? '(no control_device call)'}  args=${JSON.stringify(r.args)}  | ${r.text}`)
  }
  log()
}

log('=== Summary ===')
for (const [mode, s] of Object.entries(summary)) {
  log(`${mode.padEnd(8)} accuracy ${s.accuracy} (action ${s.perIntent.action}, search ${s.perIntent.search}, document ${s.perIntent.document}, chat ${s.perIntent.chat}), median ${s.medianMs} ms, mean ${s.meanMs} ms, devices ${s.actionDeviceRight}`)
}
log(`Total run time: ${Math.round((Date.now() - started.getTime()) / 1000)} s (single run)`)

writeFileSync(join(HERE, `${OUT}.txt`), lines.join('\n') + '\n')
writeFileSync(join(HERE, `${OUT}.json`), JSON.stringify({ started: started.toISOString(), model: MODEL, cases: CASES_LABEL, summary, rows: allRows }, null, 2) + '\n')
console.log(`\nWrote ${OUT}.txt and ${OUT}.json`)
