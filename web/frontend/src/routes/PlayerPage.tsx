import { useGetProject } from '../api/generated/project/project'
import { KaraokePlayer } from '../components/KaraokePlayer'

export function PlayerPage() {
  const { data, isLoading, error } = useGetProject()

  if (isLoading) return <p className="status">Loading the cut…</p>
  if (error || !data) {
    return (
      <p className="status err">
        Couldn&rsquo;t reach the API. Start it with <code>uv run python -m abra_api</code> on :8000.
      </p>
    )
  }
  return (
    <KaraokePlayer cut={data.cut} clips={data.clips} lyrics={data.lyrics} render={data.render} />
  )
}
