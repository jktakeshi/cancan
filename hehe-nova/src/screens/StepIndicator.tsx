import './StepIndicator.css'

export type FlowStep = 'role' | 'phrase' | 'learn' | 'practice'

const steps: { id: FlowStep; label: string }[] = [
  { id: 'role', label: '1 Role' },
  { id: 'phrase', label: '2 Phrase' },
  { id: 'learn', label: '3 Learn' },
  { id: 'practice', label: '4 Practice' },
]

/**
 * The four learning steps. Steps before the current one are outlined and can be revisited;
 * later steps stay inactive until the learner reaches them.
 */
export function StepIndicator({ current, onSelect }: { current: FlowStep; onSelect?: (step: FlowStep) => void }) {
  const currentIndex = steps.findIndex((step) => step.id === current)
  return <nav className="step-indicator" aria-label="Learning steps">
    {steps.map((step, index) => {
      const state = index === currentIndex ? 'is-current' : index < currentIndex ? 'is-done' : 'is-upcoming'
      return <button
        key={step.id}
        type="button"
        className={`step-pill ${state}`}
        aria-current={index === currentIndex ? 'step' : undefined}
        disabled={index >= currentIndex || !onSelect}
        onClick={() => onSelect?.(step.id)}
      >{step.label}</button>
    })}
  </nav>
}
