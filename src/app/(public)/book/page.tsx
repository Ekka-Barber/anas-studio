import { ComingSoon } from '@/components/public/ComingSoon'

/** كُتبت هنا — the physical book reader. Built in a later package (P02); this route exists so the nav link is real, not a 404. */
export default function BookPage() {
  return (
    <ComingSoon
      title="كُتبت هنا"
      note="هذه الغرفة قيد الإعداد ولم تُنشر بعد. تجربة الكتاب وقراءته ستصل في مرحلة لاحقة من الموقع."
    />
  )
}
