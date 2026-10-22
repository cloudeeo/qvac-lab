// http-bench.js - misura un server compatibile OpenAI (es. "qvac serve openai" su omen01)
// Non richiede l'SDK QVAC: solo Node 18+ (fetch). Funziona da qualunque macchina della rete.
// Uso: node --env-file=.env http-bench.js   (URL, KEY, MODEL nel file .env; vedi .env.example)
import os from 'node:os'

const URL_BASE = (process.env.URL || 'http://localhost:11434').replace(/\/$/, '')
const KEY = process.env.KEY || ''
const MODEL = process.env.MODEL || 'qwen4b'
const SUFFIX = process.env.NOTHINK ? ' /no_think' : ''
const PROMPTS = [
  'Explain in two sentences what a KV cache is in LLM inference.',
  'Write a short shopping list for a family dinner for four people.',
  'Translate into Italian: "The meeting is moved to Thursday at 3 pm."',
]
const headers = { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) }

console.log(`Client: ${os.hostname()} -> ${URL_BASE} | modello: ${MODEL}`)
const m = await fetch(`${URL_BASE}/v1/models`, { headers })
console.log(`GET /v1/models -> ${m.status}: ${(await m.text()).slice(0, 300)}`)

const rows = []
for (const prompt of PROMPTS) {
  const t0 = performance.now()
  const res = await fetch(`${URL_BASE}/v1/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: MODEL, stream: true, messages: [{ role: 'user', content: prompt + SUFFIX }] }),
  })
  if (!res.ok) { console.log(`ERRORE ${res.status}: ${await res.text()}`); continue }
  const ctype = res.headers.get('content-type') || ''
  let ttft = null, chunks = 0, text = '', usage = null
  if (ctype.includes('text/event-stream')) {
    const dec = new TextDecoder(); let buf = ''
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const j = JSON.parse(data)
          const d = j.choices?.[0]?.delta?.content ?? ''
          if (d) { if (ttft === null) ttft = performance.now() - t0; chunks++; text += d }
          if (j.usage) usage = j.usage
        } catch {}
      }
    }
  } else {
    const j = await res.json(); text = j.choices?.[0]?.message?.content ?? ''; usage = j.usage
    console.log('(risposta non in streaming: TTFT non misurabile)')
  }
  const totalS = (performance.now() - t0) / 1000
  const genS = ttft !== null ? totalS - ttft / 1000 : totalS
  const toks = usage?.completion_tokens ?? chunks
  rows.push({ prompt: prompt.slice(0, 35), 'TTFT (ms)': ttft !== null ? Math.round(ttft) : '-', token: toks, 'token/s': (toks / genS).toFixed(1), 'totale (s)': totalS.toFixed(1) })
  console.log(`\n> ${prompt}\n${text.trim()}\nusage: ${JSON.stringify(usage)}`)
}
console.table(rows)
