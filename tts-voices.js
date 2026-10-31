// Speaks the same sentence with every Supertonic 3 voice, so you can pick one for the assistant.
// Usage: node tts-voices.js ["text"]      LANG_CODE=it (default), SPEED=1.0, VOICES=F1,F2,M1 (default: F1-F5, M1-M5)
import fs from 'node:fs'
import { loadModel, unloadModel, textToSpeech, TTS_MULTILINGUAL_SUPERTONIC3_Q8_0 } from '@qvac/sdk'

const env = process.env
const lang = env.LANG_CODE || 'it'
const text = process.argv[2] || (lang === 'fr'
  ? 'Bonjour, je suis votre assistant. La lumière de la cuisine est allumée.'
  : 'Ciao, sono il vostro assistente. Ho acceso la luce in cucina e domani alle otto ti ricordo il latte.')
const voices = (env.VOICES || 'F1,F2,F3,F4,F5,M1,M2,M3,M4,M5').split(',')
fs.mkdirSync('voice-out', { recursive: true })

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

for (const voice of voices) {
  try {
    const modelId = await loadModel({
      modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
      modelConfig: { ttsEngine: 'supertonic', language: lang, voice, ttsSpeed: Number(env.SPEED || 1.0), ttsNumInferenceSteps: 5 },
    })
    const r = textToSpeech({ modelId, text, inputType: 'text', stream: false })
    const samples = await r.buffer
    const rate = (await r.sampleRate) ?? 44100
    const file = `voice-out/voice-${lang}-${voice}.wav`
    fs.writeFileSync(file, wav(samples, rate))
    console.log(`${voice}: ${file}`)
    await unloadModel({ modelId })
  } catch (err) {
    console.log(`${voice}: not available (${err.message.split('\n')[0]})`)
  }
}
process.exit(0)
