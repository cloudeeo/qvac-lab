// Opens the QVAC registry store on every run (tetherto/qvac#5407).
// registry-repro.js loads a cached model, and cached models skip the registry entirely,
// so it never reaches the device-file check. Listing the registry always opens the store.
import { modelRegistryList } from '@qvac/sdk'

try {
  const models = await modelRegistryList()
  console.log(`registry opened: ${Array.isArray(models) ? models.length : '?'} models listed`)
} catch (err) {
  console.log('failed')
  console.log(err)
}
process.exit(0)
