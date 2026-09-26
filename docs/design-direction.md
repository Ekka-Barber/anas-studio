# P01 design direction: the rooms with Anas's new long texts

Owner decision, 2026-09-23: keep the frozen world, and enhance the layouts so
that the new, longer texts read beautifully. This must not become a redesign.
DESIGN-AUDIT.md still applies in full, every item.

## What stays exactly as it is (frozen)

- **Palette.** Paper #F4ECE0, sand #E7D8C3, ink #1C1A17, forest #234A30,
  brass #B28E5A, and each room's own jewel colour (plum for مررتُ من هنا).
- **Typography.** Thmanyah Serif Display is the display face (D33, 2026-09-26: Thmanyah only; it replaced Lyon Arabic Display); Thmanyah Sans is used
  for reading and interface text.
- **Structure.** Navigation, the room opener (a brass tick, a small "الغرفة …"
  label and the big title), the closing poem and the signature footer.
- **The book world.** It stays untouched.

## What changes, and why

The frozen rooms were designed around short placeholder copy. Anas's real texts
run 150–450 words, as a personal narrative with natural beats. The layout has
to become a **reading experience**, not a set of cards.

### 1. An editorial reading column

- Use a single measure of about 62–68 Arabic characters. At desktop that is
  roughly `max-width: 38rem`.
- Set Thmanyah body text at 19–20 px with line-height 2.0. Keep a generous
  paragraph gap and no justified text.
- Anas's line breaks are authored. Preserve them: every blank line in `CONTENT.md`
  is a paragraph.
- His ellipses `…` and em-dashes `—` are his own text. DESIGN-AUDIT item 2
  applies to new product prose only.

### 2. Beats become chapters (from his text, not invented)

- **بدأتُ من هنا.** The years he names become a quiet year rail: 2013 → 2018 →
  2020 → «وشيء لم يبدأ بعد». Each year is a display-face numeral beside its
  paragraph group, with Latin digits.
- **بنيتُ هنا.** His lines «لم أكن وحدي…», «سبعة فروع…» and «الشيخ آمن بي، وأنا
  آمنت برحى. وبين الإيمانين… بنينا.» become three spaced movements. The last
  line closes the room at display size.
- **مررتُ من هنا.** The opening line «قبل أن أمرّ بالمشاريع… كنت أمرّ على البيوت
  بصندوق حلى» is the hero statement. «مررتُ بها… ومرّت بي» is the turn.
- **على الرف.** Three shelf objects (ذرى, كوب ضوء القمر, بوتيك أنس القرني), each
  with its own "shelf card" leading to its story.

**Pull lines.** Only Anas's own sentences are used, set in the display face at 28–40
px in the room colour.

- There are no quotation-mark ornaments and no boxes (DESIGN-AUDIT items 16
  and 81).
- Use at most one pull line per 150 words.

### 3. Real media, woven into the story

**Room vignette.** Each room opens with one generated watercolor vignette in the
book's authored style.

- It is circular, dissolves into paper and sits beside the opener.
- It is decorative, with an empty alt attribute, and it never carries meaning.
- It is illustrative, not stock realism (DESIGN-AUDIT item 144).
- Anas must approve it before launch (E05).

**Reels** (Raha, ARM Modern, the family products).

- Each reel sits in a 9:16 portrait frame with a poster image.
- A reel plays muted inline only when it is at least 60% in view and
  `prefers-reduced-motion` is not set. Otherwise it waits for a tap.
- Use native `<video>` controls, `playsinline`, a poster, `preload="none"` and
  an `aria-label`.
- Arrange reels as a horizontal scroll-snap row on mobile and a 3-up row on
  desktop.
- The bottom of each reel keeps its brand watermark. It is the brand's own
  content, and permission is pending (E05).

**Drone films** (Raha).

- One landscape film sits full-width, with a poster and click-to-play.
- It never autoplays with sound.

**Brand wall** (مررتُ من هنا). The 11 confirmed brands are shown as their native
circular avatars in true colour.

- The Arabic name sits under each avatar.
- There is no box, no hover lift and no greyscale effect (DESIGN-AUDIT items
  51, 70 and 34).
- The layout is a calm grid: 4 across on desktop and 3 on mobile.
- The relationship is real and the owner provided the assets (item 113 is
  satisfied). Permission from the brands is recorded as pending (E05).

**Product gallery** (مررتُ من هنا). Show 11 photos in a masonry-like grid with a
lightbox, built with an accessible dialog (Radix) and keyboard support.

**ذرى.**

- Use the 7 product photos.
- Add a short teaser of the film. Anas decides which seconds, so until then it
  is a poster frame plus «يرى النور 2027».
- The five flavours (سلوى, العوجا, المربع, المصمك, البديعة) are each a short
  entry, and each is tied to three regions.
- The triangle is the motif. It is Anas's own concept, so a subtle triangular
  crop or divider is allowed if it is earned.

**كوب ضوء القمر.**

- Use the design renders and one factory photo (the verified original).
- The story text reads like a fairy tale.
- A small label reads «قيد التصنيع».

### 4. Motion and behaviour

- Content is visible by default (DESIGN-AUDIT item 42).
- An optional gentle fade on scroll is allowed only as enhancement, gated by
  reduced motion.
- There are no scroll-jacking effects and no parallax on text.

### 5. Performance (Workers Free, I20/I21)

- Rooms are static or ISR-cached.
- Images are WebP derivatives at 360, 720, 1200 and 1800 px widths through
  `<picture>`/`srcset`, with dimensions set to prevent layout shift.
- Videos are transcoded to H.264 at 720p, around 1.5–2.5 Mbps, with a poster
  frame. They are served from R2 public derivatives, never through Payload on
  the Worker and never inlined into the Worker bundle. Workers static assets
  cap each file at 25 MiB.

## Room order (from Anas, line 857)

بدأتُ هنا → بنيتُ هنا → مررتُ هنا → على الرف → كتبتُ هنا → المجلس.

He also renamed «مرّت من هنا» to «مررتُ من هنا».

---

## Actual decisions made building P01 part 1

This section records what the implementation actually did, where the source
material required a call this document didn't fully specify.

### Fonts (D33: Thmanyah only)

Only the Thmanyah family ships (owner decision 2026-09-26; its licence file is
`Thmanyah-Font-Family/LICENSE.pdf`). The weights the built rooms use are in
`public/fonts/thmanyah/`: Thmanyah Serif Display Light/Regular/Medium for
titles and numerals (replacing Lyon Arabic Display, which is removed from the
repository) and Thmanyah Sans Light/Regular/Medium/Bold for reading and
interface text, all `.woff2`.

### Nav order and placement (assumption for Anas to confirm)

Anas's order (chat line 857) plus the rename is followed exactly: الرئيسية،
بدأتُ من هنا، بنيتُ هنا، مررتُ من هنا، على الرف، كتبتُ هنا، المجلس. المشاهد and
تواصل are appended after those, in their frozen positions from the original
eight-room nav — **this placement is an assumption**, since Anas's line 857
list stops at المجلس and doesn't say where المشاهد/تواصل go relative to it.

### Routes built vs. truthful stubs

Only `started/built/passed/shelf` are full pages in this part. `book`,
`journal`, `scenes` and `contact` exist as routes (so the nav never 404s) but
render a single shared `ComingSoon` component with a plain "قريباً" — no
invented copy, no fake preview of unbuilt content. `home` keeps the P00 spike
placeholder untouched; only `content/initial-content.json`'s `home.introAddition`
field stores Anas's new phrase, per the task ("the home page is not built in
this part").

### Room jewel colours and backgrounds, read from the frozen HTML

Each of the four rooms' `::selection` colour and hero-label colour in
`deploy/design/*.dc.html` gave the jewel: بدأتُ = forest #234A30 (paper
background), بنيتُ = midnight #20223F (paper), مررتُ = plum #4A2740 (sand),
على الرف = oud #6E4B33 (sand, labelled "الورشة" in the frozen source). The
room opener's title is set directly in the jewel colour on all four rooms
(matching مررتُ/على الرف's frozen treatment) rather than ink (بدأتُ/بنيتُ's
frozen treatment) — DESIGN-DIRECTION.md's own instruction ("the big title in
the room's jewel colour") is followed literally and consistently across all
four, since this document governs the enhancement.

كُتبت هنا (the book room, part 2) has no confirmed jewel yet; its frozen
`::selection` colour is #234A30 (forest), reused as a placeholder for the
`على الرف → كُتبت هنا` next-room link. Not a confirmed decision.

### Domain in the footer

The frozen footer's small caption reads "anasaq.me". D25 makes anas.studio the
canonical production domain, so the footer and header wordmark here show
"anas.studio" instead of reproducing the frozen literal string — the poem and
signature above it are the actual frozen content and are unchanged.

### Content structure (بدأتُ من هنا movements)

The year rail groups Anas's own paragraphs into four movements, split at the
paragraphs that actually name each period: 2013 (opening), 2018 (the
"مطابخ ومقاهٍ" paragraph, where the story leaves the home kitchen), 2020 (the
paragraph that states the year), and «وشيء لم يبدأ بعد» (the paragraph
containing that exact phrase). The first and last lines of his message — both
literally "بدأتُ من هنا" — are treated as a closing pull line and the room's
own recap rather than duplicated under the H1, since the H1 already carries
that exact title.

بنيتُ هنا's three movements follow DESIGN-DIRECTION's own naming: an opening
section (his mentor/trust story), then «لم أكن وحدي…», then «سبعة فروع…»,
then the closing «الشيخ آمن بي، وأنا آمنت برحى. وبين الإيمانين… بنينا.» at
display size, exactly as instructed.

### The full vignette set

`_generated/set/` finished generating during this task (an interruption
mid-task added ten more files to the four `_generated/pilot/` room-opener
vignettes). Every non-rejected, non-preview file in both folders is used:
`_rejected-02c-built-seven-lanterns.png`, `_rejected-02c.json`, `_sheet.jpg`
and `v01.jpg`–`v04.jpg`/`v02c.jpg` are skipped, per instruction. The wide
21:9 `02c-built-seven-lanterns.png` illustrates بنيتُ هنا's "سبعة فروع"
movement as a full-width panorama (not circular, unlike the other vignettes);
`90-divider-najdi-triangles.png` is ذرى's triangle-motif divider band. The
people drawn in these illustrations are used exactly as generated, per the
owner's instruction, with no cropping or alteration of their depiction.

### كوب ضوء القمر media — exactly the task's approved list

The task names four specific files for this item: the two design renders,
`factory-yellow-mug_upscaled.png`, and `factory-mug-inside_original-ONLY.jpg`
(never an upscaled version of that one — CONTENT.md records that the AI
upscale of it misread the Arabic signature). `factory-white-mug.mp4` and
`factory-yellow-mug.mp4` (the two factory videos) and the three
`sample-*-screenrec-*.mp4` screen recordings exist in `BOOK_ASSETS/` but are
**not used**, since the task's own media list for this item does not include
them and DESIGN-DIRECTION.md only asks for "one factory photo".

### ذرى film — poster only, no video embed

CONTENT.md records that the teaser cut of `thura-film_1080p.mp4` (89 s, 165 MB)
has not been decided ("Anas decides which seconds"). Rather than embed the
full film or guess a cut, this room shows only a single extracted poster
frame (`scripts/prepare-media.mjs`, `atSeconds: 12`, an arbitrary illustrative
frame — not a curated choice) next to the exact line from CONTENT.md's chat
export: «منتج على الرف ليرى النور بين أيديكم في مكانٍ ما قريباً 2027».

### بوتيك أنس القرني — vignette now available

The task text says "the boutique vignette if it is present" — at the time the
task was written none existed. `_generated/set/04d-shelf-boutique-open-book.png`
arrived mid-task and is used.

### Product gallery — 10 of 11 photos

`03-passed-here/products/` holds 11 files; `25-cookie-HAS-IG-OVERLAY.jpg` is
excluded per the task (its Instagram avatar overlay is an open question in
CONTENT.md, not resolved here), leaving 10 shown in the lightbox.

### Video audio — kept for exactly one clip

Every transcoded video has its audio track dropped (`-an`) except
`raha-roaster-drivethru-slogan.mp4`, which keeps AAC audio: CONTENT.md
identifies this specific reel as carrying the spoken slogan «اتسعت الدار
وحيّ الله الجار», which is the point of that clip. Reels never autoplay with
sound regardless (DESIGN-DIRECTION §3) — this only affects what a viewer can
hear if they tap to unmute through native controls.

### Risk flagged, not decided here: guardian consent for the child-featuring reels

بدأتُ من هنا's seven family-product reels include five that show a child
(per CONTENT.md's own description: "two animated, five with a child").
DESIGN-DIRECTION.md's rights framing for this room's reels (§3, "permission
is pending (E05)") is written broadly enough to cover them, and CONTENT.md
separately lists guardian consent as an open question (its question 4) that
is distinct in kind from a brand's IP permission — this is a minors'-privacy
question, not just a rights-pending asset. All seven reels are built per the
explicit task instruction and DESIGN-DIRECTION's asset list, but this is
flagged here as the single item on this page most likely to need the
owner's explicit confirmation before this diff is shown to anyone outside
the immediate working group, separately from the general E05 rights gate.

### R2 video hosting (I20/I21, DESIGN-DIRECTION §5)

DESIGN-DIRECTION.md's performance section says videos should be "served from
R2 public derivatives, never... inlined into the Worker bundle." That hosting
step is not part of this task ("Hosting the videos (R2) is a later task, so
note it in the docs" — the task's own instruction). `public/media/*.mp4` is
served as static Worker assets for now (git-ignored; regenerate with
`scripts/prepare-media.mjs`), which keeps them out of the Worker script bundle
already (Cloudflare serves static assets separately from the Worker script,
each capped at 25 MiB — every file here is well under that), but does not yet
move them to R2. Total transcoded weight: 55.9 MiB across 18 videos.
