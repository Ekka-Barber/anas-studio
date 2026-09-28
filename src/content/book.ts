/**
 * كتبتُ هنا: the book «خوص | حكايات شارع 4» (D39). Every line here is Anas's:
 * his brief (anas-texts.md sections 1 and 7) and three short passages from
 * his manuscript (the introduction, the dedication and the chapter «صورة
 * الروضة»), checked word for word against the PDFs. The book page is not a
 * CMS document yet; editing it is a change to this file.
 *
 * Nothing here claims what Anas has not confirmed: prices are announced
 * later, and the paper edition's extras (the woven bookmark) are his idea,
 * not a promise, so the page does not state them.
 */
export const BOOK = {
  roomLabel: 'كتبتُ هنا',
  title: 'خوص',
  subtitle: 'حكايات شارع 4',
  author: 'أنس عبدالله القرني',
  line: 'ليست كل المدن تُحفظ في الخرائط… بعضها يعيش في الذاكرة.',
  cover: { id: 'khous-cover-b', alt: 'غلاف خوص: العنوان والطبق المنسوج، واسم أنس وتوقيعه في الزاوية' },
  standing: { id: 'khous-standing-b', alt: 'الكتاب واقفاً: الكعب إلى اليمين وفاصل الخوص بارز من أعلاه' },
  spine: { id: 'khous-spine', alt: 'كعب الكتاب: خوص | حكايات شارع 4، وأنس عبدالله القرني' },
  bookmark: { id: 'khous-bookmark', alt: 'فاصل من الخوص المنسوج بشرّابة' },

  about: {
    kicker: 'محاولة لحفظ ما لا يجب أن يضيع',
    line: 'المكان الذي تعيش فيه الحكايات',
    passage: [
      'قد يظن القارئ، وهو يفتح صفحات هذا الكتاب، أنه مقبلٌ على كتابٍ لوصفات الطعام، لكنه في الحقيقة مقبلٌ على شيءٍ لا يمكن أن تُكتب مقاديره، ولا أن يُعاد صنعه كما كان.',
      'إنه مقبلٌ على شعورٍ كانت الوصفات طريقاً إليه ، فالأطباق يمكن أن تُطهى مرةً أخرى ، أما الجارة التي صنعت الذكرى، فلا.',
    ],
    source: 'من المقدمة',
  },

  excerpts: [
    { text: 'فالطبق باب ، والرائحة طريق ، والبيت ذاكرة ، والإنسان هو الحكاية كلها .', source: 'من المقدمة' },
    {
      text: 'فإن لم يعد باستطاعتي أن أهديكم طبقًا من الأمس، فأنا هنا الآن أهديكم شعور الأمس كله.',
      source: 'من الإهداء',
    },
    {
      text: 'فكنز الإنسان الحقيقي ليس ما جمعه في عمره، بل ما حفظته ذاكرته من وجوهٍ وأماكن ومشاعر صادقة.',
      source: 'من فصل «صورة الروضة»',
    },
  ],

  // His own childhood photographs from Street No. 4, Tabuk.
  photos: [
    { id: 'street4-street-sign', alt: 'لوحة شارع رقم 4 الزرقاء في تبوك', caption: 'لوحة الشارع', focus: '50% 36%' },
    { id: 'street4-school-gate', alt: 'بوابة المدرسة بأقواسها', caption: 'بوابة المدرسة' },
    { id: 'street4-closed-door', alt: 'باب بيت مغلق في الحي', caption: 'باب من الحي' },
    { id: 'street4-majlis', alt: 'مجلس البيت بكنباته المزهّرة', caption: 'مجلس البيت' },
    { id: 'street4-kindergarten-portrait', alt: 'أنس طفلاً بالمشلح في صورة الروضة', caption: 'صورة الروضة', focus: '50% 25%' },
  ],

  journey: {
    title: 'رحلة الكتاب وفلسفته',
    passage: [
      'ظلّت تركض أعوامًا طويلة، حتى تحوّلت خطواتها إلى كلمات، وروائحها إلى حكايات، ودفء موائدها إلى شعورٍ يسكن الصفحات ولهذا، لم يجد أنس اسمًا يحتضن كل تلك المشاعر سوى ( خوص )',
      'وربما لهذا السبب لا يزال يقف، حتى اليوم، في أول الحارة.',
      'لا بعمره، بل بذاكرته.',
    ],
    source: 'من المقدمة',
  },

  // The two editions Anas named (section 7: an e-book, and a signed paper
  // copy). Prices are his to set (D06); until then they are announced later.
  status: ['يجري العمل حالياً على تجهيز النسخة الأولى من الكتاب.', 'قريباً سيكون متاحاً للطلب والاقتناء'],
  editions: [
    { name: 'رقمية', text: 'الكتاب الإلكتروني، للقراءة على أي جهاز.' },
    { name: 'ورقية موقّعة', text: 'نسخة ورقية بتوقيع أنس.' },
  ],
} as const
