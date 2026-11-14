import Dexie, { type Table } from 'dexie'

/**
 * Versioned IndexedDB schema for recoverable local work. Everything that is
 * only a browser-side working copy lives here; the server remains the source
 * of truth for saved records and versions.
 */
export interface DocumentDraftRecord {
  key: string
  userId: number
  title: string
  markdown: string
  format: string
  savedAt: string
  updatedAt: number
  schemaVersion: number
}

class WorkbenchLocalDB extends Dexie {
  documentDrafts!: Table<DocumentDraftRecord, string>

  constructor() {
    super('nexus-workbench')
    this.version(1).stores({
      documentDrafts: '&key, userId, updatedAt',
    })
  }
}

export const localDb = new WorkbenchLocalDB()
