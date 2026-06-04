import { Link, Outlet } from '@tanstack/react-router'

export function Layout() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🐱 Afhverju Abra</span>
        <nav className="nav">
          <Link
            to="/"
            className="navlink"
            activeOptions={{ exact: true }}
            activeProps={{ className: 'navlink active' }}
          >
            Player
          </Link>
          <Link to="/editor" className="navlink" activeProps={{ className: 'navlink active' }}>
            Editor
          </Link>
          <Link to="/studio" className="navlink" activeProps={{ className: 'navlink active' }}>
            Sing
          </Link>
        </nav>
        <span className="sub">the mathematician&rsquo;s melodies</span>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
