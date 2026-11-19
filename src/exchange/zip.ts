import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export function makeZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const input: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) input[k] = typeof v === 'string' ? strToU8(v) : v
  return zipSync(input, { level: 6 })
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

export { strFromU8, strToU8 }
