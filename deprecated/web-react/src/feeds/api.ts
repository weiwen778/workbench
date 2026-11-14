import { http } from '@/api/client'

export interface TranslationStatus {
  configured: boolean
  provider: string | null
  provider_name: string | null
  target_lang: string
  message: string
}

export interface HotNews {
  title: string
  url: string
  source: string
}

export interface HotEntry {
  source_id: string
  external_id: string
  entry_key: string
  title: string
  url: string
  summary: string
  language: string
  published_at: string | null
  fetched_at: string | null
  rank: number | null
  heat: string
  heat_label: string
  link_kind: 'article' | 'search' | 'topic' | string
  discussion_url: string
  news: HotNews[]
  translation: string
}

export interface HotSource {
  id: string
  section: 'domestic' | 'overseas' | string
  label: string
  platform: string
  type_label: string
  homepage: string
  provider_hint: string
  auto_update: boolean
  interval_seconds: number
  status: string
  provider: string
  provider_note: string
  last_attempt_at: string | null
  last_success_at: string | null
  upstream_updated_at: string | null
  next_attempt_at: string | null
  last_error: string | null
  error_code: string | null
  entry_count: number
  entries: HotEntry[]
}

export interface HotPayload {
  sections: { key: string; label: string; description: string; sources: HotSource[] }[]
  source_count: number
  generated_at: string
  translation: TranslationStatus
}

export interface Subscription {
  id: number
  title: string
  url: string
  host: string
  feed_kind: string
  enabled: boolean
  is_default: boolean
  default_key: string | null
  status: string
  last_attempt_at: string | null
  last_success_at: string | null
  next_attempt_at: string | null
  last_error: string | null
  error_code: string | null
  entry_count: number
  unread_count: number
  created_at: string
  updated_at: string
}

export interface FeedEntry {
  id: number
  source_id: string
  subscription_id: number
  subscription_title: string
  subscription_url: string
  subscription_deleted: boolean
  external_id: string
  title: string
  url: string
  summary: string
  language: string
  link_kind: string
  discussion_url: string
  published_at: string | null
  discovered_at: string
  read: boolean
  favorite: boolean
  translation: string
}

export interface SubscriptionPreview {
  url: string
  title: string
  feed_kind: string
  entry_count: number
  entries: { title: string; url: string; published_at: string | null }[]
}

export interface CommonItem {
  key: string
  title: string
  platform: string
  url: string
  note: string
}

export interface CommonGroup {
  key: string
  label: string
  description: string
  items: CommonItem[]
}

export interface TranslationResult {
  items: { source_text: string; target_text: string; cached: boolean }[]
  provider: string | null
  provider_name: string | null
  target_lang: string
  error: string
}

export async function getHot(): Promise<HotPayload> {
  return (await http.get('/feeds/hot')).data
}

export async function refreshHot(sourceIds?: string[], force = true): Promise<{ started: string[]; joined: string[] }> {
  return (await http.post('/feeds/hot/refresh', { source_ids: sourceIds, force })).data
}

export async function getSubscriptions(): Promise<{ items: Subscription[]; translation: TranslationStatus }> {
  return (await http.get('/feeds/subscriptions')).data
}

export async function previewSubscription(url: string): Promise<SubscriptionPreview> {
  return (await http.post('/feeds/subscriptions/preview', { url })).data
}

export async function addSubscription(url: string, title?: string): Promise<Subscription> {
  return (await http.post('/feeds/subscriptions', { url, title })).data
}

export async function updateSubscription(id: number, patch: { title?: string; enabled?: boolean }): Promise<Subscription> {
  return (await http.patch(`/feeds/subscriptions/${id}`, patch)).data
}

export async function deleteSubscription(id: number): Promise<void> {
  await http.delete(`/feeds/subscriptions/${id}`)
}

export async function refreshSubscriptions(ids?: number[], force = true): Promise<{ started: number[]; joined: number[] }> {
  return (await http.post('/feeds/subscriptions/refresh', { subscription_ids: ids, force })).data
}

export async function getEntries(params: {
  subscription_id?: number
  unread?: boolean
  favorite?: boolean
  limit?: number
  offset?: number
}): Promise<{ total: number; items: FeedEntry[]; limit: number; offset: number }> {
  return (await http.get('/feeds/entries', { params })).data
}

export async function updateEntry(id: number, patch: { read?: boolean; favorite?: boolean }): Promise<FeedEntry> {
  return (await http.patch(`/feeds/entries/${id}`, patch)).data
}

export async function translateTitles(texts: string[], provider?: string): Promise<TranslationResult> {
  return (await http.post('/feeds/translations', { texts, target_lang: 'zh', provider })).data
}

export async function getTranslationStatus(): Promise<TranslationStatus> {
  return (await http.get('/feeds/translation-status')).data
}

export async function getCommonSources(): Promise<{ groups: CommonGroup[]; note: string }> {
  return (await http.get('/feeds/common')).data
}

export interface CalendarEvent {
  kind: 'race' | 'holiday'
  date: string
  title: string
  url: string
  country?: string
  city?: string
  distance?: string
}

export interface CalendarPayload {
  start: string
  end: string
  events: CalendarEvent[]
  status: string
  last_success_at: string | null
  last_error: string | null
  race_window_exceeded: boolean
}

export interface RuleSource {
  key: string
  title: string
  platform: string
  url: string
  note: string
  status: string
  entries: { title: string; url: string; published_at: string | null; badge: string; summary: string }[]
  last_success_at: string | null
  last_error: string | null
}

export interface DataPanelsPayload {
  subscriptions: { items: FeedEntry[]; total: number; unread: number }
  rules: RuleSource[]
  links: { key: string; title: string; url: string; badge: string }[]
}

export async function getCalendar(start: string, end: string): Promise<CalendarPayload> {
  return (await http.get('/feeds/calendar', { params: { start, end } })).data
}

export async function getDataPanels(): Promise<DataPanelsPayload> {
  return (await http.get('/feeds/data-panels')).data
}

export async function refreshCommon(key: string): Promise<{ queued: boolean; reason?: string; retry_after?: number }> {
  return (await http.post(`/feeds/common/${key}/refresh`)).data
}
