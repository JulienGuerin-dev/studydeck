import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { decodePairing } from '../sync/pairing'

/**
 * Lecture d'un QR code par la caméra. La caméra reste active jusqu'à `release()` : sur Safari, l'accès caméra
 * accordé permet aussi d'obtenir les vraies adresses réseau pour WebRTC (sinon masquées par mDNS).
 */
export function QrScanner({ onCode, onError }: { onCode: (code: string, release: () => void) => void; onError: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let found = false
    const release = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); stream = null }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const tick = () => {
      const v = video.current
      if (v && v.readyState >= 2 && !found) {
        const w = 640
        const h = Math.round((v.videoHeight / v.videoWidth) * w) || 480
        canvas.width = w; canvas.height = h
        ctx.drawImage(v, 0, 0, w, h)
        const img = ctx.getImageData(0, 0, w, h)
        const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
        if (r && decodePairing(r.data).ok) { found = true; onCode(r.data, release); return }
      }
      raf = requestAnimationFrame(tick)
    }

    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra non disponible sur cet appareil.')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
        setReady(true)
        raf = requestAnimationFrame(tick)
      } catch (e) {
        const err = e as Error
        onError(err.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez-le dans les réglages ou saisissez le code à la main.' : err.message || 'Caméra indisponible.')
      }
    })()
    return () => { if (!found) release() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="scanner">
      <video ref={video} playsInline muted autoPlay />
      {!ready && <div className="scanner-wait muted">Démarrage de la caméra…</div>}
      <div className="scanner-frame" aria-hidden />
    </div>
  )
}
