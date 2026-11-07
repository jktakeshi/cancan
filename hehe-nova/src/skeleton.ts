import type { PoseLandmark } from './domain'

/*
 * Stick-figure rendering shared by the reference player and the practice view.
 * Landmarks are unmirrored normalized video coordinates; drawing maps them into the
 * rendered video content rectangle so letterboxing never shifts the figure.
 */

/** Virtual landmark appended after MediaPipe's 33 points: midpoint of the shoulders. */
export const NECK = 33

export type Limb = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg'

export const LIMBS: Record<Limb, [number, number][]> = {
  head: [[0, NECK]],
  torso: [[NECK, 11], [NECK, 12], [11, 23], [12, 24], [23, 24]],
  leftArm: [[11, 13], [13, 15]],
  rightArm: [[12, 14], [14, 16]],
  leftLeg: [[23, 25], [25, 27], [27, 29], [29, 31], [27, 31]],
  rightLeg: [[24, 26], [26, 28], [28, 30], [30, 32], [28, 32]],
}

/** Joints drawn as dots. Feet tips/heels are drawn smaller than the major joints. */
const MAJOR_JOINTS = [0, NECK, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
const MINOR_JOINTS = [29, 30, 31, 32]
const LEFT_SIDE = new Set([11, 13, 15, 23, 25, 27, 29, 31])

export type ContentRect = { left: number; top: number; width: number; height: number }

/** The rectangle an `object-fit: contain` video actually occupies inside its element box. */
export function containRect(boxWidth: number, boxHeight: number, mediaWidth: number, mediaHeight: number): ContentRect {
  if (!(boxWidth > 0 && boxHeight > 0 && mediaWidth > 0 && mediaHeight > 0)) return { left: 0, top: 0, width: boxWidth, height: boxHeight }
  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight)
  const width = mediaWidth * scale
  const height = mediaHeight * scale
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height }
}

export function videoContentRect(video: HTMLVideoElement): ContentRect {
  return containRect(video.clientWidth, video.clientHeight, video.videoWidth, video.videoHeight)
}

export function withNeck(landmarks: PoseLandmark[]): PoseLandmark[] {
  const left = landmarks[11]
  const right = landmarks[12]
  if (!left || !right) return landmarks
  const next = [...landmarks]
  next[NECK] = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2, visibility: Math.min(left.visibility, right.visibility) }
  return next
}

/** Linear blend between two poses of the same person; visibility takes the weaker of the two. */
export function interpolatePose(a: PoseLandmark[], b: PoseLandmark[], t: number): PoseLandmark[] {
  return a.map((start, index) => {
    const end = b[index]
    if (!end) return start
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
      visibility: Math.min(start.visibility, end.visibility),
    }
  })
}

export type SkeletonStyle = {
  color: string
  /** The dancer being learned is drawn bold; other dancers are drawn faint. */
  emphasis: boolean
  minVisibility?: number
  label?: string
  /** Mirror horizontally inside the content rect (selfie view). */
  mirrored?: boolean
}

export function drawSkeleton(ctx: CanvasRenderingContext2D, rawLandmarks: PoseLandmark[], rect: ContentRect, style: SkeletonStyle) {
  if (rawLandmarks.length < 33) return
  const landmarks = withNeck(rawLandmarks)
  const minVisibility = style.minVisibility ?? 0.35
  const shown = (index: number) => (landmarks[index]?.visibility ?? 0) >= minVisibility
  const px = (index: number) => {
    const point = landmarks[index]
    const x = style.mirrored ? 1 - point.x : point.x
    return [rect.left + x * rect.width, rect.top + point.y * rect.height] as const
  }

  // Scale strokes with the dancer's on-screen size so far-away dancers stay readable.
  const torso = shown(NECK) && (shown(23) || shown(24))
    ? Math.hypot(px(NECK)[0] - px(shown(23) ? 23 : 24)[0], px(NECK)[1] - px(shown(23) ? 23 : 24)[1])
    : rect.height * 0.12
  const bone = Math.max(2, Math.min(9, torso * (style.emphasis ? 0.09 : 0.05)))
  const joint = Math.max(2.5, Math.min(8, torso * (style.emphasis ? 0.07 : 0.04)))

  ctx.save()
  ctx.globalAlpha = style.emphasis ? 1 : 0.55
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const strokeBones = (width: number, color: string, side?: 'left' | 'right') => {
    ctx.lineWidth = width
    ctx.strokeStyle = color
    for (const [limb, bones] of Object.entries(LIMBS) as [Limb, [number, number][]][]) {
      const isLeft = limb === 'leftArm' || limb === 'leftLeg'
      const isRight = limb === 'rightArm' || limb === 'rightLeg'
      if (side === 'left' && !isLeft) continue
      if (side === 'right' && !isRight) continue
      ctx.beginPath()
      for (const [a, b] of bones) {
        if (!shown(a) || !shown(b)) continue
        ctx.moveTo(...px(a))
        ctx.lineTo(...px(b))
      }
      ctx.stroke()
    }
  }

  // Dark casing first so the figure reads against bright walls and floors.
  strokeBones(bone + 3, 'rgba(10, 10, 14, 0.75)')
  strokeBones(bone, style.color)
  if (style.emphasis) {
    // The dancer's left limbs get a light inner stripe so left/right is readable at a glance.
    strokeBones(Math.max(1, bone * 0.35), 'rgba(255, 255, 255, 0.85)', 'left')
  }

  const dot = (index: number, radius: number) => {
    if (!shown(index)) return
    const [x, y] = px(index)
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = LEFT_SIDE.has(index) ? '#ffffff' : style.color
    ctx.fill()
    ctx.lineWidth = Math.max(1.5, radius * 0.45)
    ctx.strokeStyle = 'rgba(10, 10, 14, 0.85)'
    ctx.stroke()
  }
  for (const index of MAJOR_JOINTS) dot(index, index === 0 ? joint * 1.3 : joint)
  for (const index of MINOR_JOINTS) dot(index, joint * 0.6)

  if (style.label && shown(0)) {
    const [x, y] = px(0)
    const fontSize = style.emphasis ? 13 : 11
    ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
    const textWidth = ctx.measureText(style.label).width
    const top = y - torso * 0.55 - fontSize - 10
    ctx.fillStyle = style.color
    ctx.beginPath()
    ctx.roundRect(x - textWidth / 2 - 7, top, textWidth + 14, fontSize + 8, 6)
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(style.label, x, top + 4)
  }
  ctx.restore()
}

/** Size a canvas's backing store to its CSS box at device resolution and return a cleared 2D context in CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1
  const width = Math.round(canvas.clientWidth * ratio)
  const height = Math.round(canvas.clientHeight * ratio)
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  return ctx
}
