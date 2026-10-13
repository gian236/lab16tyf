// file-transfer.js – Lab 16, Parte C
// Transferencia de archivo con Hypercore entre dos peers
//
// Uso:
//   node file-transfer.js --role seeder
//   node file-transfer.js --role downloader --key <hex-public-key>

import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ── argumentos ────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const roleIdx = args.indexOf('--role')
const keyIdx  = args.indexOf('--key')

if (roleIdx === -1) {
  console.error('Uso: node file-transfer.js --role seeder|downloader [--key <hex>]')
  process.exit(1)
}
const ROLE       = args[roleIdx + 1]
const REMOTE_KEY = keyIdx !== -1 ? Buffer.from(args[keyIdx + 1], 'hex') : null

// ── logging ───────────────────────────────────────────────────────────
fs.mkdirSync('logs',     { recursive: true })
fs.mkdirSync('received', { recursive: true })

const logPath   = 'logs/file-transfer.log'
const logStream = fs.createWriteStream(logPath, { flags: 'a' })

function log(...parts) {
  const line = `[${new Date().toISOString()}] [${ROLE}] ${parts.join(' ')}`
  console.log(line)
  logStream.write(line + '\n')
}

const FIXTURE  = path.join('fixtures', 'p2p-test-file.txt')
const RECEIVED = path.join('received', 'p2p-test-file.txt')

// ════════════════════════════════════════════════════════════════════
// SEEDER  (carnet 20230117)
// ════════════════════════════════════════════════════════════════════
if (ROLE === 'seeder') {
  const core = new Hypercore('./data/hypercore-seeder', { valueEncoding: 'binary' })
  await core.ready()

  log(`Hypercore seeder listo`)
  log(`public_key=${core.key.toString('hex')}`)
  log(`public_key_short=${core.key.toString('hex').slice(0, 12)}…`)
  log(``)
  log(`=== COPIA ESTA LÍNEA PARA EL DOWNLOADER ===`)
  log(`KEY:${core.key.toString('hex')}`)
  log(`===========================================`)
  log(``)

  const content    = fs.readFileSync(FIXTURE)
  const chunkSize  = 256  // bloques de 256 bytes
  let offset = 0
  while (offset < content.length) {
    await core.append(content.slice(offset, offset + chunkSize))
    offset += chunkSize
  }

  const sha256Orig = crypto.createHash('sha256').update(content).digest('hex')
  log(`fixture=${FIXTURE}`)
  log(`total_bytes=${content.length}`)
  log(`total_blocks=${core.length}`)
  log(`sha256_original=${sha256Orig}`)

  // anunciar en el swarm usando la clave pública como topic
  const swarm = new Hyperswarm()
  const disc  = swarm.join(core.key, { server: true, client: false })
  await disc.flushed()
  log(`swarm_anunciado key_short=${core.key.toString('hex').slice(0, 12)}…`)
  log(`Esperando downloader… (Ctrl+C para salir)`)

  swarm.on('connection', (conn, info) => {
    const peerShort  = info.publicKey?.toString('hex').slice(0, 12) + '…' ?? 'N/A'
    const remoteAddr = conn.remoteAddress ? `${conn.remoteAddress}:${conn.remotePort}` : 'N/A'
    log(`DOWNLOADER_CONECTADO peer=${peerShort} addr=${remoteAddr}`)
    const rep = core.replicate(false)
    rep.pipe(conn).pipe(rep)
    rep.on('error', err => log(`REP_ERROR ${err.message}`))
  })

  process.on('SIGINT', async () => {
    log('SIGINT – cerrando seeder')
    await swarm.destroy()
    await core.close()
    logStream.end()
    process.exit(0)
  })

// ════════════════════════════════════════════════════════════════════
// DOWNLOADER  (carnet 20230005)
// ════════════════════════════════════════════════════════════════════
} else if (ROLE === 'downloader') {
  if (!REMOTE_KEY) {
    console.error('El downloader necesita: --key <hex-public-key-del-seeder>')
    process.exit(1)
  }

  const core = new Hypercore('./data/hypercore-downloader', REMOTE_KEY, { valueEncoding: 'binary' })
  await core.ready()
  log(`Hypercore downloader listo`)
  log(`replicate_key_short=${REMOTE_KEY.toString('hex').slice(0, 12)}…`)

  const swarm = new Hyperswarm()
  swarm.join(REMOTE_KEY, { server: false, client: true })

  swarm.on('connection', (conn, info) => {
    const peerShort  = info.publicKey?.toString('hex').slice(0, 12) + '…' ?? 'N/A'
    const remoteAddr = conn.remoteAddress ? `${conn.remoteAddress}:${conn.remotePort}` : 'N/A'
    log(`SEEDER_CONECTADO peer=${peerShort} addr=${remoteAddr}`)
    const rep = core.replicate(true)
    rep.pipe(conn).pipe(rep)
    rep.on('error', err => log(`REP_ERROR ${err.message}`))
  })

  // esperar a que llegue la longitud del core
  log(`Esperando conexión con seeder…`)
  await new Promise(r => setTimeout(r, 4000))
  await core.update()
  const totalBlocks = core.length
  log(`total_blocks_esperados=${totalBlocks}`)

  const chunks = []
  for (let i = 0; i < totalBlocks; i++) {
    const block = await core.get(i)
    chunks.push(block)
    if (i % 20 === 0) log(`progreso bloque ${i}/${totalBlocks}`)
  }

  const received      = Buffer.concat(chunks)
  const sha256Recv    = crypto.createHash('sha256').update(received).digest('hex')
  const origContent   = fs.readFileSync(FIXTURE)
  const sha256Orig    = crypto.createHash('sha256').update(origContent).digest('hex')

  fs.writeFileSync(RECEIVED, received)

  log(`total_bytes_recibidos=${received.length}`)
  log(`total_blocks_recibidos=${totalBlocks}`)
  log(`sha256_recibido=${sha256Recv}`)
  log(`sha256_original=${sha256Orig}`)
  log(`integridad=${sha256Recv === sha256Orig ? 'OK – hash coincide' : 'ERROR – hash NO coincide'}`)
  log(`archivo_guardado=${RECEIVED}`)

  await swarm.destroy()
  await core.close()
  logStream.end()
  process.exit(0)

} else {
  console.error('Rol desconocido:', ROLE, '– usa seeder o downloader')
  process.exit(1)
}
