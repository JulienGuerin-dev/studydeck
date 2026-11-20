// Appairage sans serveur : on n'échange que l'essentiel d'une connexion WebRTC (identifiants ICE, empreinte
// DTLS, adresses) sous une forme binaire compacte, encodée en base32 avec somme de contrôle (CRC-16).
// Le QR code et le « code de secours » à saisir contiennent exactement la même chaîne.
// Le SDP complet est reconstruit localement à partir de ces éléments.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford : sans I, L, O, U
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VERSION = 1

export type Role = 'offer' | 'answer'
export interface PairCandidate { ip?: string; mdns?: string; port: number }
export interface PairInfo {
  role: Role
  ufrag: string
  pwd: string
  fingerprint: string // « AA:BB:… » (SHA-256)
  candidates: PairCandidate[]
}

/* ------------------------------- Base32 / CRC ------------------------------- */

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let acc = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) { out += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5 }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

/** Normalise une saisie (minuscules, tirets, espaces, O→0, I/L→1) puis décode. */
export function normalizeCode(text: string): string {
  return text.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '').replace(/U/g, 'V')
}

export function base32Decode(text: string): Uint8Array {
  const s = normalizeCode(text)
  const out: number[] = []
  let bits = 0
  let acc = 0
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) throw new Error('caractère invalide')
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8 }
    acc &= (1 << bits) - 1
  }
  return Uint8Array.from(out)
}

export function crc16(data: Uint8Array): number {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/* ------------------------------- Chaînes ICE ------------------------------- */

function packB64(s: string): Uint8Array | null {
  const vals = [...s].map((c) => B64.indexOf(c))
  if (vals.some((v) => v < 0)) return null
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const v of vals) {
    acc = (acc << 6) | v
    bits += 6
    while (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8 }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out.push((acc << (8 - bits)) & 255)
  return Uint8Array.from(out)
}
function unpackB64(bytes: Uint8Array, n: number): string {
  let out = ''
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 6 && out.length < n) { out += B64[(acc >> (bits - 6)) & 63]; bits -= 6 }
    acc &= (1 << bits) - 1
  }
  return out
}

/* ------------------------------- Encodage ------------------------------- */

export function encodePairing(info: PairInfo): string {
  const parts: number[] = []
  const pushStr = (s: string) => {
    const packed = packB64(s)
    if (packed) { parts.push(s.length, ...packed) } else {
      throw new Error('Identifiants ICE non compactables')
    }
  }
  parts.push((VERSION << 4) | (info.role === 'offer' ? 0 : 1))
  pushStr(info.ufrag)
  pushStr(info.pwd)
  const fp = info.fingerprint.split(':').map((h) => parseInt(h, 16))
  if (fp.length !== 32 || fp.some((n) => Number.isNaN(n))) throw new Error('Empreinte invalide')
  parts.push(...fp)
  const cands = info.candidates.slice(0, 3)
  parts.push(cands.length)
  for (const c of cands) {
    if (c.ip) {
      parts.push(1, ...c.ip.split('.').map(Number), c.port >> 8, c.port & 255)
    } else if (c.mdns) {
      const hex = c.mdns.replace(/-/g, '')
      parts.push(2, ...Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)), c.port >> 8, c.port & 255)
    }
  }
  const body = Uint8Array.from(parts)
  const crc = crc16(body)
  const full = new Uint8Array(body.length + 2)
  full.set(body)
  full[body.length] = crc >> 8
  full[body.length + 1] = crc & 255
  return base32Encode(full)
}

export type DecodeError = 'empty' | 'incomplete' | 'checksum' | 'format'
export type DecodeResult = { ok: true; info: PairInfo } | { ok: false; error: DecodeError }

export function decodePairing(text: string): DecodeResult {
  if (!normalizeCode(text)) return { ok: false, error: 'empty' }
  let bytes: Uint8Array
  try { bytes = base32Decode(text) } catch { return { ok: false, error: 'format' } }
  if (bytes.length < 40) return { ok: false, error: 'incomplete' }
  try {
    let p = 0
    const head = bytes[p++]
    if (head >> 4 !== VERSION) return { ok: false, error: 'format' }
    const role: Role = (head & 15) === 0 ? 'offer' : 'answer'
    const readStr = () => {
      const n = bytes[p++]
      const nb = Math.ceil((n * 6) / 8)
      const s = unpackB64(bytes.slice(p, p + nb), n)
      p += nb
      return s
    }
    const ufrag = readStr()
    const pwd = readStr()
    const fingerprint = Array.from(bytes.slice(p, p + 32), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
    p += 32
    const count = bytes[p++]
    const candidates: PairCandidate[] = []
    for (let i = 0; i < count; i++) {
      const kind = bytes[p++]
      if (kind === 1) {
        const ip = `${bytes[p]}.${bytes[p + 1]}.${bytes[p + 2]}.${bytes[p + 3]}`
        candidates.push({ ip, port: (bytes[p + 4] << 8) | bytes[p + 5] })
        p += 6
      } else if (kind === 2) {
        const h = Array.from(bytes.slice(p, p + 16), (b) => b.toString(16).padStart(2, '0')).join('')
        candidates.push({ mdns: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, port: (bytes[p + 16] << 8) | bytes[p + 17] })
        p += 18
      } else return { ok: false, error: 'format' }
    }
    if (bytes.length < p + 2) return { ok: false, error: 'incomplete' }
    const crc = (bytes[p] << 8) | bytes[p + 1]
    if (crc16(bytes.slice(0, p)) !== crc) return { ok: false, error: 'checksum' }
    return { ok: true, info: { role, ufrag, pwd, fingerprint, candidates } }
  } catch {
    return { ok: false, error: 'incomplete' }
  }
}

/** Affichage par groupes de 4 caractères : K7QP-2MXA-… */
export function formatCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-')
}

export const DECODE_MESSAGES: Record<DecodeError, string> = {
  empty: '',
  incomplete: 'Code incomplet : continuez la saisie.',
  checksum: 'Erreur de saisie : un caractère est faux. Vérifiez le code groupe par groupe.',
  format: 'Ce code n\'est pas valide.',
}

/* ------------------------------- SDP ↔ compact ------------------------------- */

export function sdpFromInfo(info: PairInfo, setup: 'actpass' | 'active'): string {
  const lines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${info.ufrag}`,
    `a=ice-pwd:${info.pwd}`,
    `a=fingerprint:sha-256 ${info.fingerprint}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ]
  info.candidates.forEach((c, i) => {
    const host = c.ip ?? `${c.mdns}.local`
    lines.push(`a=candidate:${i + 1} 1 udp ${2130706431 - i * 256} ${host} ${c.port} typ host`)
  })
  return lines.join('\r\n') + '\r\n'
}

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip)

export function infoFromSdp(sdp: string, role: Role): PairInfo {
  const get = (re: RegExp) => sdp.match(re)?.[1]?.trim()
  const ufrag = get(/a=ice-ufrag:(\S+)/)
  const pwd = get(/a=ice-pwd:(\S+)/)
  const fingerprint = get(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/)?.toUpperCase()
  if (!ufrag || !pwd || !fingerprint) throw new Error('SDP incomplet')
  const found: (PairCandidate & { score: number })[] = []
  for (const m of sdp.matchAll(/a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (\w+)/g)) {
    const [, host, port, typ] = m
    if (typ === 'relay') continue
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) found.push({ ip: host, port: Number(port), score: isPrivate(host) ? 0 : 2 })
    else if (/^[0-9a-f-]{36}\.local$/i.test(host)) found.push({ mdns: host.slice(0, 36).toLowerCase(), port: Number(port), score: 1 })
  }
  found.sort((a, b) => a.score - b.score)
  return { role, ufrag, pwd, fingerprint, candidates: found.slice(0, 3).map(({ score: _s, ...c }) => c) }
}

/* ------------------------------- Messages (copier / coller) ------------------------------- */

/** Texte à envoyer par messagerie : le code reste facile à retrouver au milieu d'un message. */
export function shareText(code: string): string {
  return `StudyDeck : ${formatCode(code)}`
}

/**
 * Retrouve le code dans un texte collé (message complet, retours à la ligne, texte autour).
 * Un code est une suite de groupes de 4 caractères séparés par des tirets ; on prend la suite la plus longue.
 */
export function extractCode(text: string): string {
  const runs = text.match(/(?:[0-9A-Za-z]{1,4}-\s*){10,}[0-9A-Za-z]{1,4}/g)
  if (!runs) return text
  return runs.sort((a, b) => b.length - a.length)[0]
}
