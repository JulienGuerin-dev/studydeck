import { describe, expect, it } from 'vitest'
import { decodePairing, encodePairing, formatCode, infoFromSdp, normalizeCode, sdpFromInfo, type PairInfo } from '../src/sync/pairing'

const fp = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0').toUpperCase()).join(':')
const base: PairInfo = {
  role: 'offer', ufrag: 'aB3d', pwd: 'x7Yq0pLmN2vB9cRtU4wZ5eKs', fingerprint: fp,
  candidates: [{ ip: '172.20.10.2', port: 54321 }],
}

describe('Codec d\'appairage', () => {
  it('aller-retour exact (offre, IP)', () => {
    const code = encodePairing(base)
    const r = decodePairing(code)
    expect(r.ok && r.info).toEqual(base)
  })
  it('aller-retour exact (réponse, mDNS + IP, 3 candidats)', () => {
    const info: PairInfo = { ...base, role: 'answer', candidates: [
      { mdns: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', port: 50000 }, { ip: '192.168.1.20', port: 1234 }, { ip: '10.0.0.5', port: 65535 }] }
    const r = decodePairing(encodePairing(info))
    expect(r.ok && r.info).toEqual(info)
  })
  it('reste court : un code de réponse tient en moins de 125 caractères', () => {
    const len = encodePairing({ ...base, role: 'answer' }).length
    expect(len).toBeLessThan(125)
    console.log('longueur code réponse (1 candidat IPv4) =', len, '| avec mDNS =', encodePairing({ ...base, candidates: [{ mdns: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', port: 1 }] }).length)
  })
  it('tolère minuscules, tirets, espaces et confusions O/0 I/L/1', () => {
    const code = encodePairing(base)
    const noisy = formatCode(code).toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').replace(/-/g, ' - ')
    expect(normalizeCode(noisy)).toBe(code)
    expect(decodePairing(noisy).ok).toBe(true)
  })
  it('détecte toute faute de frappe (somme de contrôle) et les codes incomplets', () => {
    const code = encodePairing(base)
    let detected = 0
    for (let i = 0; i < code.length - 1; i++) { // le dernier caractère peut ne contenir que du remplissage
      const alt = code[i] === '2' ? '3' : '2'
      const r = decodePairing(code.slice(0, i) + alt + code.slice(i + 1))
      if (!r.ok || JSON.stringify(r.info) !== JSON.stringify(base)) detected++
    }
    expect(detected).toBe(code.length - 1)
    expect(decodePairing(code.slice(0, 30))).toEqual({ ok: false, error: 'incomplete' })
    expect(decodePairing('')).toEqual({ ok: false, error: 'empty' })
  })
  it('reconstruit un SDP exploitable et le relit à l\'identique', () => {
    const sdp = sdpFromInfo(base, 'actpass')
    expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel')
    expect(sdp).toContain('a=setup:actpass')
    expect(sdp).toContain('a=candidate:1 1 udp 2130706431 172.20.10.2 54321 typ host')
    expect(infoFromSdp(sdp, 'offer')).toEqual(base)
  })
  it('extrait d\'un SDP réel : ignore IPv6, TCP, relais ; classe privé > mDNS > public', () => {
    const real = [
      'a=ice-ufrag:Zq1w', 'a=ice-pwd:' + 'p'.repeat(24), 'a=fingerprint:sha-256 ' + fp.toLowerCase(),
      'a=candidate:1 1 udp 2122260223 8.8.4.4 5000 typ srflx raddr 0.0.0.0 rport 0',
      'a=candidate:2 1 udp 2122194687 192.168.0.12 5001 typ host',
      'a=candidate:3 1 udp 2113937151 5e0f6a2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b.local 5002 typ host',
      'a=candidate:4 1 udp 2122129151 fe80::1 5003 typ host', 'a=candidate:5 1 tcp 1518280447 192.168.0.12 9 typ host tcptype active',
      'a=candidate:6 1 udp 41885439 51.0.0.1 3478 typ relay raddr 0.0.0.0 rport 0',
    ].join('\r\n')
    const info = infoFromSdp(real, 'answer')
    expect(info.candidates).toEqual([{ ip: '192.168.0.12', port: 5001 }, { mdns: '5e0f6a2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b', port: 5002 }, { ip: '8.8.4.4', port: 5000 }])
    expect(info.fingerprint).toBe(fp)
  })
})

import { extractCode, shareText } from '../src/sync/pairing'
describe('Copier / coller', () => {
  it('retrouve le code au milieu d\'un message, même coupé par des retours à la ligne', () => {
    const code = encodePairing(base)
    const msg = `Salut ! ${shareText(code)} merci, à tout à l'heure`
    expect(decodePairing(extractCode(msg)).ok).toBe(true)
    const wrapped = shareText(code).replace(/-/g, (m, i) => (i % 5 === 0 ? '-\n' : m))
    expect(decodePairing(extractCode('Code ' + wrapped)).ok).toBe(true)
    expect(decodePairing(extractCode(code)).ok).toBe(true) // sans tirets : repli sur le texte entier
  })
})
