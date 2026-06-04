import { Outlet } from '@tanstack/react-router'
import { NavPill } from './ui/NavPill'

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-6 border-b border-line bg-[color-mix(in_oklab,var(--color-surface)_82%,transparent)] px-6 backdrop-blur">
        <div className="flex flex-col leading-none">
          <span className="font-display text-xl text-on-surface sm:text-2xl">🐱 Afhverju Abra</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavPill to="/" exact>
            Player
          </NavPill>
          <NavPill to="/editor">Editor</NavPill>
          <NavPill to="/studio">Sing</NavPill>
        </nav>
        <span className="ml-auto font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted">
          the mathematician&rsquo;s melodies
        </span>
      </header>
      <main className="mx-auto max-w-[1000px] animate-folio-in px-5 pt-7 pb-24">
        <Outlet />
      </main>
    </div>
  )
}
