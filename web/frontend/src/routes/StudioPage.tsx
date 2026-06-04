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
      <p className="status err">
        Recording needs HTTPS or localhost (getUserMedia/AudioWorklet require a secure context).
      </p>
    )
  }

  if (project.isLoading || recording.isLoading) return <p className="status">Loading the studio…</p>
  if (project.error || !project.data || recording.error || !recording.data) {
    return (
      <p className="status err">
        Couldn&rsquo;t reach the API. Start it with <code>uv run python -m abra_api</code> on :8000.
      </p>
    )
  }

  return (
    <div className="studio">
      <RecordingStudio
        lyrics={project.data.lyrics}
        render={project.data.render}
        config={recording.data}
      />
      <TakeList />
    </div>
  )
}
