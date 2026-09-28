/**
 * تواصل (D39): Anas's line and his consulting services, from his earlier
 * services deck (anas-texts.md section 9: "scope to be confirmed by Anas,
 * show no prices"). Booking a time is P09; until then a service is requested
 * through the contact form, with the service named in the message.
 */
export const CONTACT = {
  title: ['إذا كانت لديك فكرة تستحق أن تُبنى…', 'فلنتحدث.'],
  servicesTitle: 'الاستشارات',
  servicesIntro:
    'نقدم الإستشارة العملية لوضع أساس لمشروعك في مجال الأطعمة والمشروبات ، بداية من المنتج المبتكر وحتى إدارة الحسابات الخاصة بك والمزيد من الخدمات الاستشارية',
  services: [
    { name: 'بناء القائمة', text: 'بناء قائمة مميزة ومبتكرة وتوريد منتجات تتناسب مع روح المكان. بناء دليل وصفات لكل صنف' },
    { name: 'تدريب الموظفين', text: 'تدريب الموظفين على كل صنف بشكل كامل حتى الاتقان مع المتابعه' },
    {
      name: 'تجهيز المطبخ',
      text: 'تصميم مطبخ يتناسب مع طبيعة العمل. توريد المعدات اللازمة. توزيع الأجهزة والمعدات لسرعة التنفيذ',
    },
    { name: 'حساب التكلفة', text: 'حساب تكلفة كل منتج. وضع سعر مقترح لكل منتج' },
    { name: 'التوريد', text: 'توريد بعض المواد الخام' },
    {
      name: 'التسويق والحسابات',
      text: 'إدارة الحسابات للمشروع. طرح أفكار مميزة لكل منتج من الاسم والتصميم وحتى القصة والتقديم',
    },
  ],
} as const
