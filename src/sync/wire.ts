// Couche de transmission sur un canal ordonné et fiable (RTCDataChannel ou canal de test) :
// messages JSON + blocs binaires découpés en morceaux de 16 Ko, vérifiés par SHA-256.

import { sha256Hex } from '../db/hash'

export interface Channel {
  send(data: string | ArrayBuffer): void
  buffered(): number
  close(): void
  onmessage: ((data: string | ArrayBuffer) => void) | null
  onclose: (() => void) | null
}

export type Msg = { kind: 'json'; value: Record<string, unknown> } | { kind: 'bytes'; data: Uint8Array }

const CHUNK = 16 * 1024
const HIGH_WATER = 1024 * 1024

export class Wire {
  private queue: Msg[] = []
  private waiter: { resolve: (m: Msg) => void; reject: (e: Error) => void } | null = null
  private closedErr: Error | null = null
  private incoming: { size: number; sha: string; parts: Uint8Array[]; got: number } | null = null
  bytesSent = 0
  bytesReceived = 0

  constructor(private ch: Channel) {
    ch.onmessage = (d) => void this.onData(d)
    ch.onclose = () => this.fail(new Error('La connexion avec l\'autre appareil a été interrompue.'))
  }

  private push(m: Msg) {
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(m) } else this.queue.push(m)
  }
  private fail(e: Error) {
    if (!this.closedErr) this.closedErr = e
    if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(this.closedErr) }
  }

  private async onData(d: string | ArrayBuffer) {
    try {
      if (typeof d === 'string') {
        const v = JSON.parse(d) as Record<string, unknown>
        if (v.t === 'bytes') this.incoming = { size: Number(v.size), sha: String(v.sha), parts: [], got: 0 }
        else this.push({ kind: 'json', value: v })
        if (v.t === 'bytes' && Number(v.size) === 0) await this.finishBytes()
        return
      }
      if (!this.incoming) return
      const chunk = new Uint8Array(d)
      this.incoming.parts.push(chunk)
      this.incoming.got += chunk.length
      this.bytesReceived += chunk.length
      if (this.incoming.got >= this.incoming.size) await this.finishBytes()
    } catch (e) { this.fail(e as Error) }
  }

  private async finishBytes() {
    const inc = this.incoming!
    this.incoming = null
    const data = new Uint8Array(inc.got)
    let o = 0
    for (const p of inc.parts) { data.set(p, o); o += p.length }
    if (data.length !== inc.size || (await sha256Hex(data)) !== inc.sha) {
      this.fail(new Error('Les données reçues sont corrompues (vérification SHA-256 échouée). Recommencez.'))
      return
    }
    this.push({ kind: 'bytes', data })
  }

  sendJson(value: Record<string, unknown>) {
    if (this.closedErr) throw this.closedErr
    this.ch.send(JSON.stringify(value))
  }

  async sendBytes(data: Uint8Array, onProgress?: (sent: number, total: number) => void) {
    if (this.closedErr) throw this.closedErr
    this.ch.send(JSON.stringify({ t: 'bytes', size: data.length, sha: await sha256Hex(data) }))
    for (let o = 0; o < data.length; o += CHUNK) {
      while (this.ch.buffered() > HIGH_WATER) {
        if (this.closedErr) throw this.closedErr
        await new Promise((r) => setTimeout(r, 15))
      }
      const part = data.slice(o, o + CHUNK)
      this.ch.send(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer)
      this.bytesSent += part.length
      onProgress?.(Math.min(o + CHUNK, data.length), data.length)
    }
  }

  next(timeoutMs = 0): Promise<Msg> {
    const q = this.queue.shift()
    if (q) return Promise.resolve(q)
    if (this.closedErr) return Promise.reject(this.closedErr)
    return new Promise<Msg>((resolve, reject) => {
      let t: ReturnType<typeof setTimeout> | undefined
      const done = <T,>(f: (x: T) => void) => (x: T) => { if (t) clearTimeout(t); f(x) }
      this.waiter = { resolve: done(resolve), reject: done(reject) }
      if (timeoutMs > 0) t = setTimeout(() => { this.waiter = null; reject(new Error('Délai dépassé : l\'autre appareil ne répond pas.')) }, timeoutMs)
    })
  }

  async nextJson(type?: string, timeoutMs = 0): Promise<Record<string, unknown>> {
    const m = await this.next(timeoutMs)
    if (m.kind !== 'json' || (type && m.value.t !== type)) throw new Error(`Message inattendu (attendu : ${type ?? 'JSON'}).`)
    return m.value
  }
  async nextBytes(timeoutMs = 0): Promise<Uint8Array> {
    const m = await this.next(timeoutMs)
    if (m.kind !== 'bytes') throw new Error('Message inattendu (attendu : données).')
    return m.data
  }

  close() { this.ch.close() }
}

/** Paire de canaux en mémoire (tests). */
export function memoryChannelPair(): [Channel, Channel] {
  const mk = (): Channel => ({ send() {}, buffered: () => 0, close() {}, onmessage: null, onclose: null })
  const a = mk(), b = mk()
  const link = (from: Channel, to: Channel) => {
    from.send = (d) => { const c = typeof d === 'string' ? d : d.slice(0); queueMicrotask(() => to.onmessage?.(c)) }
    from.close = () => { queueMicrotask(() => { from.onclose?.(); to.onclose?.() }) }
  }
  link(a, b); link(b, a)
  return [a, b]
}
