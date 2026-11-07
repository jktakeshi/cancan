import './ui.css'

/** Logo mark and product name for the header. */
export function Brand({ onClick }: { onClick?: () => void }) {
  const content = <><span className="mark" aria-hidden="true" /><span className="name">Dance Catch-up</span></>
  return onClick
    ? <button type="button" className="ui-brand" onClick={onClick}>{content}</button>
    : <span className="ui-brand">{content}</span>
}
