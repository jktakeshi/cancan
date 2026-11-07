import './ui.css'
import logo from '../assets/logo.png'

/** CANCAN logo for the header. */
export function Brand({ onClick }: { onClick?: () => void }) {
  const content = <img className="logo" src={logo} alt="CANCAN" />
  return onClick
    ? <button type="button" className="ui-brand" onClick={onClick}>{content}</button>
    : <span className="ui-brand">{content}</span>
}
