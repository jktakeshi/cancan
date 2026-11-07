import { useEffect, useRef } from 'react'
import type { RoleTarget } from './domain'
import type { FloorPoint } from './floor'
import { HOLOGRAM_GREY, TARGET_COLOR } from './floorDrawing'
import { formationPositionsAt, type Formation } from './formations'
import { prepareCanvas } from './skeleton'
import './FormationsPanel.css'

type VideoRef = React.RefObject<HTMLVideoElement | null>

const shortLabel = (role: RoleTarget | undefined, id: string) => role?.label.replace(/^Dancer /, '') ?? id

type DiagramProps = {
  videoRef: VideoRef
  formations: Formation[]
  roles: RoleTarget[]
  dancerId: string | null
  /** The learner's live position in stage meters, if practicing. */
  learner?: FloorPoint | null
}

/**
 * The formation at the current video time, seen from above with the audience (camera) at the
 * bottom. Positions animate between formations during transitions.
 */
export function FormationDiagram({ videoRef, formations, roles, dancerId, learner }: DiagramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const learnerRef = useRef(learner)
  useEffect(() => { learnerRef.current = learner })

  useEffect(() => {
    const all = formations.flatMap((formation) => Object.values(formation.positions))
    const minX = Math.min(...all.map((p) => p.x)) - 0.8
    const maxX = Math.max(...all.map((p) => p.x)) + 0.8
    const minZ = Math.min(...all.map((p) => p.z)) - 0.8
    const maxZ = Math.max(...all.map((p) => p.z)) + 0.8
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video || !all.length) return
      const ctx = prepareCanvas(canvas)
      if (!ctx) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const stage = { left: 8, top: 22, width: w - 16, height: h - 44 }
      const k = Math.min(stage.width / (maxX - minX), stage.height / (maxZ - minZ))
      const at = (p: FloorPoint) => ({ x: stage.left + stage.width / 2 + (p.x - (minX + maxX) / 2) * k, y: stage.top + stage.height / 2 - (p.z - (minZ + maxZ) / 2) * k })

      ctx.fillStyle = '#26262a'
      ctx.beginPath()
      ctx.roundRect(stage.left, stage.top, stage.width, stage.height, 10)
      ctx.fill()
      ctx.strokeStyle = '#ffffff12'
      ctx.lineWidth = 1
      for (let m = Math.floor(minX); m <= maxX; m += 1) { const x = at({ x: m, z: 0 }).x; ctx.beginPath(); ctx.moveTo(x, stage.top); ctx.lineTo(x, stage.top + stage.height); ctx.stroke() }
      for (let m = Math.floor(minZ); m <= maxZ; m += 1) { const y = at({ x: 0, z: m }).y; ctx.beginPath(); ctx.moveTo(stage.left, y); ctx.lineTo(stage.left + stage.width, y); ctx.stroke() }
      ctx.font = '700 10px Inter, ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#9d9587'
      ctx.fillText('BACK', w / 2, 11)
      ctx.fillText('FRONT (camera) · 1 square = 1 m', w / 2, h - 11)

      const state = formationPositionsAt(video.currentTime, formations)
      if (!state) return
      const entries = Object.entries(state.positions).sort(([a], [b]) => Number(a === dancerId) - Number(b === dancerId))
      for (const [id, point] of entries) {
        const p = at(point)
        const mine = id === dancerId
        ctx.beginPath()
        ctx.arc(p.x, p.y, mine ? 12 : 9, 0, Math.PI * 2)
        ctx.fillStyle = mine ? TARGET_COLOR : HOLOGRAM_GREY
        ctx.fill()
        ctx.fillStyle = '#111'
        ctx.font = `800 ${mine ? 11 : 9}px Inter, ui-sans-serif, system-ui, sans-serif`
        ctx.fillText(shortLabel(roles.find((role) => role.id === id), id), p.x, p.y + 0.5)
      }
      const you = learnerRef.current
      if (you) {
        const p = at(you)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2)
        ctx.lineWidth = 3
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
        ctx.fillStyle = '#ffffff'
        ctx.fillText('you', p.x, p.y - 18)
      }
      const name = state.from === state.to ? formations[state.from].name : `${formations[state.from].name} → ${formations[state.to].name}`
      ctx.textAlign = 'left'
      ctx.fillStyle = '#f5f1e8'
      ctx.font = '800 12px Inter, ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(name, stage.left + 10, stage.top + 14)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [videoRef, formations, roles, dancerId])

  return <canvas ref={canvasRef} className="formation-diagram" />
}

type PanelProps = {
  videoRef: VideoRef
  formations: Formation[] | null
  roles: RoleTarget[]
  dancerId: string
  onSelectDancer: (id: string) => void
  enabled: boolean
  onToggle: () => void
  /** Human-readable position in the choreography for a video time (e.g. "Eight-count 1, count 3"). */
  describeTime: (timeSec: number) => string
  onSeek: (timeSec: number) => void
}

export function FormationsPanel({ videoRef, formations, roles, dancerId, onSelectDancer, enabled, onToggle, describeTime, onSeek }: PanelProps) {
  return <section className="card formations">
    <header>
      <div><small>FORMATIONS · LEARNED FROM THE VIDEO</small><h2>Where you stand</h2></div>
      <button className={`toggle ${enabled ? 'on' : ''}`} disabled={!formations?.length} onClick={onToggle}>{enabled ? '● Formation hologram ON' : '○ Formation hologram OFF'}</button>
    </header>
    <div className="dancer-pick">
      <span>I am</span>
      {roles.map((role) => <button key={role.id} className={dancerId === role.id ? 'on' : ''} onClick={() => onSelectDancer(role.id)} title={role.label}>
        <i style={{ background: role.color }} /><b>{shortLabel(role, role.id)}</b>
      </button>)}
    </div>
    {!formations && <p className="muted">Formations appear once dancers and counts are detected…</p>}
    {formations && !formations.length && <p className="muted">No held formations found — the group never stays in place for a few counts.</p>}
    {formations && formations.length > 0 && <div className="formation-body">
      <FormationDiagram videoRef={videoRef} formations={formations} roles={roles} dancerId={dancerId} />
      <ol className="formation-timeline">
        {formations.map((formation, index) => {
          const next = formations[index + 1]
          return <li key={formation.name}>
            <button onClick={() => onSeek(formation.startSec)}>
              <b>{formation.name}</b>
              <span>{describeTime(formation.startSec)} → {describeTime(formation.endSec)}</span>
              <small>{formation.startSec.toFixed(1)}–{formation.endSec.toFixed(1)} s</small>
            </button>
            {next && <p className="transition">↓ transition ({describeTime(formation.endSec)} → {describeTime(next.startSec)})</p>}
          </li>
        })}
        <li className="formation-note">A formation is a stretch of at least three counts where the group holds still. Click one to jump there. In practice, the hologram shows the others in grey and your spot in green.</li>
      </ol>
    </div>}
  </section>
}
