import { fileURLToPath } from 'node:url'

// Shared configuration for the React E2E scripts.
// Override with environment variables; never commit real credentials.
export const base = process.env.WB_BASE || 'http://127.0.0.1:18080'
export const password = process.env.WB_E2E_PASSWORD || process.env.WB_ADMIN_PASSWORD || 'admin12345'
export const out = (process.env.WB_OUTPUT || fileURLToPath(new URL('../.run/react-smoke/', import.meta.url))).replace(/[\\/]+$/, '')
