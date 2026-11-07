import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteTakeVideo, listTakeVideos, saveTakeVideo, videoExtension, type SavedTakeVideo } from '../takeVideos'
import type { Take } from '../takes'
import './TakeReplay.css'

type TakeReplayProps = {
  rehearsalId: string
  phraseNumber: number
  take: Take
  fix: string
}

const timeOfDay = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * Replay of what the learner saw while dancing (webcam, overlays, reference corner, music), next to
 * the feedback. Every take is kept in this browser so earlier takes can be rewatched and compared
 * after acting on a correction; each can be downloaded or deleted.
 */
export function TakeReplay({ rehearsalId, phraseNumber, take, fix }: TakeReplayProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const savedRef = useRef<Take | null>(null)
  const [saved, setSaved] = useState<SavedTakeVideo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rate, setRate] = useState(1)
  const [storageFailed, setStorageFailed] = useState(false)

  // Save each new take once, then list this phrase's saved takes.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (take.recording && savedRef.current !== take) {
        savedRef.current = take
        const ok = await saveTakeVideo({
          id: `${rehearsalId}|${take.roleId}|${take.phraseId}|${Date.now()}`,
          rehearsalId,
          roleId: take.roleId,
          phraseId: take.phraseId,
          takeNumber: take.number,
          createdAt: Date.now(),
          score: take.review.score,
          fix,
          mimeType: take.recording.mimeType,
          blob: take.recording.blob,
        })
        if (!ok && !cancelled) setStorageFailed(true)
      }
      const list = await listTakeVideos(rehearsalId, take.roleId, take.phraseId)
      if (!cancelled) { setSaved(list); setSelectedId((current) => current ?? list[0]?.id ?? null) }
    })()
    return () => { cancelled = true }
  }, [rehearsalId, take, fix])

  // An earlier saved take gets an object URL while it is chosen; it is released when switching away.
  const selectedItem = saved.find((entry) => entry.id === selectedId)
  const savedUrl = useMemo(() => (selectedItem && selectedItem.blob !== take.recording?.blob ? URL.createObjectURL(selectedItem.blob) : null), [selectedItem, take.recording])
  useEffect(() => () => { if (savedUrl) URL.revokeObjectURL(savedUrl) }, [savedUrl])
  const selectedUrl = savedUrl ?? take.recording?.url ?? null

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate }, [rate, selectedUrl])

  const selected = selectedItem
  const remove = async (id: string) => {
    await deleteTakeVideo(id)
    setSaved((list) => list.filter((entry) => entry.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  if (!take.recording && !saved.length) {
    return <section className="take-replay is-empty"><p className="text-body-small text-muted">This browser could not record the take video, so there is nothing to replay. The scores below still come from your movement.</p></section>
  }

  return <section className="take-replay">
    <div className="take-replay-head">
      <h3 className="text-h4">Replay {selected ? `take ${selected.takeNumber}` : `take ${take.number}`}</h3>
      <div className="take-replay-rate" role="group" aria-label="Playback speed">
        {[0.5, 1].map((value) => <button key={value} type="button" className={rate === value ? 'is-on' : ''} onClick={() => setRate(value)}>{value}×</button>)}
      </div>
      {selectedUrl && <a className="take-replay-download" href={selectedUrl} download={`phrase-${phraseNumber}-take-${selected?.takeNumber ?? take.number}.${videoExtension(selected?.mimeType ?? take.recording?.mimeType ?? '')}`}>Download</a>}
    </div>
    {selectedUrl && <video ref={videoRef} className="take-replay-video" src={selectedUrl} controls playsInline />}
    {selected && <p className="take-replay-fix text-body-small"><b>Feedback on this take:</b> {selected.fix}</p>}
    {storageFailed && <p className="text-caption text-muted">This take could not be saved in the browser (storage full or blocked). Download it to keep it.</p>}
    {saved.length > 1 && <ol className="take-replay-list" aria-label="Saved takes for this phrase">
      {saved.map((entry) => <li key={entry.id} className={entry.id === selectedId ? 'is-selected' : ''}>
        <button type="button" onClick={() => setSelectedId(entry.id)}>
          <b>Take {entry.takeNumber}</b>
          <span>{entry.score ?? '–'}</span>
          <span className="take-replay-list-fix">{entry.fix}</span>
          <small>{timeOfDay(entry.createdAt)}</small>
        </button>
        <button type="button" className="take-replay-delete" aria-label={`Delete take ${entry.takeNumber}`} onClick={() => void remove(entry.id)}>×</button>
      </li>)}
    </ol>}
  </section>
}
