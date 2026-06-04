import { useGetProject } from '../api/generated/project/project'
import { KaraokePlayer } from '../components/KaraokePlayer'

export function PlayerPage() {
  const { data, isLoading, error } = useGetProject()

  if (isLoading) return <p className="py-12 text-center text-muted">Loading the cut…</p>
  if (error || !data) {
    return (
      <p className="py-12 text-center text-error">
        Couldn&rsquo;t reach the API. Start it with <code>uv run python -m abra_api</code> on :5678.
      </p>
    )
  }
  return (
    <KaraokePlayer cut={data.cut} clips={data.clips} lyrics={data.lyrics} render={data.render} />
  )
}
