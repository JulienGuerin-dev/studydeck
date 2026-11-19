// Connexion WebRTC directe (réseau local / partage de connexion), sans serveur de signalisation.
// Deux rôles : « hôte » (affiche le code/QR d'offre, reçoit la réponse) et « invité » (lit l'offre, produit la réponse).

import { decodePairing, encodePairing, infoFromSdp, sdpFromInfo, type DecodeError } from './pairing'
import type { Channel } from './wire'

const CONNECT_TIMEOUT = 30_000

function waitGathering(pc: RTCPeerConnection, maxMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const t = setTimeout(done, maxMs)
    function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); resolve() }
    const on = () => { if (pc.iceGatheringState === 'complete') done() }
    pc.addEventListener('icegatheringstatechange', on)
  })
}

function adapt(dc: RTCDataChannel, pc: RTCPeerConnection): Channel {
  dc.binaryType = 'arraybuffer'
  const ch: Channel = {
    send: (d) => dc.send(d as never),
    buffered: () => dc.bufferedAmount,
    close: () => { try { dc.close() } catch { /* déjà fermé */ } try { pc.close() } catch { /* idem */ } },
    onmessage: null,
    onclose: null,
  }
  dc.onmessage = (e) => ch.onmessage?.(e.data as string | ArrayBuffer)
  dc.onclose = () => ch.onclose?.()
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') ch.onclose?.() })
  return ch
}

function waitOpen(dc: RTCDataChannel, pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (dc.readyState === 'open') return resolve()
    const t = setTimeout(() => {
      reject(new Error('Connexion impossible. Vérifiez que les deux appareils sont sur le même réseau (ou connectés au partage de connexion), puis recommencez.'))
      try { pc.close() } catch { /* idem */ }
    }, CONNECT_TIMEOUT)
    dc.addEventListener('open', () => { clearTimeout(t); resolve() }, { once: true })
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') { clearTimeout(t); reject(new Error('La connexion a échoué. Les appareils ne peuvent peut-être pas communiquer sur ce réseau (isolation des clients Wi-Fi). Essayez le partage de connexion de l\'iPhone.')) }
    })
  })
}

export const ERROR_TEXT: Record<DecodeError, string> = {
  empty: 'Aucun code.', incomplete: 'Code incomplet.', checksum: 'Erreur de saisie dans le code.', format: 'Code non valide.',
}

export interface HostHandle {
  code: string // à afficher en QR + à saisir
  accept(answerCode: string): Promise<{ channel: Channel; pc: RTCPeerConnection }>
  cancel(): void
}

export async function startHost(): Promise<HostHandle> {
  const pc = new RTCPeerConnection({ iceServers: [] })
  const dc = pc.createDataChannel('studydeck-sync', { ordered: true })
  await pc.setLocalDescription(await pc.createOffer())
  await waitGathering(pc)
  const info = infoFromSdp(pc.localDescription!.sdp, 'offer')
  if (!info.candidates.length) {
    pc.close()
    throw new Error('Aucune adresse réseau détectée. Connectez-vous à un réseau (Wi-Fi ou partage de connexion) puis recommencez.')
  }
  return {
    code: encodePairing(info),
    async accept(answerCode: string) {
      const r = decodePairing(answerCode)
      if (!r.ok) throw new Error(ERROR_TEXT[r.error])
      if (r.info.role !== 'answer') throw new Error('Ce code est un code de départ, pas un code de réponse.')
      await pc.setRemoteDescription({ type: 'answer', sdp: sdpFromInfo(r.info, 'active') })
      await waitOpen(dc, pc)
      return { channel: adapt(dc, pc), pc }
    },
    cancel() { try { pc.close() } catch { /* idem */ } },
  }
}

export interface GuestHandle {
  code: string // code de réponse à saisir sur l'hôte
  connected(): Promise<{ channel: Channel; pc: RTCPeerConnection }>
  cancel(): void
}

export async function joinHost(offerCode: string): Promise<GuestHandle> {
  const r = decodePairing(offerCode)
  if (!r.ok) throw new Error(ERROR_TEXT[r.error])
  if (r.info.role !== 'offer') throw new Error('Ce code est un code de réponse : scannez ou saisissez le code affiché par l\'autre appareil.')
  const pc = new RTCPeerConnection({ iceServers: [] })
  const opened = new Promise<RTCDataChannel>((resolve) => { pc.ondatachannel = (e) => resolve(e.channel) })
  await pc.setRemoteDescription({ type: 'offer', sdp: sdpFromInfo(r.info, 'actpass') })
  await pc.setLocalDescription(await pc.createAnswer())
  await waitGathering(pc)
  const info = infoFromSdp(pc.localDescription!.sdp, 'answer')
  if (!info.candidates.length) {
    pc.close()
    throw new Error('Aucune adresse réseau détectée sur cet appareil. Vérifiez la connexion Wi-Fi ou le partage de connexion.')
  }
  return {
    code: encodePairing(info),
    async connected() {
      const dc = await Promise.race([
        opened,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Connexion impossible : l\'autre appareil n\'a pas répondu à temps. Vérifiez le code saisi et le réseau.')), CONNECT_TIMEOUT)),
      ])
      await waitOpen(dc, pc)
      return { channel: adapt(dc, pc), pc }
    },
    cancel() { try { pc.close() } catch { /* idem */ } },
  }
}

/** Type de chemin réseau retenu : « host » = réseau local direct. */
export async function describePath(pc: RTCPeerConnection): Promise<string> {
  try {
    const stats = await pc.getStats()
    let pairId: string | undefined
    stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId })
    let local = '', remote = ''
    stats.forEach((s) => { if (s.id === pairId || (!pairId && s.type === 'candidate-pair' && s.nominated)) { local = s.localCandidateId; remote = s.remoteCandidateId } })
    let l: RTCStats | undefined, r: RTCStats | undefined
    stats.forEach((s) => { if (s.id === local) l = s; if (s.id === remote) r = s })
    const ip = (s: RTCStats | undefined) => { const x = s as unknown as { address?: string; ip?: string; port?: number } | undefined; return x ? `${x.address ?? x.ip ?? '?'}` : '?' }
    return `${ip(l)} ⇄ ${ip(r)}`
  } catch { return 'inconnu' }
}
