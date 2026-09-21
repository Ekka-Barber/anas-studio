# anasaq.me — Product Requirements Document (PRD v1)

**Project:** Anas Abdullah Al‑Qarni — Digital Home
**Status:** Design **locked** (Claude Design handoff received) · Stack **locked** · Content & product questions partly open (see §18)
**Date:** July 2026
**Owner:** Majed (build lead) · **Subject:** Anas Abdullah Al‑Qarni (أنس عبدالله القرني)

> This PRD supersedes the scattered "Section N" tech notes referenced by the grilling sheet. It is the single source of truth for the build. Companion docs: `anasaq-me-full-package.md` (brand & psychological profile + design brief) and `anasaq-prd-grilling.html` (open‑question answer sheet). Where they disagree with this file on **stack, fonts, or interactions**, **this file wins** — it reflects the finished design, not the pre‑design assumptions.

---

## 1. Summary & vision

A warm, literary, **Arabic‑only, fully‑RTL** personal "digital home" for Anas Al‑Qarni. Not a portfolio that shows off — a quiet, museum‑calm house organised around three circles of identity:

- **بدأت هنا** (Started here) — things that began from him.
- **بُنيت هنا** (Built here) — things he helped build (رحى المكان).
- **مرّت من هنا** (Passed through here) — things he touched and left a trace in — *the emotional peak; he owns nothing here yet is proudest of it.*

Plus: **كُتبت هنا** (the book «خوص | حكايات شارع 4»), **ما زال على الرف** (unborn ideas / workshop), **المَشَاهِد** (scenes gallery), and **تواصل** (contact).

**North star (one line):** *A warm, literary digital home — engineered like a museum, furnished like a Saudi majlis — where Anas's name stays small so his ideas, places, and stories stay large.*

The design is **calm and light**: generous cream whitespace, jewel‑tone accents, classical Arabic display type over a clean modern sans, and slow fade‑and‑rise reveals. It is deliberately *not* an animation circus — the finished design uses vanilla CSS + `IntersectionObserver`, no heavy JS framework of effects.

---

## 2. Goals, non‑goals, success metrics

### 2.1 Goals
1. Present Anas's three circles + book + workshop + gallery as one unhurried scroll‑first experience.
2. Feel **premium and literary** while loading fast on Saudi mobile networks (≈70%+ of traffic is mobile).
3. Capture intent: contact messages + book "notify me" (and, in V2, book pre‑orders).
4. Ship on a **$0–low‑cost** footprint: Cloudflare Pages + Supabase free tier + Cloudflare R2.

### 2.2 Non‑goals (V1)
- No blog/CMS beyond the gallery.
- No user accounts / login for visitors.
- No English UI (Arabic‑only; English is a V2 consideration — §14).
- No live book commerce in V1 (the first edition is *قيد التجهيز*); the store UI shows but checkout is **V2** (see §11).

### 2.3 Success metrics
- **Performance:** Lighthouse mobile ≥ 90; LCP < 2.5s on 4G; CLS < 0.1; initial payload < 1 MB; app JS < 150 KB gz (§15).
- **Reliability:** forms succeed ≥ 99% (DB never silently paused — §10.6 heartbeat).
- **Reach:** valid OG card + Arabic SEO metadata + sitemap on every route (§13).
- **Inclusivity:** WCAG 2.2 AA; full `prefers-reduced-motion` fallback (§12).
- **Intent captured:** contact + notify submissions land in Supabase and email Anas.

---

## 3. Locked decisions (the short version)

| Area | Decision | Resolves grill Q |
|---|---|---|
| **Framework** | **Astro** (static output + islands for interactivity) | Q1, Q11, Q33, Q34 |
| **Host** | **Cloudflare Pages** (static) + **Pages Functions** for form/API endpoints | Q1 |
| **Database** | **Supabase** free tier (Postgres) + a **heartbeat cron** to prevent auto‑pause | Q2 |
| **Image storage** | **Cloudflare R2** (10 GB free, zero egress) for gallery + book art | Q3 |
| **Fonts** | Self‑host **Lyon Arabic Display** (headlines) + **Thmanyah Sans/Serif** (body) — *web license held by client*; fallbacks Amiri / Aref Ruqaa / IBM Plex Sans Arabic | Q10 |
| **CSS/RTL** | Tailwind **v4** (native logical properties) *or* hand‑authored CSS tokens; RTL‑first, logical props only | Q5 |
| **Animation** | Vanilla CSS + `IntersectionObserver` (as in the handoff). **No Aceternity / Magic UI / Framer / Lenis.** | Q4, Q20, Q21, Q34 |
| **Hero text reveal** | **Word‑by‑word** (split on whitespace — whole Arabic words stay intact/joined). **Never character‑by‑character.** | Q4 |
| **Spam** | **Cloudflare Turnstile** + honeypot on every public form; server‑side validation | Q14 |
| **Email** | **Resend** (free tier) for contact + notify + order notifications | — |
| **Analytics** | **Cloudflare Web Analytics** (free, cookieless — no consent banner) | Q26 |
| **i18n** | **Arabic‑only** V1 (`lang="ar" dir="rtl"`) | Q24 |
| **a11y** | WCAG 2.2 **AA**; reduced‑motion fallback everywhere | Q27, Q32 |
| **Header over dark sections** | Header goes **opaque/glass on scroll** and adapts to the section beneath (the book "الطلب" block is forest‑green) | Q12 |
| **Viewport height** | `100dvh` everywhere (test real iOS) | Q13 |
| **Versions** | Pin exact versions; no `@latest`; one CI + one Playwright smoke test | Q33, Q35 |

**Why Astro:** the finished design is content‑first and mostly static with a few interactive pockets (forms, gallery lightbox, book reader, cart). Astro ships **zero JS by default**, is RTL‑agnostic (it's just HTML/CSS), deploys to Cloudflare Pages as static output with no beta adapters, and lets us hydrate only the islands that need JS. This deletes the entire "Round 1 — FATAL: tech stack contradicts itself" problem from the grilling sheet (no Next‑on‑Cloudflare beta risk, no Server Components conflict).

---

## 4. Information architecture

**Home = one long elegant scroll** containing the hero + a compact preview of every room, each linking to its dedicated page.

```
/                     الرئيسية (home one-scroll: hero → 3 circles → section previews → contact → footer)
/started              بدأت هنا        (accent: forest #234A30)
/built                بُنيت هنا       (accent: midnight #20223F)
/passed               مرّت من هنا     (accent: plum #4A2740) — the peak
/book                 كُتبت هنا        (accent: forest) — book microsite (reader + editions + notify)
/shelf                ما زال على الرف  (accent: oud #6E4B33) — workshop
/scenes               المَشَاهِد       (accent: forest) — gallery
/contact              تواصل           (accent: forest)
/404                  «هذا الطريق لم يُبنَ بعد» (themed)
```

**Top bar (RTL):** wordmark **أنس** + `anasaq.me` on the right; nav order (right→left): الرئيسية · بدأت هنا · بُنيت هنا · مرّت من هنا · كُتبت هنا · على الرف · المَشَاهِد · تواصل. Thin brass **progress hairline** pinned to the very top. Sticky; transparent at top, becomes a **translucent cream glass bar** (`blur(12px)`, `rgba(244,236,224,.88)`) after 30px scroll, with active‑section underline (scrollspy). **Mobile/tablet:** collapses to a **☰** menu.

**Footer (every page):** replaces "all rights reserved" with the closing poem — *"بعض المشاريع بدأت هنا، وبعضها بُني هنا، وبعضها مرّ من هنا… أما الحكايات، فما زالت تُكتب."* — a brass hairline above, the handwritten **أنس** signature mark, and tiny muted `anasaq.me`.

---

## 5. Design system (tokens)

### 5.1 Colour
| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F4ECE0` | Primary background — **always cream, never white/grey** |
| `--sand` | `#E7D8C3` | Secondary surface / alternating sections / cards |
| `--ink` | `#1C1A17` | Primary text / headlines |
| `--forest` ★ | `#234A30` | **Primary accent** — room 1, book, links, primary buttons |
| `--plum` | `#4A2740` | Room 3 accent (مرّت من هنا) |
| `--midnight` | `#20223F` | Room 2 accent (بُنيت هنا) |
| `--oud` | `#6E4B33` | Workshop accent + signature mark |
| `--muted` | `#6F5E4E` | Body subtext / captions |
| `--brass` | `#B28E5A` | Hairlines, progress bar, metal detail — **decorative, not body text** |
| `--clay` | `#B65C43` | Rare warm spark only (e.g. "عدد محدود" tag) |
| `--hairline` | `#D9C9B4` | Borders, rules |

Support tones observed in the design: `#5C4E3F` (strong body), `#8A7862` (mono caption), `#A8927B` (placeholder), `#C9B99F` (input underline), on‑dark muted `#CBBBA6` / `#B9B2C4`.

**Rule:** cream base always; **one deep jewel accent per room** (mapping above); brass for metal hairlines; clay only as a rare spark. Selection colour: forest bg / cream text.

**Room → accent:** بدأت هنا=forest · بُنيت هنا=midnight · مرّت من هنا=plum · على الرف=oud · كُتبت/المشاهد/تواصل=forest.

### 5.2 Typography
| Role | Family (self‑hosted) | Fallback | Weights |
|---|---|---|---|
| Display / literary headlines / quotes (`--fh`) | **Lyon Arabic Display** | Amiri | 300, 400, 500 |
| Name flourish (`--fn`) | Lyon Arabic Display | Aref Ruqaa | 400 |
| Body / UI / nav / buttons (`--fb`) | **Thmanyah Sans** | IBM Plex Sans Arabic | 300, 400, 500, 700 |
| Alt serif (optional editorial) | Thmanyah Serif | — | 400, 500 |

- **RTL throughout.** Arabic body `line-height` **1.9–2.1**. Large display scale, short lines.
- **Numerals: always Latin/English digits** (`0 1 2 3 …`), even in Arabic copy.
- Light tashkeel only (≤ ~10%). **No exclamation marks anywhere.**
- Fonts are **licensed** (client holds web license) and **self‑hosted**: convert OTF→**woff2** and **subset** (Arabic block + Latin digits + punctuation). `font-display: swap`. **Preload** the two hot faces (Lyon Display Regular + Thmanyah Sans Regular). Keep the licence proof in the repo (private) per §16.

### 5.3 Type scale (desktop → tablet → mobile)
| Element | Desktop | Tablet (768) | Mobile (375) |
|---|---|---|---|
| Hero name | 38 | 28 | 22 |
| Hero H1 | 72 (lh 1.65) | 48 | 32 |
| Section H2 | 40–48 | 34–40 | 26–30 |
| Peak H2 (مرّت) | 84 | 60 | 40 |
| Sub‑head H3 | 30–34 | 26–28 | 22–24 |
| Body | 15–18 (lh 2.0–2.1) | 14–16 | 11–13 |
| Caption / meta | 11.5–14 | 11–12 | 9–11 |
| Stat number | 44 | 40 | 32 |

### 5.4 Spacing & layout
- Section vertical padding: **150px** desktop (peak **220px**); horizontal **56px**. Tablet ~96px/60px; mobile ~70px/26px.
- Content max‑width: **1240px** (grids) / **1080–1180px** (narrow/editorial) / **680–900px** (prose & forms).
- Grid gaps 28–72px. **No border‑radius on buttons/cards** (square, editorial). Cards use a 1px `--hairline` border on cream/sand.

### 5.5 Components
- **Text link:** coloured (accent) label + brass 1px bottom hairline; RTL arrow "←". e.g. `اقرأ المزيد ←`, `ادخل الغرفة كاملة ←`.
- **Primary button:** solid forest, cream text, `14px 46px`, no radius; hover → darker forest `#1B3A25` + slight lift.
- **Secondary button:** transparent, forest border + text.
- **Room card:** image placeholder (aspect 4/5) with numbered brass circle badge, Lyon title in room accent, one‑line poem, text link.
- **Museum plaque card** (مرّت): cream card, hairline border, centred, short brass rule on top, Lyon title + muted line.
- **Shelf card:** cream card, hairline border, slight rotation (±~1.2°), soft shadow, "pinned paper" feel; hover → straighten + lift.
- **Form field:** transparent, bottom hairline only (`#C9B99F`), focus → forest underline; placeholder `#A8927B`.
- **Stat block:** big Lyon number (count‑up) + muted label.
- **Textures:** faint horizontal paper‑grain gradient on backgrounds; خوص/linen weave **only in dividers**, whisper‑quiet. Fading brass hairline divider.
- **Image placeholders in the handoff are diagonal‑stripe gradients with an Arabic caption** describing the intended photo — every one must be replaced by a real asset (§19) with meaningful `alt`.

---

## 6. Section‑by‑section functional spec

Each dedicated page repeats the global top bar + footer, carries its **room accent**, and uses the shared reveal motion (§7). Copy below is the **actual Arabic from the design** — treat as final unless Anas revises (grill Q8).

### 6.0 Home (`/`)
- **Hero (`100dvh`, centred):** thin brass grow‑line → name **أنس عبدالله القرني** (Lyon/Aref, forest) → tag *أبني الأفكار والأماكن والحكايات* → H1 *بعض الناس يبنون مشاريع… وبعضهم يبنون **أثراً يعيش داخلها*** (accent span) → muted sub‑paragraph → scroll cue *تجوّل في البيت*. Motion: word‑by‑word reveal + sticky zoom/fade on scroll.
- **Three circles:** heading *هذا البيت ثلاث غرف* + three cards (بدأت/بُنيت/مرّت) each with numbered badge, poem line, `اقرأ المزيد ←`, linking to the room.
- **Section previews:** condensed بدأت / بُنيت (with stat row) / مرّت (peak, 6 plaques) / كُتبت (book teaser) / على الرف (3 tilt cards) / المَشَاهِد (masonry preview) / تواصل (form). Each ends with `ادخل الغرفة كاملة ←`.
- **Footer.**

### 6.1 بدأت هنا (`/started`) — forest
- Intro: *ليست كل الأفكار تبحث عن مستثمر… بعضها يبحث فقط عن فرصة لتولد.*
- Editorial alternating image/text blocks (never a rigid product grid):
  - **المربى وملحقاته** — *حين تتحول القصة إلى منتج يعيش بين يديكم.*
  - **ذَرَى** — *إعادة تقديم الضيافة السعودية بصورة معاصرة.*
  - **خوص** — *محاولة لحفظ ما لا يجب أن يضيع.*
  - **مشاريع قادمة** — *الأفكار التي لا تزال تنتظر وقتها المناسب.* (منها «وداد» — ركن إكسسوارات بطابع سعودي عصري.)
- **Needs (grill Q8):** each project needs one plain "what is this" sentence before shipping.

### 6.2 بُنيت هنا (`/built`) — midnight
- Intro: *بعض الأماكن لا تحمل اسمك… لكنها تحمل شيئاً مني أفخر به.*
- Feature block on **رحى المكان** with the warm paragraph (معلمي الشيخ حامد السهيمي … بناء تجربة متكاملة).
- Quiet underlined sub‑tabs: الفروع · الحملات · المنتجات · المحاصيل · مشاريع العلامة · الإنجازات والأرقام.
- **Restrained stat row (count‑up, Latin digits):** `14` فرعاً · `60+` منتجاً وحملة موسمية · `9` سنوات. **Numbers must be confirmed/greenlit by Anas** (grill Q9 — publishing counts of a real business).

### 6.3 مرّت من هنا (`/passed`) — plum — **the peak**
- Most air on the site. Faint **signature watermark أنس** behind (rises/scales/fades on scroll — the "no signature" idea made visual).
- Largest type on site: *ليست كل البصمات تحتاج إلى توقيع.* + sub line.
- **6 museum plaques:** تطوير منيوهات · منتجات موسمية · تجارب عملاء · تحسين تشغيل · أفكار حملات · تطوير الهوية — each a short poetic line.
- **Note:** the finished design uses **always‑visible plaque cards** (no desktop‑only hover‑reveal) → grill Q19 resolved by design.

### 6.4 كُتبت هنا (`/book`) — forest — **book microsite** (see §11 for commerce)
Anchored sub‑nav (scrollspy): نبذة · شخصيات · مقتطفات · صور · رحلة الكتاب.
- **Title block:** *خوص | حكايات شارع 4* + *ليست كل المدن تُحفظ في الخرائط… بعضها يعيش في الذاكرة.*
- **نبذة / شخصيات / مقتطفات / صور / رحلة الكتاب** content sections (excerpts as Lyon pull‑quotes on paper texture).
- **القراءة — custom RTL 3D page‑flip reader** (`_initReader`): a book‑preview with page turns. Interactive island; must have a static/reduced‑motion fallback (show pages stacked, no flip) and be keyboard‑navigable.
- **الطلب (editions) — forest‑green block:** three edition cards — **رقمية 45 ر.س**, **ورقية 90 ر.س**, **موقّعة 150 ر.س (عدد محدود)** — with `أضف إلى السلة`, a slide‑in **cart drawer**, and `إتمام الطلب`. Plus a **notify‑me** email field *أو أبلغني عند التوفّر — بريدك* → `أبلغني`.
- **V1 vs V2:** V1 ships the reader + editions **display** + **notify‑me capture**. **Cart/checkout/payment = V2** (the first print run is still being prepared; charging before fulfilment carries refund/PDPL/merchant obligations — §11, grill N1–N3). The edition cards in V1 show price and a `أبلغني عند التوفّر` state instead of a live buy button, OR keep "أضف إلى السلة" wired only to the notify flow — **decision pending Anas (N1)**.

### 6.5 ما زال على الرف (`/shelf`) — oud
- Intro: *ليست كل الأفكار تحتاج أن ترى النور فوراً، بعضها يحتاج فقط إلى الوقت المناسب.*
- Sketchbook/pinboard of **رسومات يدوية · أفكار منتجات · مشاريع مستقبلية** as **static tilt cards** (±~1.2°, hover straighten). Deliberately raw/unfinished.
- **Note:** finished design is **static tilt, not draggable** → grill Q20 (drag‑vs‑Lenis) resolved by design.

### 6.6 المَشَاهِد (`/scenes`) — forest — gallery
- Header + quiet filter row: **الكل · أماكن · مشاريع · منتجات · رحلات · خلف الكواليس**.
- **CSS multi‑column masonry** (3 col desktop → 2 tablet/mobile), generous gutters, soft hover lift + one‑line caption.
- **RTL masonry caveat (grill Q22):** CSS `columns` fills top‑to‑bottom per column; verify the reading order reads correctly RTL, or drive order explicitly. Store each image's **width/height** (schema §9) to prevent CLS.
- **Lightbox (grill Q23):** use **`yet-another-react-lightbox`**‑equivalent, or a small custom island — must be **RTL‑correct** (arrows point the right way) and **keyboard‑accessible** (Esc, ← →). Since we're on Astro, prefer a lightweight vanilla/`<dialog>`‑based lightbox island over a React‑only lib.
- **Source of photos:** metadata in Supabase `gallery_scenes`, files in **R2**; pulled at **build time** into static pages (fast, no runtime DB dependency). New photos → redeploy (V1) or admin CMS (V2, grill Q16).

### 6.7 تواصل (`/contact`) — forest
- Heading: *إذا كانت لديك فكرة تستحق أن تُبنى… فلنتحدث.*
- RTL form: **الاسم · البريد · فكرتك** + `أرسل` + quiet social links (إنستغرام / إكس / لينكدإن). Turnstile + honeypot. Four states (§10.4).

---

## 7. Motion system

One motion language sitewide: **calm, reversible, single reveal per section.**

- **Easing:** `cubic-bezier(.22,.61,.36,1)` (ease‑out) everywhere.
- **Section reveal (`data-rv`):** opacity 0→1 + `translateY(16–30px)` + `scale(.985→1)` + `blur(6px→0)`. **Duration 700–900ms**, stagger **120ms** (`data-rvd`). Reverses when scrolling back (re‑hides toward the edge it left).
- **Hero:** word‑by‑word reveal (whole words); sticky hero zoom (`heroZoom ≈ .06`) + fade on scroll.
- **Image parallax:** background‑position drift ±30px as the image crosses the viewport (no layout shift).
- **Count‑up stats:** 0→target, ~1500ms `easeOutCubic`, **Latin digits**.
- **Header/progress:** brass progress hairline (scroll %); nav → glass blur + condensed padding after 30px; scrollspy active underline.
- **Signature (مرّت):** watermark rises/scales/fades with scroll.
- **Shelf:** tilt cards ±~1.4°.
- **Book reader:** custom RTL 3D page‑flip.
- **Reduced motion:** honour `prefers-reduced-motion: reduce` **and** a master toggle — when off, **render the final (shown) state immediately**, disable parallax/zoom/flip, show stats at final value, book reader as stacked pages. This mirrors the handoff's `masterMotion`/`reduceMotionSafe` logic. (grill Q32)

Tuneable params from the handoff (keep as build‑time config, not user UI): `revealType`, `revealDuration`, `revealStagger`, `heroZoomStrength`, `heroFadeStrength`, `parallaxSpeed`, `wordRevealIntensity`, `tiltIntensity`.

---

## 8. Responsive

Breakpoints: **mobile < 768**, **tablet 768–1023**, **desktop ≥ 1024**. Design frames confirm 375 (mobile) and 768 (tablet).

- **Nav:** full inline on desktop; **☰ menu** on tablet/mobile.
- **Grids:** 3‑col → 1‑col (mobile) / 2‑col (tablet); بُنيت feature 2‑col → stacked; gallery columns 3→2.
- **Hero:** type scales per §5.3; keep the scroll cue above the fold using `100dvh` (test real iOS 26 — grill Q13).
- Use **logical properties only** (`padding-inline`, `margin-inline`, `inset-inline-*`) — no hardcoded `left/right`. Tailwind v4 gives these natively (grill Q5).

### 8.1 Handoff note — two prototype layers (do not confuse them)
The design bundle contains **two kinds of files**, and only one is a page to recreate:
- **Page designs** — `Home` + the room pages. These define the product and **must be rebuilt fully responsive** against the breakpoints above. (The preview showcase at `anasaq-showcase.pages.dev/` root already demonstrates the responsive target end‑to‑end.)
- **Reference boards** — `Style Board`, `Responsive Frames`, `Motion Spec`. These are **fixed‑width desktop canvases (artboards), intentionally not responsive**, and are **not shipped**. They are developer references for tokens/motion only. Their appearance on a phone is expected and is *not* a design defect — do not spend effort "fixing" them.

**Responsive acceptance criteria (V1):** every shipped page must pass a manual + Lighthouse check at **360px, 768px, 1024px, 1440px** with no horizontal scroll, no overflow, tap targets ≥ 44px, and the hero readable above the fold on a real phone. Responsiveness is authored during the build — it is never inherited from the prototype artboards.

---

## 9. Data model (Supabase / Postgres)

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`. Arabic values stored as **English keys** with Arabic labels rendered in the UI (grill Q17).

```sql
-- 9.1 Book "notify me" (V1)
book_notify (
  id, email citext unique not null,
  source text default 'book',
  consent boolean not null default false,   -- PDPL (grill Q31)
  created_at
)

-- 9.2 Contact messages (V1)
contact_messages (
  id, name text not null, email citext not null,
  message text not null,
  meta jsonb,                                -- ua, turnstile outcome (no raw IP stored)
  created_at
)

-- 9.3 Gallery scenes (V1 read, V2 admin write)
gallery_scenes (
  id,
  r2_key text not null,                      -- object key in R2
  category_key text not null                 -- enum: places|projects|products|trips|behind_the_scenes
    check (category_key in ('places','projects','products','trips','behind_the_scenes')),
  caption_ar text,
  alt_ar text,                               -- accessibility (grill Q27)
  width int not null, height int not null,   -- prevent CLS (grill Q22)
  sort_order int not null default 0,
  is_published boolean not null default false,
  created_at
)

-- 9.4 Book orders (V2 commerce)
book_orders (
  id, order_number text unique,
  customer_name text, email citext, phone text,
  shipping_address jsonb,                    -- null for digital
  subtotal numeric(10,2), currency text default 'SAR',
  status text default 'pending'              -- pending|paid|failed|fulfilled|cancelled|refunded
    check (status in ('pending','paid','failed','fulfilled','cancelled','refunded')),
  payment_provider text, payment_ref text,
  created_at
)
book_order_items (
  id, order_id uuid references book_orders(id) on delete cascade,
  edition text check (edition in ('digital','print','signed')),
  unit_price numeric(10,2), qty int not null default 1
)
```

**Category labels (UI):** `places→أماكن`, `projects→مشاريع`, `products→منتجات`, `trips→رحلات`, `behind_the_scenes→خلف الكواليس`. (Reconciles the schema/UI mismatch — grill Q17.)

**Edition prices (confirm with Anas — grill N2):** digital `45`, print `90`, signed `150` SAR.

### 9.5 Row‑Level Security (explicit — grill Q18)
| Table | anon INSERT | anon SELECT | Writes |
|---|---|---|---|
| `book_notify` | ✅ (via function w/ Turnstile) | ❌ | owner/service only |
| `contact_messages` | ✅ (via function w/ Turnstile) | ❌ | owner read only |
| `gallery_scenes` | ❌ | ✅ where `is_published = true` | owner/service (or build‑time) |
| `book_orders` / `_items` | ❌ | ❌ | **service role only** (server function) |

Public forms write through **Pages Functions using the service role key** (never expose service key to the client; the anon key stays public but tables above don't grant anon insert directly — the function validates Turnstile first).

---

## 10. Backend & APIs (Cloudflare Pages Functions)

Endpoints live in `/functions/api/*`. Secrets via CF Pages env vars (§16).

### 10.1 `POST /api/contact`
Verify **Turnstile** token → reject if honeypot filled → validate (name, email regex, message length) → insert `contact_messages` (service role) → email Anas via **Resend** → return `{ ok: true }`. Rate‑limit by IP (CF).

### 10.2 `POST /api/notify`
Verify Turnstile → validate email → `insert … on conflict (email) do nothing` into `book_notify` → return a state (`created` | `already_exists`) → optional confirmation email. Handles duplicates gracefully (grill Q15).

### 10.3 Gallery
Pulled at **build time**: Astro fetches `gallery_scenes where is_published` + composes R2 URLs → static pages. Adding photos = new deploy (V1). **V2:** auth‑gated `/admin` upload island + deploy hook (grill Q16).

### 10.4 Form states (write the Arabic copy — grill Q15)
Every form implements four states with a small RTL toast/inline message:
1. **Invalid/empty** → «من فضلك أدخل بريداً صحيحاً / أكمل الحقول».
2. **Success** → «تم — سنعود إليك» / «أضفناك إلى القائمة، سنبلغك فور توفّرها».
3. **Already exists** (notify) → «يبدو أنك على القائمة بالفعل 🙂» (friendly, not an error).
4. **Network/server error** → «حدث خطأ، جرّب بعد لحظات».

### 10.5 (V2) Commerce endpoints — see §11.

### 10.6 Supabase heartbeat (grill Q2)
A **GitHub Actions cron every ~2 days** issues a trivial query so the free project never hits the 7‑day auto‑pause (paused projects do **not** auto‑wake and forms would silently fail). Alternatively upgrade to Supabase Pro. **Recommended: heartbeat cron.**

---

## 11. Book commerce (V2 workstream)

The design ships a real store: 3 editions, add‑to‑cart, cart drawer, `إتمام الطلب`, "طلب مسبق — يُشحن عند توفّر النسخة الأولى". This is **new scope** beyond the original waitlist and needs its own decisions.

- **Cart:** client island; persists to `localStorage`; subtotal in SAR.
- **Checkout:** `POST /api/checkout` creates a `book_orders` row (service role) → creates a payment with the gateway → returns the hosted payment URL.
- **Payment gateway (SAR):** recommend **Moyasar** (mada + Apple Pay + cards, hosted page = minimal PCI scope; strong KSA fit) or **Tap Payments** as alternative. Stripe has weaker KSA merchant support. **Requires a merchant account / CR (grill N3).**
- **Webhook:** `POST /api/payment-webhook` verifies signature → sets `status='paid'` → sends order‑confirmation email (Resend) → notifies Anas.
- **Fulfilment/legal:** pre‑charging for an unshipped book means holding customer funds → needs a **refund & delivery policy** + PDPL notice. **Because the first edition is قيد التجهيز, V1 recommendation is: display editions + capture "notify me" only; turn on live checkout in V2 when the print run is ready.** (grill N1)

---

## 12. Accessibility (WCAG 2.2 AA)

- **Contrast:** audit every pair on the **new** palette (WebAIM). forest `#234A30` / ink on paper `#F4ECE0` pass comfortably; `--muted #6F5E4E` on paper is borderline for small text → use for ≥16px or bump darker; **brass `#B28E5A` and clay `#B65C43` are decorative/large‑only — never small body text.** (The old grilling terracotta‑on‑sand 2.1:1 problem is from the *pre‑design* palette and no longer applies, but the discipline does.)
- **Reduced motion:** full static fallback per §7 (grill Q32).
- **Keyboard:** visible focus rings; logical tab order; lightbox + cart + reader fully operable (Esc/arrows).
- **Semantics/alt:** real `alt` on every photo (`alt_ar` in schema); landmarks; `lang="ar" dir="rtl"`; form labels.
- **No content trapped behind JS:** reveal elements must be readable if JS fails / reduced‑motion (render shown state).

---

## 13. SEO, social, analytics (grill Q25, Q26)

- **Metadata:** Arabic `<title>` + description per route; canonical; `og:*` + `twitter:card`; `lang=ar`, `dir=rtl`.
- **OG card:** one designed **1200×630** image (cream + Lyon name + tagline) — asset to produce (§19).
- **Structured data:** `Person` JSON‑LD (Anas); `Book` JSON‑LD on `/book`.
- **Sitemap + robots:** `@astrojs/sitemap` auto‑generates `sitemap.xml`; `robots.txt` allows all.
- **Analytics:** Cloudflare Web Analytics (one snippet, cookieless, no consent banner).

---

## 14. Internationalisation

**Arabic‑only, RTL** for V1 (the entire design is Arabic). Keep copy in a structured content layer (Astro content collections / JSON) so an **English V2** is additive, not a rewrite. If English is later required for investors (grill Q6/Q24), add an `/en` tree with LTR mirror.

---

## 15. Performance budget (grill Q11)

Hard limits, enforced in CI:
- **LCP < 2.5s** on emulated 4G; **CLS < 0.1**; **INP < 200ms**.
- **Initial HTML+CSS+fonts+hero image < 1 MB**; **hydrated JS < 150 KB gz** (Astro ships ~0 by default; only islands: forms, gallery lightbox, book reader, cart).
- **Fonts:** 2 primary families, **woff2 + subset**, preload 2 faces, `font-display: swap`.
- **Images:** R2 + responsive `srcset`, explicit width/height, lazy below the fold, modern formats (AVIF/WebP).
- **Lighthouse mobile ≥ 90** on every route; budget checked in the GitHub Action.

---

## 16. Infrastructure, deployment, CI (grill Q33, Q35)

- **Repo:** Astro app; **pinned exact versions** (no `@latest`). Node LTS pinned.
- **Build/host:** Cloudflare Pages (static output) + Pages Functions. Preview deploys per PR.
- **Env/secrets (CF Pages):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `TURNSTILE_SECRET`, `RESEND_API_KEY`, R2 binding, (V2) `MOYASAR_*`. **Never** commit secrets; service role key stays server‑side only.
- **Fonts:** self‑hosted under `/public/fonts`; keep the **web‑licence proof** in a private `LICENSES/` note (do not publish licence PDFs).
- **CI (GitHub Actions, free):** install → `astro check` (typecheck) → lint → build → **Lighthouse budget** → **one Playwright smoke** (home reveal + contact submit + book reader flip). Plus the **Supabase heartbeat cron** (§10.6).
- **Backups:** Supabase daily (free tier retention) + periodic SQL dump of form tables.

---

## 17. MVP phasing (grill Q29)

**V1 (ship first — target ~2 weeks after content is in):**
Home one‑scroll · بدأت هنا · بُنيت هنا (stats) · مرّت من هنا (peak) · تواصل (form) · **كُتبت هنا** (reader preview + editions display + **notify‑me**) · المَشَاهِد (build‑time gallery + lightbox) · على الرف (static tilt) · footer. All with SEO/OG/analytics/a11y/perf + Turnstile + heartbeat.

**V2:**
Book **commerce** (cart → Moyasar checkout → orders → emails) · gallery **admin CMS** + deploy hook · optional **English** i18n · richer reader.

**Cut/deferred vs old PRD (resolved by the finished design):** horizontal‑scroll section, drag‑the‑sketches, Aceternity/Magic UI/Framer/Lenis dependency, character‑by‑character hero animation. None are in the design; none are built.

---

## 18. Open questions (still need Anas — the grill items)

These are **not** resolved by design/stack and block content‑complete launch. Full detail + "plain English" in `anasaq-prd-grilling.html`.

1. **Audience (Q6)** — who is the one visitor who must leave satisfied? Drives tone & the contact CTA.
2. **Circle definitions (Q7)** — one court‑defensible rule each for Started / Built / Passed.
3. **Plain descriptions (Q8)** — one "what is this" sentence for each of the ~8 projects.
4. **Brand rights / NDAs (Q9)** — Anas's exact legal relationship to each brand; anything NDA'd must not be named; confirm the بُنيت stat numbers may be published.
5. **Content & assets (Q30, §19)** — real photos, logos, book cover art, excerpts, metrics — who provides, by when.
6. **PDPL (Q31)** — privacy notice near forms + email retention period + consent checkbox wording.
7. **NEW — Book store go‑live (N1)** — V1 = notify‑only, or live checkout now? (Recommend notify‑only until the first edition is ready.)
8. **NEW — Pricing (N2)** — confirm 45 / 90 / 150 SAR and the "signed" limited quantity.
9. **NEW — Merchant/payments (N3)** — does Anas have a CR + merchant account for Moyasar/Tap? Refund & shipping policy + regions?
10. **NEW — Book reader scope (N4)** — how many preview pages in the 3D reader, and is a reduced/static fallback acceptable?

### Assumptions (until told otherwise)
- All Arabic copy in the design is final unless Anas revises.
- بُنيت stats (14 / 60+ / 9) are illustrative and must be greenlit.
- The site is a personal home (not a company site) — one primary domain `anasaq.me`.

---

## 19. Asset checklist (owner: Anas / Majed) — grill Q30

| Asset | For | Format | Status |
|---|---|---|---|
| Photography (hands/jam/coffee/خوص/foliage/branches) | all rooms, replacing stripe placeholders | AVIF/WebP + width/height | ☐ |
| Gallery photos (categorised) | المَشَاهِد | R2 upload + metadata rows | ☐ |
| Book cover art «خوص» | /book, OG, reader | high‑res | ☐ |
| Book excerpts + character notes | /book (نبذة/شخصيات/مقتطفات/رحلة) | text | ☐ |
| رحى المكان verified metrics | بُنيت stats | confirmed numbers | ☐ |
| Brand logos (with rights) | بدأت / بُنيت | SVG/PNG | ☐ |
| Handwritten signature أنس | footer / hero / watermark | transparent PNG/SVG | ☐ |
| OG card 1200×630 | social | PNG | ☐ |
| Social links (Instagram/X/LinkedIn) | contact/footer | URLs | ☐ |
| Font web‑licence proof | legal | private | ☐ (client holds licence) |

---

*End of PRD v1. Change control: update this file first; then reflect deltas in `anasaq-me-full-package.md` (design) and `anasaq-prd-grilling.html` (open answers).*
