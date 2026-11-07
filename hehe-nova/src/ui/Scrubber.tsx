import { useEffect, useState } from 'react'
import './ui.css'

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/** Timeline under a video: current and total time above a seekable yellow progress track. */
export function Scrubber({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)

  // Follow the video clock every frame so the handle moves smoothly during playback.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const video = videoRef.current
      if (!video) return
      setTime((current) => (Math.abs(current - video.currentTime) > 0.02 ? video.currentTime : current))
      setDuration((current) => (Number.isFinite(video.duration) && video.duration !== current ? video.duration : current))
      setPlaying((current) => (current === !video.paused ? current : !video.paused))
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [videoRef])

  const fraction = duration > 0 ? time / duration : 0
  return <div className="ui-scrubber">
    <div className="times">
      <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { const video = videoRef.current; if (video) { if (video.paused) void video.play(); else video.pause() } }}>{playing ? 'Pause' : 'Play'}</button>
      <span>{clock(time)}</span>
      <span className="spacer" />
      <span>{clock(duration)}</span>
    </div>
    <input
      type="range"
      aria-label="Seek"
      min={0}
      max={duration || 0}
      step={0.01}
      value={time}
      onChange={(event) => { const video = videoRef.current; if (video) video.currentTime = Number(event.target.value) }}
      style={{ ['--progress' as string]: `${fraction * 100}%` }}
    />
  </div>
}
