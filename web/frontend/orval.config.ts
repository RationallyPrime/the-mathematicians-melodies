import { defineConfig } from 'orval'

// Pydantic v2 -> OpenAPI -> typed fetch client + TanStack Query hooks (+ Zod).
// Run after the backend dumps openapi.json:  bun run gen
export default defineConfig({
  abra: {
    input: { target: '../backend/openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/api/generated',
      schemas: './src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      prettier: false,
      override: {
        mutator: { path: './src/api/client.ts', name: 'customFetch' },
        query: { useQuery: true, useMutation: true, signal: false },
        // the mutator already unwraps to the response body
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  abraZod: {
    input: { target: '../backend/openapi.json' },
    output: {
      mode: 'tags-split',
      target: './src/api/zod',
      client: 'zod',
      clean: true,
      prettier: false,
    },
  },
})
