import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ui.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  size?: 'large' | 'medium'
  /** Stretches the button across its container. */
  block?: boolean
  icon?: ReactNode
}

/** Primary and secondary call to action. Large is 52px tall and medium is 44px, as in Figma. */
export function Button({ variant = 'primary', size = 'large', block = false, icon, className = '', type = 'button', children, ...rest }: ButtonProps) {
  return <button type={type} className={`ui-button is-${variant} is-${size} ${block ? 'is-block' : ''} ${className}`} {...rest}>
    {icon}
    {children}
  </button>
}
