import SkeletonPulse from '@/motion/components/SkeletonPulse'

export default function LoadingScreen({ text = '正在加载…' }: { text?: string }) {
  return <SkeletonPulse text={text} />
}
