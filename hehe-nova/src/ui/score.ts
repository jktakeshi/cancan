/** Score thresholds shared with the take review, so bar colors agree with the per-count scores. */
export const scoreBands = { good: 80, mid: 60 }

export function scoreTone(score: number | null): 'good' | 'mid' | 'low' | 'none' {
  if (score === null) return 'none'
  if (score >= scoreBands.good) return 'good'
  if (score >= scoreBands.mid) return 'mid'
  return 'low'
}
