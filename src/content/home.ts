import type { Tone } from '@/components/weave/tones'

/**
 * The home page's room doors (D39). The words on each door come from the
 * room itself (its CMS line); these are the doors' order, colours and the
 * short facts under them. The scenes' categories are Anas's list (his brief,
 * section 1).
 */
export interface RoomDoor {
  href: string
  title: string
  tone: Tone
  /** A room with a CMS document shows its own line. */
  room?: 'started' | 'built' | 'passed' | 'shelf'
  line?: string
  meta?: string
  cta?: string
}

export const ROOM_DOORS: RoomDoor[] = [
  { href: '/started', title: 'بدأتُ من هنا', tone: 'coral', room: 'started', meta: 'منذ 2013' },
  { href: '/built', title: 'بنيتُ هنا', tone: 'aub', room: 'built', meta: 'رحى المكان' },
  { href: '/passed', title: 'مررتُ من هنا', tone: 'paper', room: 'passed', meta: 'من 2013 إلى اليوم' },
  { href: '/shelf', title: 'على الرف', tone: 'aub', room: 'shelf', meta: 'ذرى · كوب ضوء القمر · بوتيك أنس القرني' },
  {
    href: '/book',
    title: 'كتبتُ هنا',
    tone: 'saffron',
    line: 'ليست كل المدن تُحفظ في الخرائط… بعضها يعيش في الذاكرة.',
    meta: 'خوص | حكايات شارع 4',
  },
  { href: '/journal', title: 'المجلس', tone: 'paper' },
  { href: '/scenes', title: 'المَشاهد', tone: 'aub', line: 'أماكن · مشاريع · منتجات · رحلات · خلف الكواليس' },
  {
    href: '/contact',
    title: 'تواصل',
    tone: 'coral',
    line: 'إذا كانت لديك فكرة تستحق أن تُبنى…فلنتحدث.',
    cta: 'فلنتحدث',
  },
]
