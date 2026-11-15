import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/ui/feedback'
import {
  adoptPet, fetchPet, renamePet, runPetAction,
  type PetAction, type PetEnvelope,
} from './api'

export const PET_KEY = ['pet'] as const

export function usePetQuery() {
  return useQuery({
    queryKey: PET_KEY,
    queryFn: fetchPet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useAdoptPet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name?: string) => adoptPet(name),
    onSuccess: (data) => {
      qc.setQueryData<PetEnvelope>(PET_KEY, { pet: data.pet, daily_bonus: null })
      // 提示放在 hook 层：AdoptCard 会在领养成功后立刻卸载，组件级 onSuccess 会丢。
      toast.success('领养成功')
    },
  })
}

export function useRenamePet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => renamePet(name),
    onSuccess: (data) => qc.setQueryData<PetEnvelope>(PET_KEY, (prev) => ({ pet: data.pet, daily_bonus: prev?.daily_bonus ?? null })),
  })
}

export function usePetAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: PetAction) => runPetAction(action),
    onSuccess: (data) => qc.setQueryData<PetEnvelope>(PET_KEY, { pet: data.pet, daily_bonus: null }),
    onError: () => { void qc.invalidateQueries({ queryKey: PET_KEY }) },
  })
}
