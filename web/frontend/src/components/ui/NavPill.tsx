import { Link } from '@tanstack/react-router'

export interface NavPillProps {
  to: string
  exact?: boolean
  children: React.ReactNode
}

const inactive =
  'rounded-full px-3.5 py-1.5 text-sm text-muted transition-colors hover:text-on-surface'
const active =
  'rounded-full px-3.5 py-1.5 text-sm font-medium text-on-primary bg-primary transition-colors'

export const NavPill = ({ to, exact, children }: NavPillProps) => (
  <Link
    to={to}
    className={inactive}
    activeOptions={exact ? { exact: true } : undefined}
    activeProps={{ className: active }}
  >
    {children}
  </Link>
)

NavPill.displayName = 'NavPill'
