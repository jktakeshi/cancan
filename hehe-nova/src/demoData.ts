import type { LearnerAttemptFixture, PoseLandmark, RehearsalManifest } from './domain'

const emptyPose = (): PoseLandmark[] => Array.from({ length: 33 }, (_, index) => ({
  x: 0.5 + ((index % 3) - 1) * 0.02,
  y: 0.25 + index * 0.015,
  z: 0,
  visibility: 1,
}))

const beatSec = 60 / 142.5
const firstCountSec = 2.606

const countMarks = (startSec: number) => Array.from({ length: 8 }, (_, index) => ({
  count: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  timeSec: startSec + index * beatSec,
}))

export const demoManifest: RehearsalManifest = {
  title: 'Demo rehearsal',
  frontVideo: '/rehearsal2.MOV',
  dancerCount: 3,
  // Verified by ear: "5, 6, 7, 8" is called before count 1 (just before 0:04); count 8 lands near 0:09.
  countAnchors: { countOneSec: 3.7, countEightSec: 8.8 },
  placeholder: true,
  referenceCalibration: {
    corners: [
      { x: 0.12, y: 0.9 },
      { x: 0.88, y: 0.9 },
      { x: 0.72, y: 0.48 },
      { x: 0.28, y: 0.48 },
    ],
    widthM: 4,
    depthM: 3,
  },
  phrases: [0, 1, 2, 3].map((phraseIndex) => {
    const startSec = firstCountSec + phraseIndex * 8 * beatSec
    return {
      id: `phrase-${phraseIndex + 1}`,
      label: `Eight-count ${phraseIndex + 1}`,
      startSec,
      endSec: startSec + 8 * beatSec,
      counts: countMarks(startSec),
      teachingChunks: [
        { startCount: 1, endCount: 4, instruction: 'Step out, transfer weight, and begin traveling.' },
        { startCount: 5, endCount: 8, instruction: 'Continue the path and settle into the final shape on eight.' },
      ],
      roles: [
        {
          id: 'role-a',
          label: 'Role A',
          color: '#ff5d8f',
          highlights: [
            { timeSec: startSec, center: { x: 0.42, y: 0.55 }, radius: 0.11 },
            { timeSec: startSec + 8 * beatSec, center: { x: 0.27, y: 0.55 }, radius: 0.11 },
          ],
          startFloor: { x: 1.7, y: 1.5 },
          pathFloor: [{ x: 1.7, y: 1.5 }, { x: 1.2, y: 1.7 }, { x: 0.8, y: 1.8 }],
          finishFloor: { x: 0.8, y: 1.8 },
          poseTargets: [{ count: 8, landmarks: emptyPose() }],
          movementEvents: [
            { count: 3, kind: 'travel-start' as const, toleranceMs: 350 },
            { count: 8, kind: 'arrival' as const, toleranceMs: 350 },
          ],
        },
        {
          id: 'role-b',
          label: 'Role B',
          color: '#59d9ff',
          highlights: [
            { timeSec: startSec, center: { x: 0.58, y: 0.55 }, radius: 0.11 },
            { timeSec: startSec + 8 * beatSec, center: { x: 0.73, y: 0.55 }, radius: 0.11 },
          ],
          startFloor: { x: 2.3, y: 1.5 },
          pathFloor: [{ x: 2.3, y: 1.5 }, { x: 2.8, y: 1.7 }, { x: 3.2, y: 1.8 }],
          finishFloor: { x: 3.2, y: 1.8 },
          poseTargets: [{ count: 8, landmarks: emptyPose() }],
          movementEvents: [
            { count: 3, kind: 'travel-start' as const, toleranceMs: 350 },
            { count: 8, kind: 'arrival' as const, toleranceMs: 350 },
          ],
        },
        {
          id: 'role-c',
          label: 'Role C',
          color: '#ffd166',
          highlights: [
            { timeSec: startSec, center: { x: 0.5, y: 0.48 }, radius: 0.075 },
            { timeSec: startSec + 8 * beatSec, center: { x: 0.5, y: 0.55 }, radius: 0.11 },
          ],
          startFloor: { x: 2, y: 2.5 },
          pathFloor: [{ x: 2, y: 2.5 }, { x: 2, y: 2.1 }, { x: 2, y: 1.8 }],
          finishFloor: { x: 2, y: 1.8 },
          poseTargets: [{ count: 8, landmarks: emptyPose() }],
          movementEvents: [
            { count: 3, kind: 'travel-start' as const, toleranceMs: 350 },
            { count: 8, kind: 'arrival' as const, toleranceMs: 350 },
          ],
        },
      ],
    }
  }),
}

const practiceCalibration = demoManifest.referenceCalibration

export const demoFixtures: LearnerAttemptFixture[] = [
  {
    id: 'correct-a',
    label: 'Correct Role A (video pending)',
    phraseId: 'phrase-1',
    intendedRoleId: 'role-a',
    calibration: practiceCalibration,
    expected: { visibility: 'pass', timing: 'pass', formation: 'pass', posture: 'pass', primaryCorrection: 'Strong landing.' },
  },
  {
    id: 'same-landing',
    label: 'Same landing reveal (video pending)',
    phraseId: 'phrase-1',
    intendedRoleId: 'role-a',
    calibration: practiceCalibration,
    expected: { visibility: 'pass', timing: 'pass', formation: 'pass', posture: 'pass', primaryCorrection: 'Strong landing.' },
  },
  {
    id: 'feet-occluded',
    label: 'Occluded feet (video pending)',
    phraseId: 'phrase-1',
    intendedRoleId: 'role-a',
    calibration: practiceCalibration,
    expected: { visibility: 'inconclusive', timing: 'inconclusive', formation: 'inconclusive', posture: 'inconclusive', primaryCorrection: 'Move back so both feet stay visible.' },
  },
]
