import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { EditorPage } from './routes/EditorPage'
import { PlayerPage } from './routes/PlayerPage'
import { StudioPage } from './routes/StudioPage'

const rootRoute = createRootRoute({ component: Layout })

const playerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PlayerPage,
})

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor',
  component: EditorPage,
})

const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/studio',
  component: StudioPage,
})

const routeTree = rootRoute.addChildren([playerRoute, editorRoute, studioRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
