import { useId, type InputHTMLAttributes } from 'react'
import './ui.css'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
}

/** Labeled single line input. */
export function TextField({ label, hint, id, ...rest }: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return <div className="ui-text-field">
    <label className="label" htmlFor={inputId}>{label}</label>
    <input id={inputId} {...rest} />
    {hint && <span className="hint">{hint}</span>}
  </div>
}
