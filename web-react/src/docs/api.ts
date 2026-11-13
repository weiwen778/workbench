import { http } from '@/api/client'

export type ProjectKind = 'pdf' | 'sheet' | 'document'

export interface ProjectAttachment {
  id: number
  name: string
  content_type: string
  size: number
  url: string
  download_url: string
}

export interface ProjectSummary {
  id: number
  kind: ProjectKind
  title: string
  version: number
  attachment_ids: number[]
  attachments: ProjectAttachment[]
  created_at: string
  updated_at: string
}

export interface ProjectDetail extends ProjectSummary {
  state: Record<string, any>
}

export interface ProjectInput {
  kind: ProjectKind
  title: string
  state: Record<string, any>
  attachment_ids: number[]
  version?: number
}

export async function uploadProjectFile(file: File): Promise<ProjectAttachment> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post('/files', form)
  return data
}

export async function getFileBytes(fileId: number): Promise<ArrayBuffer> {
  return (await http.get(`/files/${fileId}/content`, { responseType: 'arraybuffer' })).data
}

export async function listProjects(kind: ProjectKind): Promise<ProjectSummary[]> {
  return (await http.get('/document-projects', { params: { kind } })).data.items
}

export async function getProject(id: number): Promise<ProjectDetail> {
  return (await http.get(`/document-projects/${id}`)).data
}

export async function createProject(input: ProjectInput): Promise<ProjectDetail> {
  return (await http.post('/document-projects', input)).data
}

export async function updateProject(id: number, input: ProjectInput): Promise<ProjectDetail> {
  return (await http.put(`/document-projects/${id}`, input)).data
}

export async function deleteProject(id: number): Promise<void> {
  await http.delete(`/document-projects/${id}`)
}
