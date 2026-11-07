import { useEffect, useMemo, useRef } from 'react'
import type { Phrase } from './domain'
import { toLearnerFloor, trackFloorAt, type Camera, type FloorMapping, type FloorPoint } from './floor'
import { rolePath, type Dancer } from './floorDrawing'
import { prepareCanvas } from './skeleton'

type RadarProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  phrase: Phrase
  self: Dancer
  others: Dancer[]
  referenceCamera: Camera
  /** Learner-room mapping; without it the radar shows the reference stage relative to the role's start. */
  mapping: FloorMapping | null
  learnerSpot: FloorPoint | null
}

/**
 * Top-down floor map. The front (camera) is at the bottom, and it is mirrored so the learner's
 * left is on the left, matching the mirrored webcam view.
 */
export function FloorRadar({ videoRef, phrase, self, others, referenceCamera, mapping, learnerSpot }: RadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const path = useMemo(() => rolePath(self.track, phrase, referenceCamera), [self.track, phrase, referenceCamera])
  const propsRef = useRef({ others, mapping, learnerSpot, path, self })
  useEffect(() => { propsRef.current = { others, mapping, learnerSpot, path, self } })

  useEffect(() => {
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      const ctx = prepareCanvas(canvas)
      if (!ctx) return
      const { others, mapping, learnerSpot, path, self } = propsRef.current
      const origin = path[0]?.point
      if (!origin) return
      const map = mapping ?? { anchor: origin, origin, scale: 1 }
      const time = video.currentTime
      const role = path.map((item) => ({ ...item, point: toLearnerFloor(item.point, map) }))
      const dancers = others.map((dancer) => {
        const reference = trackFloorAt(dancer.track, time, referenceCamera)
        return reference ? { dancer, point: toLearnerFloor(reference, map) } : null
      }).filter((item) => item !== null)
      const selfNow = trackFloorAt(self.track, time, referenceCamera)
      const selfPoint = selfNow ? toLearnerFloor(selfNow, map) : null

      // Fit everything that will appear during the phrase, with at least a 3 m square.
      const all = [...role.map((item) => item.point), ...dancers.map((item) => item.point), ...(learnerSpot ? [learnerSpot] : []), ...(selfPoint ? [selfPoint] : [])]
      const minX = Math.min(...all.map((p) => p.x)); const maxX = Math.max(...all.map((p) => p.x))
      const minZ = Math.min(...all.map((p) => p.z)); const maxZ = Math.max(...all.map((p) => p.z))
      const span = Math.max(3, maxX - minX + 1.2, maxZ - minZ + 1.2)
      const cx = (minX + maxX) / 2
      const cz = (minZ + maxZ) / 2
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const k = Math.min(w, h - 18) / span
      // Mirrored: camera-right (+x, the learner's left) is drawn on the left.
      const at = (p: FloorPoint) => ({ x: w / 2 - (p.x - cx) * k, y: (h - 18) / 2 - (p.z - cz) * k })

      ctx.strokeStyle = '#ffffff14'
      ctx.lineWidth = 1
      for (let m = Math.floor(minX - span); m <= maxX + span; m += 1) { const a = at({ x: m, z: cz - span }); const b = at({ x: m, z: cz + span }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
      for (let m = Math.floor(minZ - span); m <= maxZ + span; m += 1) { const a = at({ x: cx - span, z: m }); const b = at({ x: cx + span, z: m }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }

      ctx.beginPath()
      role.forEach((item, index) => { const p = at(item.point); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y) })
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 2
      ctx.strokeStyle = self.role.color
      ctx.stroke()
      ctx.setLineDash([])

      ctx.font = '800 10px Inter, ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const dot = (p: FloorPoint, color: string, radius: number, label?: string, ring = false) => {
        const q = at(p)
        ctx.beginPath()
        ctx.arc(q.x, q.y, radius, 0, Math.PI * 2)
        if (ring) { ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.stroke() } else { ctx.fillStyle = color; ctx.fill() }
        if (label) { ctx.fillStyle = ring ? color : '#111'; ctx.fillText(label, q.x, ring ? q.y - radius - 7 : q.y) }
      }
      for (const { dancer, point } of dancers) dot(point, dancer.role.color, 8, dancer.role.label.replace('Role ', ''))
      if (selfPoint) dot(selfPoint, self.role.color, 10, self.role.label.replace('Role ', ''))
      if (learnerSpot) dot(learnerSpot, '#ffffff', 9, 'you', true)

      ctx.fillStyle = '#8e8793'
      ctx.fillText('▼ front (camera) ▼', w / 2, h - 7)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [videoRef, referenceCamera])

  return <canvas ref={canvasRef} className="floor-radar" />
}
