export type ImagePoint = { x: number; y: number }
export type FloorPoint = { x: number; y: number }

export type Calibration = {
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint]
  widthM: number
  depthM: number
}

export type PoseLandmark = {
  x: number
  y: number
  z: number
  visibility: number
}

export type PoseSample = {
  timeMs: number
  landmarks: PoseLandmark[]
}

export type CountMark = {
  count: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  timeSec: number
}

export type HighlightKeyframe = {
  timeSec: number
  center: ImagePoint
  radius: number
}

export type PoseTarget = {
  count: number
  landmarks: PoseLandmark[]
}

export type MovementEvent = {
  count: number
  kind: 'travel-start' | 'left-plant' | 'right-plant' | 'direction-change' | 'arrival'
  toleranceMs: number
}

export type RoleTarget = {
  id: string
  label: string
  color: string
  highlights: HighlightKeyframe[]
  startFloor: FloorPoint
  pathFloor: FloorPoint[]
  finishFloor: FloorPoint
  poseTargets: PoseTarget[]
  movementEvents: MovementEvent[]
}

export type TeachingChunk = {
  startCount: number
  endCount: number
  instruction: string
}

export type Phrase = {
  id: string
  label: string
  startSec: number
  endSec: number
  counts: CountMark[]
  roles: RoleTarget[]
  teachingChunks: TeachingChunk[]
}

export type RehearsalManifest = {
  title: string
  frontVideo?: string
  alternateVideo?: string
  referenceCalibration: Calibration
  phrases: Phrase[]
  placeholder: boolean
  /** How many dancers appear in the front video. */
  dancerCount?: number
  /** Manually verified times (seconds) of count 1 and count 8 of the first phrase. */
  countAnchors?: { countOneSec: number; countEightSec: number }
}

export type ExpectedDimension = 'pass' | 'fail' | 'inconclusive'

export type LearnerAttemptFixture = {
  id: string
  label: string
  video?: string
  phraseId: string
  intendedRoleId: string
  calibration: Calibration
  expected: {
    visibility: ExpectedDimension
    timing: ExpectedDimension
    formation: ExpectedDimension
    posture: ExpectedDimension
    primaryCorrection: string
  }
}

export type DimensionResult = {
  status: ExpectedDimension
  score?: number
  measured?: Record<string, number>
  reason: string
}

export type AttemptResult = {
  visibility: DimensionResult
  timing: DimensionResult
  footwork: DimensionResult
  formation: DimensionResult
  posture: DimensionResult
  primaryCorrection: string
  landing?: FloorPoint
}

export type AttemptSource =
  | { kind: 'webcam' }
  | { kind: 'fixture'; fixture: LearnerAttemptFixture }
