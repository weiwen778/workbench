import { http } from '@/api/client'

export type PetStage = 'puppy' | 'adult' | 'senior'
export type PetStatus = 'sleeping' | 'sick' | 'hungry' | 'tired' | 'dirty' | 'sad' | 'great' | 'ok'
export type PetAction = 'feed' | 'treat' | 'wash' | 'play' | 'walk' | 'sleep' | 'wake' | 'vet' | 'pet'

export interface PetPayload {
  id: number
  name: string
  species: 'dog'
  stage: PetStage
  stage_label: string
  care_days: number
  stats: { satiety: number; cleanliness: number; mood: number; energy: number; health: number }
  status: PetStatus
  status_label: string
  sleeping: boolean
  poop_count: number
  treats: number
  cooldowns: Record<'feed' | 'treat' | 'wash' | 'play' | 'walk' | 'vet' | 'pet', number>
  next_stage_in_days: number | null
  version: number
  updated_at: string
}

export interface DailyBonus {
  mood: number
  treats: number
  source: 'checkin' | 'todo'
  date: string
}

export interface PetEnvelope {
  pet: PetPayload | null
  daily_bonus: DailyBonus | null
}

export interface PetActionResponse {
  pet: PetPayload
  event: 'fed' | 'treated' | 'washed' | 'played' | 'walked' | 'slept' | 'woke' | 'vetted' | 'petted'
  message: string
}

export async function fetchPet(): Promise<PetEnvelope> {
  return (await http.get('/pet')).data
}

export async function adoptPet(name?: string): Promise<{ pet: PetPayload }> {
  return (await http.post('/pet', { name: name?.trim() || undefined })).data
}

export async function renamePet(name: string): Promise<{ pet: PetPayload }> {
  return (await http.patch('/pet', { name })).data
}

export async function runPetAction(action: PetAction): Promise<PetActionResponse> {
  return (await http.post('/pet/actions', { action })).data
}
