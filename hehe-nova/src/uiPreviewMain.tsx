import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { UiPreview } from './ui/UiPreview'

// Entry point for the development component preview at /ui-preview.html.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UiPreview />
  </StrictMode>,
)
