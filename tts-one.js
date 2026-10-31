// Speaks one sentence with Supertonic 3 (Q8_0), to isolate inputs that crash the TTS worker.
// Usage: node tts-one.js "text" [language]
import { loadModel, unloadModel, textToSpeech, TTS_MULTILINGUAL_SUPERTONIC3_Q8_0 } from '@qvac/sdk'
const text = process.argv[2]
const language = process.argv[3] || 'it'
const modelId = await loadModel({
  modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
  modelConfig: { ttsEngine: 'supertonic', language, voice: 'F1', ttsSpeed: 1.0, ttsNumInferenceSteps: 5 },
})
const r = textToSpeech({ modelId, text, inputType: 'text', stream: false })
const samples = await r.buffer
console.log(`OK  ${samples.length} samples  "${text}"`)
await unloadModel({ modelId })
process.exit(0)
