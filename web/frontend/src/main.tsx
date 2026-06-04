import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (reproducible, no CDN runtime dep): Instrument Serif
// (display) · Inter (body) · JetBrains Mono (timecode).
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import { queryClient } from './queryClient'
import { router } from './router'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('missing #root element')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
