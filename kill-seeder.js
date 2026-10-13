// kill-seeder.js – Lab 16, Parte D
// Experimento: mata al seeder a mitad de la transferencia y registra el resultado.
// Corre seeder y downloader en el mismo proceso para control total.

import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ── setup ─────────────────────────────────────────────────────────────
fs.mkdirSync('logs',     { recursive: true })
fs.mkdirSync('received', { recursive: true })

// cores limpios para reproducibilidad
fs.rmSync('./data/ks-seeder',   { recursive: true, force: true })
fs.rmSync('./data/ks-downloader', { recursive: true, force: true })

const logPath   = 'logs/kill-seeder.log'
const logStream = fs.createWriteStream(logPath, { flags: 'w' })

function log(...parts) {
  const ts   = new Date().toISOString()
  const line = `[${ts}] ${parts.join(' ')}`
  console.log(line)
  logStream.write(line + '\n')
}

async function flushWithTimeout(discovery, label, timeoutMs = 10000) {
  let timer
  try {
    await Promise.race([
      discovery.flushed(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout_${label}_${timeoutMs}ms`)), timeoutMs)
      })
    ])
    log(`${label}=OK`)
  } catch (err) {
    // El experimento sigue siendo válido: el timeout es evidencia de bloqueo
    // de descubrimiento/bootstrap, no una razón para inventar una conexión.
    log(`${label}=TIMEOUT err="${err.message}"`)
  } finally {
    clearTimeout(timer)
  }
}

const FIXTURE    = path.join('fixtures', 'p2p-test-file.txt')
const content    = fs.readFileSync(FIXTURE)
const sha256Orig = crypto.createHash('sha256').update(content).digest('hex')

log(`=== EXPERIMENTO KILL-SEEDER ===`)
log(`fixture=${FIXTURE}`)
log(`total_bytes_fixture=${content.length}`)
log(`sha256_original=${sha256Orig}`)

// ── SEEDER CORE ───────────────────────────────────────────────────────
const seederCore = new Hypercore('./data/ks-seeder', { valueEncoding: 'binary' })
await seederCore.ready()

// bloques pequeños (64 bytes) para poder observar la interrupción
const CHUNK_SIZE = 64
let offset = 0
while (offset < content.length) {
  await seederCore.append(content.slice(offset, offset + CHUNK_SIZE))
  offset += CHUNK_SIZE
}

const totalBlocks = seederCore.length
log(`seeder_public_key_short=${seederCore.key.toString('hex').slice(0, 12)}…`)
log(`seeder_total_blocks=${totalBlocks}`)
log(`seeder_chunk_size=${CHUNK_SIZE} bytes`)

// ── SEEDER SWARM ──────────────────────────────────────────────────────
const seederSwarm = new Hyperswarm()
const seederDisc  = seederSwarm.join(seederCore.key, { server: true, client: false })
await flushWithTimeout(seederDisc, 'seeder_discovery_flush')
log(`seeder_swarm_anunciado`)

let seederConnRef = null
seederSwarm.on('connection', (conn, info) => {
  const peerShort = info.publicKey?.toString('hex').slice(0, 12) + '…' ?? 'N/A'
  log(`seeder_connection peer=${peerShort}`)
  seederConnRef = conn
  conn.on('error', err => log(`seeder_conn_error code=${err.code || 'UNKNOWN'} msg="${err.message}"`))
  const rep = seederCore.replicate(false)
  // pausa artificial: 5 ms entre escrituras para poder matar a mitad
  const origWrite = rep.write.bind(rep)
  rep.write = (data, cb) => setTimeout(() => origWrite(data, cb), 5)
  rep.pipe(conn).pipe(rep)
  rep.on('error', err => log(`seeder_rep_error code=${err.code || 'UNKNOWN'} msg="${err.message}"`))
})

// ── DOWNLOADER CORE ───────────────────────────────────────────────────
const dlCore = new Hypercore('./data/ks-downloader', seederCore.key, { valueEncoding: 'binary' })
await dlCore.ready()

const dlSwarm = new Hyperswarm()
dlSwarm.join(seederCore.key, { server: false, client: true })

dlSwarm.on('connection', (conn, info) => {
  const peerShort  = info.publicKey?.toString('hex').slice(0, 12) + '…' ?? 'N/A'
  const remoteAddr = conn.remoteAddress ? `${conn.remoteAddress}:${conn.remotePort}` : 'N/A'
  log(`downloader_connection peer=${peerShort} addr=${remoteAddr}`)
  conn.on('error', err => log(`downloader_conn_error code=${err.code || 'UNKNOWN'} msg="${err.message}"`))
  const rep = dlCore.replicate(true)
  rep.pipe(conn).pipe(rep)
  rep.on('error', err => log(`downloader_rep_error code=${err.code || 'UNKNOWN'} msg="${err.message}"`))
})

// esperar conexión entre peers
log(`Esperando conexión local entre peers…`)
await new Promise(r => setTimeout(r, 3000))
await dlCore.update()
const expected = dlCore.length || totalBlocks
log(`downloader_expected_blocks=${expected}`)

const killAtBlock = Math.floor(expected / 2)
log(`kill_at_block=${killAtBlock} (≈50% de ${expected})`)
log(`otro_seeder=NO – hay un único seeder en este experimento`)

// ── DESCARGA CON KILL ─────────────────────────────────────────────────
let receivedBlocks = 0
let receivedBytes  = 0
const chunks       = []
let killed         = false

for (let i = 0; i < expected; i++) {
  // matar al llegar a mitad
  if (i >= killAtBlock && !killed) {
    killed = true
    log(`KILL_SEEDER momento=${new Date().toISOString()}`)
    log(`  bloques_recibidos_antes_del_kill=${receivedBlocks}`)
    log(`  bytes_recibidos_antes_del_kill=${receivedBytes}`)

    try { seederConnRef?.destroy() }  catch (_) {}
    await seederSwarm.destroy()
    await seederCore.close()

    log(`seeder_destruido`)
    log(`  otro_seeder=NO`)

    // dar tiempo para que downloader detecte la pérdida
    await new Promise(r => setTimeout(r, 2500))
  }

  try {
    const block = await Promise.race([
      dlCore.get(i),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error(`timeout_bloque_${i}`)), 8000
      ))
    ])
    receivedBlocks++
    receivedBytes += block.length
    chunks.push(block)
  } catch (err) {
    // error esperado después del kill
    log(`ERROR_DOWNLOADER bloque=${i} err="${err.message}"`)
    log(`  transferencia_completa=NO`)
    log(`  bloques_recibidos=${receivedBlocks}/${expected}`)
    log(`  bytes_recibidos=${receivedBytes}`)
    log(`  archivo_incompleto=SI`)
    log(`  reanudable=NO (no existe otro seeder)`)
    log(`  conclusion: La transferencia quedó incompleta al matar el único seeder.`)
    log(`              Un downloader real debería esperar a que el seeder vuelva`)
    log(`              o encontrar otro peer con las mismas piezas.`)

    await dlSwarm.destroy()
    await dlCore.close()
    logStream.end()
    process.exit(0)
  }
}

// Si llegamos aquí (no debería pasar con la pausa de 5 ms)
const received   = Buffer.concat(chunks)
const sha256Recv = crypto.createHash('sha256').update(received).digest('hex')
log(`RESULTADO_INESPERADO transferencia_completa=SI`)
log(`  total_blocks=${receivedBlocks}`)
log(`  total_bytes=${receivedBytes}`)
log(`  sha256=${sha256Recv}`)
log(`  integridad=${sha256Recv === sha256Orig ? 'OK' : 'ERROR'}`)

await dlSwarm.destroy()
await dlCore.close()
logStream.end()
process.exit(0)
