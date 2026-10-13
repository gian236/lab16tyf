// peer.js – Lab 16, Partes A + B
// Hyperswarm: join al topic de clase + mensaje P2P
//
// Uso:
//   node peer.js --carnet 20230117
//   node peer.js --carnet 20230005

import Hyperswarm from 'hyperswarm'
import fs from 'fs'
import path from 'path'
import { topic, SEED } from './topic.js'

// ── argumentos ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const idx = args.indexOf('--carnet')
if (idx === -1 || !args[idx + 1]) {
  console.error('Uso: node peer.js --carnet <carnet>')
  process.exit(1)
}
const MY_CARNET = args[idx + 1]

// ── logging ───────────────────────────────────────────────────────────
fs.mkdirSync('logs', { recursive: true })
const logPath = path.join('logs', `peer-${MY_CARNET}.log`)
const logStream = fs.createWriteStream(logPath, { flags: 'a' })

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`
  console.log(line)
  logStream.write(line + '\n')
}

// ── info inicial ──────────────────────────────────────────────────────
const topicHex   = topic.toString('hex')
const topicShort = topicHex.slice(0, 12) + '…'

log(`=== PEER INICIADO ===`)
log(`carnet_local=${MY_CARNET}`)
log(`seed="${SEED}"`)
log(`topic_hex=${topicHex}`)
log(`topic_short=${topicShort}`)
log(`topic_bytes=${topic.length}`)

// ── Hyperswarm ────────────────────────────────────────────────────────
const swarm = new Hyperswarm()

swarm.on('connection', (conn, info) => {
  const pubHex     = info.publicKey?.toString('hex') ?? 'N/A'
  const peerShort  = pubHex !== 'N/A' ? pubHex.slice(0, 12) + '…' : 'desconocido'
  const remoteAddr = conn.remoteAddress
    ? `${conn.remoteAddress}:${conn.remotePort}`
    : 'N/A'

  log(`CONNECTION evento`)
  log(`  peer_id_remoto_truncado=${peerShort}`)
  log(`  remote_address=${remoteAddr}`)
  log(`  topic_short=${topicShort}`)
  log(`  connected=si`)

  // protocolo delimitado por newline
  let buf = ''
  conn.on('data', chunk => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()                        // fragmento incompleto
    for (const line of lines) {
      if (!line.trim()) continue
      log(`MSG_RECV peer=${peerShort} addr=${remoteAddr} payload="${line.trim()}"`)
    }
  })

  conn.on('error', err => log(`CONN_ERROR peer=${peerShort} err="${err.message}"`))
  conn.on('close',     () => log(`CONN_CLOSE peer=${peerShort}`))

  // enviar ping
  const payload = `ping desde ${MY_CARNET}`
  conn.write(payload + '\n')
  log(`MSG_SENT payload="${payload}"`)
})

swarm.on('error', err => log(`SWARM_ERROR ${err.message}`))

// join: anunciar (server) y buscar (client)
const disc = swarm.join(topic, { server: true, client: true })
await disc.flushed()
log(`JOIN_FLUSHED topic_short=${topicShort}`)
log(`Esperando peers… (Ctrl+C para salir)`)

// timeout de diagnóstico si no hay conexión en 2 min
const deadline = setTimeout(() => {
  log(`TIMEOUT 120s sin conexión — posible bloqueo de red, NAT estricto o ningún otro peer activo`)
  log(`  diagnóstico: verificar firewall, puerto UDP 49737, o correr ambos peers en la misma máquina`)
}, 120_000)
deadline.unref()

process.on('SIGINT', async () => {
  log('SIGINT – cerrando swarm')
  clearTimeout(deadline)
  await swarm.destroy()
  logStream.end()
  process.exit(0)
})
