// Minimal reproduction: registry download of a Laya model on Windows
import { loadModel, unloadModel, LAYA_TYPED_DECISIONS_421M_Q8_0 } from '@qvac/sdk'

try {
  const modelId = await loadModel({
    modelSrc: LAYA_TYPED_DECISIONS_421M_Q8_0,
    modelType: 'llamacpp-decision',
    modelConfig: { device: 'cpu' },
    onProgress: (p) => process.stdout.write(`\rprogress: ${JSON.stringify(p).slice(0, 100)}   `),
  })
  console.log('\nloaded')
  await unloadModel({ modelId })
} catch (err) {
  console.log('\nfailed')
  console.log(err)
}
process.exit(0)
