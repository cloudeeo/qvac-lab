// Minimal reproduction: backend passed as a string, as in the 0.22.0 release notes
import { loadModel, unloadModel, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk'

for (const backend of ['cuda,vulkan', ['cuda', 'vulkan']]) {
  try {
    const modelId = await loadModel({
      modelSrc: LLAMA_3_2_1B_INST_Q4_0,
      modelType: 'llm',
      modelConfig: { device: 'gpu', backend },
    })
    console.log(`backend ${JSON.stringify(backend)}: loaded`)
    await unloadModel({ modelId })
  } catch (err) {
    console.log(`backend ${JSON.stringify(backend)}: failed`)
    console.log(err)
  }
}
process.exit(0)
