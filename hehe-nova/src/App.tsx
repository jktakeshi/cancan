import { useState } from 'react'
import { bundledRehearsal, type Rehearsal } from './rehearsals'
import { Home } from './screens/Home'
import { Learn } from './screens/Learn'
import { PickPhrase } from './screens/PickPhrase'
import { PickRole } from './screens/PickRole'
import { Practice } from './screens/Practice'
import { RecordTake } from './screens/RecordTake'
import type { FlowStep } from './screens/StepIndicator'
import { formationSummary, loadProgress, saveProgress, type Take } from './takes'
import { useRehearsalSession } from './useRehearsalSession'
import { Workbench } from './Workbench'

type FlowScreen = 'role' | 'phrase' | 'learn' | 'practice' | 'workbench'

/**
 * The learning flow for one rehearsal. The shared session keeps tracked dancers and counts while
 * the learner moves between steps. The original Workbench page stays reachable from Practice for
 * test videos and manual floor calibration, and reuses the same analysis.
 */
function RehearsalFlow({ rehearsal, onHome }: { rehearsal: Rehearsal; onHome: () => void }) {
  const session = useRehearsalSession(rehearsal)
  const [screen, setScreen] = useState<FlowScreen>('role')
  const [roleId, setRoleId] = useState(session.roles[0].id)
  const [phraseId, setPhraseId] = useState(session.phrases[0].id)
  const [recording, setRecording] = useState<{ speed: number } | null>(null)
  const [take, setTake] = useState<Take | null>(null)
  const [takeCount, setTakeCount] = useState(0)
  // Read on every render: the store is a small JSON entry, and a saved take always causes a render.
  const progress = loadProgress(rehearsal.id, roleId, session.phrases.map((item) => item.id))

  const go = (next: FlowScreen) => { window.scrollTo(0, 0); setScreen(next) }
  const goStep = (step: FlowStep) => go(step)

  const phraseIndex = Math.max(0, session.phrases.findIndex((item) => item.id === phraseId))
  const phrase = session.phrases[phraseIndex]
  const role = session.roles.find((item) => item.id === roleId) ?? session.roles[0]
  const track = session.analysis.tracks.find((item) => item.id === role.id)

  const finishTake = (next: Take) => {
    const formation = formationSummary(next.positions)
    saveProgress(rehearsal.id, next.roleId, next.phraseId, { score: next.review.score, onSpot: formation.onSpot, placed: formation.placed, at: Date.now() })
    setTakeCount(next.number)
    setTake(next)
    setRecording(null)
    go('practice')
  }

  const recordDialog = recording && track
    ? <RecordTake session={session} phrase={phrase} phraseNumber={phraseIndex + 1} role={role} track={track} takeNumber={takeCount + 1} initialSpeed={recording.speed} onClose={() => setRecording(null)} onFinished={finishTake} />
    : null

  if (screen === 'workbench') {
    return <Workbench
      initialReferenceUrl={rehearsal.url}
      initialRoleId={roleId}
      initialDancerCount={session.dancerCount}
      initialPhraseId={phraseId}
      initialGridOverrides={session.gridOverrides}
      sharedAnalysis={session.analysis}
      onHome={onHome}
    />
  }
  if (screen === 'practice' && take) {
    const next = session.phrases[phraseIndex + 1]
    return <>
      <Practice
        session={session}
        take={take}
        onRetry={() => setRecording({ speed: take.speed })}
        onWatchAgain={() => go('learn')}
        onNextPhrase={next ? () => { setPhraseId(next.id); go('learn') } : null}
        onOpenWorkbench={() => go('workbench')}
        onStep={goStep}
        onHome={onHome}
      />
      {recordDialog}
    </>
  }
  if (screen === 'learn' || screen === 'practice') {
    return <>
      <Learn key={phraseId} session={session} roleId={roleId} phraseId={phraseId} onRecord={(speed) => setRecording({ speed })} onStep={goStep} onHome={onHome} />
      {recordDialog}
    </>
  }
  if (screen === 'phrase') {
    return <PickPhrase session={session} roleId={roleId} phraseId={phraseId} progress={progress} onPhraseChange={setPhraseId} onLearn={(id) => { setPhraseId(id); go('learn') }} onStep={goStep} onHome={onHome} />
  }
  return <PickRole session={session} roleId={roleId} onRoleChange={setRoleId} onPick={(id) => { setRoleId(id); go('phrase') }} onHome={onHome} />
}

function App() {
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>(bundledRehearsal ? [bundledRehearsal] : [])
  const [open, setOpen] = useState<Rehearsal | null>(null)

  if (open) {
    // Keyed by rehearsal so opening another video starts a fresh session.
    return <RehearsalFlow key={open.id} rehearsal={open} onHome={() => setOpen(null)} />
  }
  return <Home
    rehearsals={rehearsals}
    onAdd={(rehearsal) => setRehearsals((current) => [rehearsal, ...current])}
    onOpen={(rehearsal) => { window.scrollTo(0, 0); setOpen(rehearsal) }}
  />
}

export default App
