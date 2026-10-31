// Voice quality test for a local home assistant, with the QVAC SDK (0.22).
//  1. TTS: each engine speaks a set of household sentences; we time it and save the WAV files to listen to.
//  2. STT: each speech model transcribes those WAV files (and any recordings you put in voice-in/),
//     and we score it against the expected text (word error rate, WER) and time it.
//
// Usage:  node voice-test.js                     # Italian, all engines
//         LANG_CODE=fr node voice-test.js         # French sentences
//         TTS=supertonic STT=parakeet,whisper-small node voice-test.js
// Your own recordings: put 16 kHz mono WAV files in voice-in/ and, next to each, a .txt file with what you said
// (e.g. voice-in/homework.wav + voice-in/homework.txt). Phones usually record at 44.1/48 kHz: convert with
//   ffmpeg -i rec.m4a -ar 16000 -ac 1 voice-in/rec.wav
//
// Env: LANG_CODE (it | fr | en), TTS (supertonic,chatterbox), STT (whisper-small,whisper-turbo,parakeet), THREADS
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadModel, unloadModel, textToSpeech, transcribe,
  TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
  TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0, TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0,
  WHISPER_SMALL_Q8_0, WHISPER_LARGE_V3_TURBO, PARAKEET_TDT_0_6B_V3_Q8_0,
} from '@qvac/sdk'

const env = process.env
const LANG = env.LANG_CODE || 'it'
const THREADS = Number(env.THREADS || Math.min(8, os.cpus().length))
const OUT = 'voice-out'
fs.mkdirSync(OUT, { recursive: true })

// Household requests: commands, homework, news, documents, reminders, translation
const SENTENCES = {
  it: [
    'Accendi la luce in cucina e abbassa il riscaldamento a diciannove gradi.',
    'Quanto fa sette per otto? Spiegamelo come se avessi dieci anni.',
    'Quali sono le notizie principali di oggi in Svizzera?',
    "Cosa dice il contratto d'affitto sul preavviso di disdetta?",
    'Ricordami di comprare il latte domani alle otto.',
    'Aiutami a fare il riassunto del capitolo sulla rivoluzione francese.',
  ],
  fr: [
    'Allume la lumière de la cuisine et baisse le chauffage à dix-neuf degrés.',
    'Combien font sept fois huit? Explique-le comme si j’avais dix ans.',
    'Quelles sont les principales nouvelles du jour en Suisse?',
    'Rappelle-moi d’acheter du lait demain à huit heures.',
  ],
  en: [
    'Turn on the kitchen light and set the heating to nineteen degrees.',
    'What is seven times eight? Explain it as if I were ten years old.',
    'What are the main news in Switzerland today?',
    'Remind me to buy milk tomorrow at eight.',
  ],
}[LANG]
if (!SENTENCES) throw new Error('LANG_CODE must be it, fr or en')

const TTS_ENGINES = {
  supertonic: { src: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0, config: { ttsEngine: 'supertonic', language: LANG, voice: env.VOICE || 'F1', ttsSpeed: 1.0, ttsNumInferenceSteps: 5 } },
  chatterbox: { src: TTS_T3_MULTILINGUAL_CHATTERBOX_Q4_0, config: { ttsEngine: 'chatterbox', language: LANG, s3genModelSrc: TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q4_0, cfmSteps: 1, threads: THREADS } },
}
const STT_MODELS = {
  'whisper-small': { src: WHISPER_SMALL_Q8_0, config: { language: LANG, strategy: 'greedy', n_threads: THREADS, temperature: 0, translate: false, no_timestamps: true } },
  'whisper-turbo': { src: WHISPER_LARGE_V3_TURBO, config: { language: LANG, strategy: 'greedy', n_threads: THREADS, temperature: 0, translate: false, no_timestamps: true } },
  parakeet: { src: PARAKEET_TDT_0_6B_V3_Q8_0, type: 'parakeet-transcription', config: {} },
}
const pick = (list, all) => (list ? list.split(',').map((s) => s.trim()) : Object.keys(all)).filter((k) => all[k])

const progress = (p) => {
  if (p?.percentage != null) process.stdout.write(`\r  download ${p.percentage.toFixed(0)}% (${(p.downloaded / 1e6).toFixed(0)}/${(p.total / 1e6).toFixed(0)} MB)   `)
}

// --- WAV helpers: write int16 mono, read int16 mono, resample to 16 kHz for speech recognition
function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
function resample(samples, from, to) {
  if (from === to) return samples
  const out = new Int16Array(Math.floor((samples.length * to) / from))
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to, i0 = Math.floor(x), f = x - i0
    out[i] = (samples[i0] ?? 0) * (1 - f) + (samples[i0 + 1] ?? samples[i0] ?? 0) * f
  }
  return out
}

// --- Word error rate on normalised text
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return r.length ? d[r.length][h.length] / r.length : 0
}

const results = { lang: LANG, machine: `${os.cpus()[0].model.trim()} x${os.cpus().length}, ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB`, tts: [], stt: [] }
const clips = [] // { name, file, text }

// 1. TTS
for (const name of pick(env.TTS, TTS_ENGINES)) {
  const e = TTS_ENGINES[name]
  console.log(`\n=== TTS ${name} (${LANG}) ===`)
  let t = performance.now()
  const modelId = await loadModel({ modelSrc: e.src, modelConfig: e.config, onProgress: progress })
  console.log(`\n  loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  for (let i = 0; i < SENTENCES.length; i++) {
    t = performance.now()
    const r = textToSpeech({ modelId, text: SENTENCES[i], inputType: 'text', stream: false })
    const samples = await r.buffer
    const rate = (await r.sampleRate) ?? (name === 'supertonic' ? 44100 : 24000)
    const ms = performance.now() - t
    const audioS = samples.length / rate
    const file = path.join(OUT, `${LANG}-${name}-${i + 1}.wav`)
    fs.writeFileSync(file, wav(samples, rate))
    fs.writeFileSync(file.replace(/\.wav$/, '-16k.wav'), wav(resample(samples, rate, 16000), 16000))
    clips.push({ name: `${name}-${i + 1}`, file: file.replace(/\.wav$/, '-16k.wav'), text: SENTENCES[i] })
    results.tts.push({ engine: name, sentence: i + 1, synthMs: Math.round(ms), audioS: Number(audioS.toFixed(2)), rtf: Number((ms / 1000 / audioS).toFixed(2)) })
    console.log(`  ${i + 1}. ${(ms / 1000).toFixed(1)} s for ${audioS.toFixed(1)} s of audio (RTF ${(ms / 1000 / audioS).toFixed(2)})  ${file}`)
  }
  await unloadModel({ modelId })
}

// Your own recordings in voice-in/ (16 kHz mono WAV + .txt with the expected words)
for (const f of fs.existsSync('voice-in') ? fs.readdirSync('voice-in') : []) {
  if (!f.endsWith('.wav')) continue
  const txt = path.join('voice-in', f.replace(/\.wav$/, '.txt'))
  clips.push({ name: `rec:${f}`, file: path.join('voice-in', f), text: fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8').trim() : null })
}

// 2. STT
for (const name of pick(env.STT, STT_MODELS)) {
  const m = STT_MODELS[name]
  console.log(`\n=== STT ${name} ===`)
  let t = performance.now()
  const modelId = await loadModel({ modelSrc: m.src, ...(m.type ? { modelType: m.type } : {}), modelConfig: m.config, onProgress: progress })
  console.log(`\n  loaded in ${((performance.now() - t) / 1000).toFixed(1)} s`)
  for (const c of clips) {
    t = performance.now()
    const out = await transcribe({ modelId, audioChunk: c.file })
    const text = (Array.isArray(out) ? out.map((s) => s.text ?? s).join('') : String(out)).trim()
    const ms = performance.now() - t
    const w = c.text ? wer(c.text, text) : null
    results.stt.push({ model: name, clip: c.name, ms: Math.round(ms), wer: w == null ? null : Number(w.toFixed(3)), text })
    console.log(`  ${c.name.padEnd(22)} ${(ms / 1000).toFixed(2)} s  WER ${w == null ? '  -  ' : (w * 100).toFixed(0).padStart(3) + '%'}  ${text}`)
  }
  await unloadModel({ modelId })
}

// Summary
console.log('\n=== Summary ===')
for (const name of [...new Set(results.tts.map((r) => r.engine))]) {
  const rows = results.tts.filter((r) => r.engine === name)
  console.log(`TTS ${name.padEnd(14)} average RTF ${(rows.reduce((a, r) => a + r.rtf, 0) / rows.length).toFixed(2)} (below 1 = faster than real time)`)
}
for (const name of [...new Set(results.stt.map((r) => r.model))]) {
  const rows = results.stt.filter((r) => r.model === name)
  const scored = rows.filter((r) => r.wer != null)
  console.log(`STT ${name.padEnd(14)} average ${(rows.reduce((a, r) => a + r.ms, 0) / rows.length / 1000).toFixed(2)} s per clip, WER ${scored.length ? ((scored.reduce((a, r) => a + r.wer, 0) / scored.length) * 100).toFixed(1) + '%' : '-'}`)
}
const jsonFile = path.join(OUT, `voice-test-${LANG}-${os.hostname()}-${new Date().toISOString().slice(0, 10)}.json`)
fs.writeFileSync(jsonFile, JSON.stringify(results, null, 2))
console.log(`\nAll results: ${jsonFile}\nListen to the voices in ${OUT}/`)
process.exit(0)
