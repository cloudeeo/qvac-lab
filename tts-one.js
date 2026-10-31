// Speaks one or more sentences with Supertonic 3 (Q8_0) in the same loaded model, to isolate what crashes the TTS worker.
// Usage: node tts-one.js "text 1" ["text 2" ...]     LANG_CODE=it (default)
import { loadModel, unloadModel, textToSpeech, TTS_MULTILINGUAL_SUPERTONIC3_Q8_0 } from '@qvac/sdk'
const texts = process.argv.slice(2)
const language = process.env.LANG_CODE || 'it'
const modelId = await loadModel({
  modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
  modelConfig: { ttsEngine: 'supertonic', language, voice: 'F1', ttsSpeed: 1.0, ttsNumInferenceSteps: 5 },
})
for (const [i, text] of texts.entries()) {
  console.log(`START ${i + 1} "${text}"`)
  const r = textToSpeech({ modelId, text, inputType: 'text', stream: false })
  const samples = await r.buffer
  console.log(`OK    ${i + 1} ${samples.length} samples`)
}
await unloadModel({ modelId })
process.exit(0)
