// topic.js – topic determinístico de 32 bytes para el Lab 16
// SHA-256 de la semilla del curso: cs031-s19-20261013
import crypto from 'crypto'

export const SEED = 'cs031-s19-20261013'
export const topic = crypto.createHash('sha256').update(SEED).digest()

// Ejecución directa para verificar
const isMain = process.argv[1]?.endsWith('topic.js')
if (isMain) {
  console.log('SEED   :', SEED)
  console.log('topic  :', topic.toString('hex'))
  console.log('length :', topic.length, 'bytes')
}
