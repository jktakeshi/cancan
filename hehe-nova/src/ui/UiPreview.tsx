import { useState } from 'react'
import { Brand } from './Brand'
import { Button } from './Button'
import { Chip } from './Chip'
import { CountCell } from './CountCell'
import { PhraseCard } from './PhraseCard'
import { ScoreBar } from './ScoreBar'
import { SegmentedControl } from './SegmentedControl'
import { StepCard } from './StepCard'
import { TextField } from './TextField'
import { VideoCard } from './VideoCard'

/*
  Development page that shows every shared component in its states, for comparison with the
  Figma Components section. Served by Vite at /ui-preview.html and not part of the app flow.
  The values below only exercise the components and are not product data.
*/

const section = { display: 'grid', gap: 16, padding: '32px 0', borderTop: '1px solid var(--border-subtle)' } as const
const row = { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' } as const

export function UiPreview() {
  const [view, setView] = useState('video')
  const [speed, setSpeed] = useState(0.5)
  const [selected, setSelected] = useState(true)
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px 80px' }}>
    <Brand />
    <h1 className="text-h1" style={{ margin: '24px 0 8px' }}>Shared components</h1>
    <p className="text-body-small text-muted">Tokens and components built from the Figma Components section.</p>

    <section style={section}>
      <h2 className="text-h3">Text styles</h2>
      <span className="text-hero">Hero 68</span>
      <span className="text-h1">Heading H1 40</span>
      <span className="text-h2">Heading H2 36</span>
      <span className="text-fix">Heading Fix 24</span>
      <span className="text-h3">Heading H3 22</span>
      <span className="text-h4">Heading H4 18</span>
      <span className="text-count">4</span>
      <span className="text-body-large">Body Large 19</span>
      <span className="text-body">Body Default 16</span>
      <span className="text-body-small">Body Small 14</span>
      <span className="text-caption">Body Caption 13</span>
      <span className="text-micro">Body Micro 12</span>
      <span className="text-mono">Mono Default 13</span>
      <span className="text-mono-small">Mono Small 12</span>
    </section>

    <section style={section}>
      <h2 className="text-h3">Colors</h2>
      <div style={row}>
        {['bg-canvas', 'bg-input', 'bg-surface', 'bg-stage', 'bg-raised', 'bg-active', 'bg-accent-tint', 'border-subtle', 'border-default', 'border-strong', 'text-primary', 'text-secondary', 'text-muted', 'accent-role', 'accent-skeleton', 'dancer-other', 'status-score-good', 'status-score-mid', 'status-score-low', 'status-solid', 'status-progress'].map((name) => <div key={name} style={{ width: 120 }}>
          <div style={{ height: 40, borderRadius: 8, border: '1px solid var(--border-default)', background: `var(--${name})` }} />
          <span className="text-mono-small text-muted">{name}</span>
        </div>)}
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Button</h2>
      <div style={row}>
        <Button>Button</Button>
        <Button size="medium">Button</Button>
        <Button variant="secondary">Button</Button>
        <Button variant="secondary" size="medium">Button</Button>
        <Button disabled>Disabled</Button>
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Chip</h2>
      <div style={row}>
        <Chip>Role A</Chip>
        <Chip tone="neutral">Role A</Chip>
        <Chip tone="neutral" dotColor="var(--status-solid)">Solid</Chip>
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Segment</h2>
      <div style={row}>
        <SegmentedControl label="View mode" value={view} onChange={setView} options={[{ value: 'video', label: 'Video' }, { value: 'skeleton', label: 'Skeleton' }, { value: 'mirror', label: 'Mirror' }]} />
        <SegmentedControl label="Playback speed" value={speed} onChange={setSpeed} options={[0.25, 0.5, 0.75, 1].map((value) => ({ value, label: `${value}×` }))} />
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Count cell</h2>
      <div style={{ ...row, alignItems: 'stretch' }}>
        <div style={{ width: 90, display: 'grid' }}><CountCell count={1} step="Step R" /></div>
        <div style={{ width: 90, display: 'grid' }}><CountCell count={1} step="Step R" state="looped" /></div>
        <div style={{ width: 90, display: 'grid' }}><CountCell count={1} step="Step R" state="current" /></div>
        <div style={{ width: 90, display: 'grid' }}><CountCell count={2} step="Not clearly visible" unclear /></div>
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Score bar</h2>
      <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
        <ScoreBar label="Timing" score={88} />
        <ScoreBar label="Feet and travel" score={61} />
        <ScoreBar label="Formation position" score={42} />
        <ScoreBar label="Not measured" score={null} detail="Shown when a dimension could not be judged." />
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Phrase card</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        <PhraseCard name="Phrase 1" counts="1–8" description="Card description text." sketch={{ others: [{ x: 0.7, y: 0.2 }, { x: 0.3, y: 0.6 }], start: { x: 0.3, y: 0.2 }, end: { x: 0.45, y: 0.85 } }} status={<Chip tone="neutral">Role A</Chip>} />
        <PhraseCard name="Phrase 2" counts="9–16" selected={selected} onClick={() => setSelected((value) => !value)} sketch={{ others: [{ x: 0.6, y: 0.4 }], start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.7 } }} status={<span className="text-caption text-muted">Selectable</span>} badge={selected ? <Chip>Start</Chip> : undefined} />
        <PhraseCard name="Phrase 3" counts="17–24" sketch={null} />
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Video card</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        <VideoCard title="Card title" length="1:12" roleLabel="Role A" meta="Meta line" progress={['solid', 'solid', 'progress', 'weak', 'none', 'none']} next="Next line" />
        <VideoCard title="Without extras" />
      </div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Step card</h2>
      <div style={{ maxWidth: 413 }}><StepCard number="01" title="Step title" description="Step description text." /></div>
    </section>

    <section style={section}>
      <h2 className="text-h3">Text field</h2>
      <div style={{ maxWidth: 360 }}><TextField label="Rehearsal name" placeholder="e.g. Spring showcase, piece 2" hint="Optional hint text." /></div>
    </section>
  </main>
}
