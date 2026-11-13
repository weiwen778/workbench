import { http } from '@/api/client'

export interface WhiteboardSummary {
  id: number
  title: string
  version: number
  element_count: number
  created_at: string
  updated_at: string
}

export interface WhiteboardDetail extends WhiteboardSummary {
  scene: { elements: any[]; appState: any }
}

export async function listWhiteboards(): Promise<WhiteboardSummary[]> {
  return (await http.get('/whiteboards')).data
}

export async function createWhiteboard(title: string): Promise<WhiteboardDetail> {
  return (await http.post('/whiteboards', { title })).data
}

export async function getWhiteboard(id: number): Promise<WhiteboardDetail> {
  return (await http.get(`/whiteboards/${id}`)).data
}

export async function saveWhiteboard(id: number, payload: { elements: any[]; app_state: any; version: number }): Promise<WhiteboardDetail> {
  return (await http.put(`/whiteboards/${id}`, payload)).data
}

export async function renameWhiteboard(id: number, title: string): Promise<WhiteboardSummary> {
  return (await http.patch(`/whiteboards/${id}`, { title })).data
}

export async function duplicateWhiteboard(id: number): Promise<WhiteboardDetail> {
  return (await http.post(`/whiteboards/${id}/duplicate`)).data
}

export async function deleteWhiteboard(id: number): Promise<void> {
  await http.delete(`/whiteboards/${id}`)
}

export async function uploadWhiteboardAsset(fileId: string, blob: Blob, mimeType: string): Promise<void> {
  const form = new FormData()
  form.append('file_id', fileId)
  const subtype = mimeType === 'image/svg+xml' ? 'svg' : (mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('+xml', '')
  form.append('file', blob, `${fileId}.${subtype}`)
  await http.post('/whiteboards/assets', form)
}

export async function getWhiteboardAsset(fileId: string): Promise<Blob> {
  return (await http.get(`/whiteboards/assets/${encodeURIComponent(fileId)}/content`, { responseType: 'blob' })).data
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

export function dataURLToBlob(dataURL: string): Blob {
  const [meta, content] = dataURL.split(',')
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/png'
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}
