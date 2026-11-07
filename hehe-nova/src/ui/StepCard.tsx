import './ui.css'

type StepCardProps = {
  /** Two digit step number such as "01". */
  number: string
  title: string
  description?: string
}

/** One step of the how it works explanation. */
export function StepCard({ number, title, description }: StepCardProps) {
  return <div className="ui-step-card">
    <span className="number">{number}</span>
    <span className="title">{title}</span>
    {description && <p className="description">{description}</p>}
  </div>
}
