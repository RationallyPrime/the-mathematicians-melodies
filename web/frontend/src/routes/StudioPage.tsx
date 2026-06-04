import { useGetProject } from '../api/generated/project/project'
import { useGetRecordingConfig } from '../api/generated/recording/recording'
import { RecordingStudio } from '../components/RecordingStudio'
import { TakeList } from '../components/TakeList'

export function StudioPage() {
  // Hooks first — every hook must run on every render before any conditional
  // return (rules of hooks). The secure-context guard comes AFTER them.
  const project = useGetProject()
  const recording = useGetRecordingConfig()

  // getUserMedia + AudioWorklet only exist in a secure context.
  if (!window.isSecureContext) {
    return (
      <p className="rounded-xl border border-error/50 bg-error/10 p-4 text-center font-mono text-sm text-error">
        Recording needs HTTPS or localhost (getUserMedia/AudioWorklet require a secure context).
      </p>
    )
  }

  if (project.isLoading || recording.isLoading)
    return (
      <p className="animate-folio-in p-8 text-center font-display text-xl text-muted">
        Loading the studio…
      </p>
    )
  if (project.error || !project.data || recording.error || !recording.data) {
    return (
      <p className="rounded-xl border border-error/50 bg-error/10 p-4 text-center font-mono text-sm text-error">
        Couldn&rsquo;t reach the API. Start it with <code>uv run python -m abra_api</code> on :5678.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <RecordingStudio
        lyrics={project.data.lyrics}
        render={project.data.render}
        config={recording.data}
      />
      <TakeList />
    </div>
  )
}
