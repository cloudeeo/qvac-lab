// rpc-serve.js - da lanciare sul nodo che presta la potenza di calcolo (omen01)
// Uso: DEVICE=cpu TOPIC=casa-qvac node rpc-serve.js     (Ctrl+C per fermare)
import os from 'node:os'
import * as sdk from '@qvac/sdk'

// L'SDK vuole un IPv4 privato concreto (non 0.0.0.0): lo prendo da HOST o lo trovo da solo
const privateIp = () => Object.values(os.networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address
const HOST = process.env.HOST || privateIp()
if (!HOST) { console.error('Nessun IPv4 privato trovato: imposta HOST=...'); process.exit(1) }

const TOPIC = process.env.TOPIC || 'casa-qvac'
const opts = {
  host: HOST,
  port: Number(process.env.PORT || 50052),
  allowNonLoopbackHost: true,          // necessario per accettare connessioni dalla LAN
  discoveryTopic: TOPIC,
  ...(process.env.DEVICE ? { device: process.env.DEVICE } : {}),
  ...(process.env.THREADS ? { threads: Number(process.env.THREADS) } : {}),
}
console.log('Avvio RPC server con', JSON.stringify(opts))
const info = await sdk.startRpcServer(opts)
console.log('RPC server attivo:', JSON.stringify(info))
console.log(`Topic di discovery: ${TOPIC}. Lascia aperto questo terminale; Ctrl+C per fermare.`)

const stop = async () => {
  console.log('\nArresto...')
  try { await sdk.stopRpcServer({ serverId: info.serverId }) } catch (e) { console.error(e.message) }
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
setInterval(() => {}, 1 << 30)
