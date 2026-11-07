import { useEffect, useRef, useState, type DragEvent } from 'react'
import floorPathDecoration from '../assets/floorPathDecoration.svg'
import iconRefresh from '../assets/iconRefresh.svg'
import iconUploadButton from '../assets/iconUploadButton.svg'
import iconUploadDrop from '../assets/iconUploadDrop.svg'
import iconUploadHero from '../assets/iconUploadHero.svg'
import { formatDuration, nameFromFile, recommendedMaxDurationSec, type Rehearsal } from '../rehearsals'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
import { VideoCard } from '../ui/VideoCard'
import { AppHeader } from './AppHeader'
import './Home.css'

const steps = ['Upload or pick a rehearsal', 'Pick your role', 'Pick phrases to practice', 'Learn and practice', 'Feedback']

type HomeProps = {
  rehearsals: Rehearsal[]
  onAdd: (rehearsal: Rehearsal) => void
  onOpen: (rehearsal: Rehearsal) => void
}

/** A library card whose thumbnail is the first frame of the rehearsal video itself. */
function RehearsalCard({ rehearsal, onOpen }: { rehearsal: Rehearsal; onOpen: () => void }) {
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)
  const meta = rehearsal.source === 'bundled' ? 'Team rehearsal clip' : 'Added this session'
  return <VideoCard
    title={rehearsal.name}
    length={formatDuration(duration) || undefined}
    meta={failed ? 'This video could not be played in this browser' : meta}
    onClick={onOpen}
    thumbnail={failed ? undefined : <video
      // The media fragment asks the browser to show a frame just after the start instead of a black first frame.
      src={`${rehearsal.url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      onError={() => setFailed(true)}
    />}
  />
}

type PendingUpload = { file: File; url: string; duration: number | null }

function UploadPanel({ onAdd, pickerRef }: { onAdd: HomeProps['onAdd']; pickerRef: React.RefObject<HTMLInputElement | null> }) {
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const pendingRef = useRef<PendingUpload | null>(null)

  // A chosen file that was never added is released when the panel unmounts.
  useEffect(() => () => { if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url) }, [])

  const choose = (file: File | undefined) => {
    setError('')
    if (!file) return
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name)) {
      setError('That file is not a video. Choose an MP4 or MOV file.')
      return
    }
    if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url)
    const next: PendingUpload = { file, url: URL.createObjectURL(file), duration: null }
    pendingRef.current = next
    setPending(next)
    // Read the duration so a very long clip can be flagged before analysis starts.
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => setPending((current) => (current?.url === next.url ? { ...current, duration: probe.duration } : current))
    probe.onerror = () => setError('This video could not be read. Try an MP4 or MOV recorded on a phone or laptop.')
    probe.src = next.url
  }

  const add = () => {
    if (!pending) return
    onAdd({ id: `upload-${Date.now()}`, name: name.trim() || nameFromFile(pending.file.name), url: pending.url, source: 'upload', addedAt: Date.now() })
    pendingRef.current = null
    setPending(null)
    setName('')
  }

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files[0])
  }

  const tooLong = pending?.duration != null && pending.duration > recommendedMaxDurationSec

  return <section className="home-upload" aria-labelledby="upload-title">
    <h3 id="upload-title" className="text-h3">Upload a rehearsal</h3>
    <label
      className={`home-drop ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      // The file input is visually hidden, so the drop zone itself takes keyboard focus.
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickerRef.current?.click() } }}
    >
      <input ref={pickerRef} type="file" accept="video/*,.mov,.mp4" onChange={(event) => { choose(event.target.files?.[0]); event.target.value = '' }} />
      <img src={iconUploadDrop} width={36} height={36} alt="" />
      <span className="text-label-button">{pending ? pending.file.name : 'Drop a video or browse'}</span>
      <span className="text-caption text-muted">
        {pending
          ? `${formatDuration(pending.duration ?? 0) || 'Reading length…'} · click to choose another`
          : `MP4 or MOV, up to ${recommendedMaxDurationSec / 60} minutes. Filmed from the front works best.`}
      </span>
    </label>
    {tooLong && <p className="home-note is-warn">This clip is longer than {recommendedMaxDurationSec / 60} minutes. It will still work, but finding the dancers takes longer.</p>}
    {error && <p className="home-note is-error" role="alert">{error}</p>}
    <TextField label="Rehearsal name" placeholder={pending ? nameFromFile(pending.file.name) : 'e.g. Spring showcase, piece 2'} value={name} onChange={(event) => setName(event.target.value)} />
    <p className="home-note">Tempo and counts are detected from the music after you open the rehearsal.</p>
    <Button block disabled={!pending} onClick={add} icon={<img src={iconUploadButton} width={20} height={20} alt="" />}>Upload</Button>
  </section>
}

/** Landing page: what the product does, an upload panel, and the rehearsals available this session. */
export function Home({ rehearsals, onAdd, onOpen }: HomeProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLDivElement>(null)

  const startUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    pickerRef.current?.click()
  }

  return <div className="home">
    <AppHeader />
    <section className="home-hero">
      <img className="home-decoration" src={floorPathDecoration} width={1440} height={738} alt="" />
      <div className="home-pitch">
        <h1 className="text-hero">Missed rehearsal?<br />Learn <span className="text-accent">your</span> part, count by count.</h1>
        <p className="text-body-large text-secondary">Upload a choreography, tap your dancer, and learn one eight-count at a time. Record a take and get the one fix that matters most.</p>
        <div><Button onClick={startUpload} icon={<img src={iconUploadHero} width={20} height={20} alt="" />}>Upload a choreography</Button></div>
      </div>
      <div className="home-how">
        <h2 className="text-h2">How it works</h2>
        <ol className="home-steps">
          {steps.map((title, index) => <li key={title} className="home-step">
            {index === 4 && <span className="home-loop-icon" role="img" aria-label="Steps 4 and 5 repeat" title="Steps 4 and 5 repeat">
              <img src={iconRefresh} width={18} height={18} alt="" />
            </span>}
            <span className="text-mono-small text-accent">{String(index + 1).padStart(2, '0')}</span>
            <span className="home-step-title">{title}</span>
          </li>)}
        </ol>
      </div>
    </section>

    <section className="home-library" aria-labelledby="library-title">
      <h2 id="library-title" className="text-h2">Your rehearsals</h2>
      <div className="home-grid">
        <div ref={uploadRef}><UploadPanel onAdd={onAdd} pickerRef={pickerRef} /></div>
        {rehearsals.map((rehearsal) => <RehearsalCard key={rehearsal.id} rehearsal={rehearsal} onOpen={() => onOpen(rehearsal)} />)}
      </div>
    </section>

    <footer className="home-footer text-caption text-muted">
      <span>CANCAN · Team hehe · Nova Hackathon 2026</span>
      <span>Videos stay on your device</span>
    </footer>
  </div>
}
