import { ComingSoon } from '@/components/public/ComingSoon'

/** المَشَاهِد. Built in a later package; this route exists so the nav link is real, not a 404. */
export default function ScenesPage() {
  return (
    <ComingSoon
      title="المَشَاهِد"
      note="هذه الغرفة قيد الإعداد ولم تُنشر بعد."
    />
  )
}
