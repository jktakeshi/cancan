import type { Calibration, FloorPoint, ImagePoint } from './domain'

export type Homography = [number, number, number, number, number, number, number, number]

function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < matrix.length; column += 1) {
    let pivot = column
    for (let row = column + 1; row < matrix.length; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let index = column; index <= matrix.length; index += 1) augmented[column][index] /= divisor
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let index = column; index <= matrix.length; index += 1) augmented[row][index] -= factor * augmented[column][index]
    }
  }
  return augmented.map((row) => row[matrix.length])
}

export function calibrationErrors(calibration: Calibration): string[] {
  const errors: string[] = []
  if (!(calibration.widthM > 0 && calibration.depthM > 0)) errors.push('Floor dimensions must be positive.')
  if (!calibration.corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) {
    errors.push('All floor corners must lie inside the video.')
  }
  const [nearLeft, nearRight, farRight, farLeft] = calibration.corners
  const area = [nearLeft, nearRight, farRight, farLeft].reduce((sum, point, index, points) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
  if (Math.abs(area) < 0.005) errors.push('The selected floor corners are degenerate.')
  return errors
}

export function computeHomography(calibration: Calibration): Homography | null {
  if (calibrationErrors(calibration).length > 0) return null
  const targets: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: calibration.widthM, y: 0 },
    { x: calibration.widthM, y: calibration.depthM },
    { x: 0, y: calibration.depthM },
  ]
  const rows: number[][] = []
  const values: number[] = []
  calibration.corners.forEach((source, index) => {
    const target = targets[index]
    rows.push([source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y])
    values.push(target.x)
    rows.push([0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y])
    values.push(target.y)
  })
  const solved = solveLinearSystem(rows, values)
  return solved ? solved as Homography : null
}

export function projectToFloor(point: ImagePoint, homography: Homography): FloorPoint | null {
  const [a, b, c, d, e, f, g, h] = homography
  const denominator = g * point.x + h * point.y + 1
  if (Math.abs(denominator) < 1e-10) return null
  return {
    x: (a * point.x + b * point.y + c) / denominator,
    y: (d * point.x + e * point.y + f) / denominator,
  }
}

export function mapReferencePoint(point: FloorPoint, reference: Calibration, practice: Calibration): FloorPoint {
  const scale = Math.min(1, practice.widthM / reference.widthM, practice.depthM / reference.depthM)
  return {
    x: point.x * scale + (practice.widthM - scale * reference.widthM) / 2,
    y: point.y * scale + (practice.depthM - scale * reference.depthM) / 2,
  }
}

export const floorDistance = (a: FloorPoint, b: FloorPoint) => Math.hypot(a.x - b.x, a.y - b.y)

