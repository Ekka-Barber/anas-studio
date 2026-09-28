#!/usr/bin/env node
/**
 * P01 media pipeline: room vignettes, brand logos, product photos and video
 * reels from `BOOK_ASSETS/SORTED_2026-09-21/` (git-excluded source, read-only)
 * into the committed public asset tree.
 *
 * Images — sharp, devDependency, build-time only (D15 forbids Sharp in the
 * Worker runtime; this script never runs there). WebP derivatives at 360/720/
 * 1200/1800px wide, never upscaled, written to `public/images/<room>/`, with
 * a committed `public/images/manifest.json` recording width/height per file.
 *
 * Videos — ffmpeg (must be on PATH; not a Node dependency), H.264 720p
 * (long side <=1280), CRF 26, +faststart, audio dropped unless flagged
 * essential. Output to `public/media/` (git-ignored; only its manifest is
 * committed) plus a WebP poster frame written to `public/images/<room>/`.
 *
 * Poster frames are chosen by content, not a fixed timestamp: ~5 samples
 * across the clip's duration, keeping the one with the highest luminance
 * standard deviation (least likely to be a flat, texture-less tile) among
 * frames that clear a minimum mean-luma floor (round 2 audit fix 5).
 *
 * Run: `node scripts/prepare-media.mjs` (full pipeline),
 *      `node scripts/prepare-media.mjs --posters-only` (re-picks every video
 *      poster against the current manifests without re-transcoding), or
 *      `node scripts/prepare-media.mjs --only=id1,id2` (regenerates just the
 *      named IMAGES entries against the current manifest).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(repoRoot, 'BOOK_ASSETS', 'SORTED_2026-09-21')
const IMAGES_OUT = path.join(repoRoot, 'public', 'images')
const MEDIA_OUT = path.join(repoRoot, 'public', 'media')
const IMAGE_WIDTHS = [360, 720, 1200, 1800]
const VIDEO_MAX_LONG_SIDE = 1280

/**
 * D15 guard: Sharp must never reach the Worker bundle. This is the one script
 * allowed to import it, so it is the one place that checks nothing under
 * `src/` does the same.
 */
function assertSharpNeverImportedBySrc() {
  const offenders = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8')
        if (/from ['"]sharp['"]|require\(['"]sharp['"]\)/.test(text)) offenders.push(full)
      }
    }
  }
  walk(path.join(repoRoot, 'src'))
  if (offenders.length > 0) {
    console.error('D15 violation: sharp imported outside this script:')
    for (const o of offenders) console.error(`  ${path.relative(repoRoot, o)}`)
    process.exit(1)
  }
}

// ---- source manifests -----------------------------------------------------

const P = (...parts) => path.join(ASSETS, ...parts)
const GEN_PILOT = (name) => P('_generated', 'pilot', name)
const GEN_SET = (name) => P('_generated', 'set', name)
// D39: the v2 direction B material, copied from the Claude Design pack
// (`ANASAQ-claude-design-pack/stage-1`, `stage-2`, `book-cover`): Anas's
// portrait, his Street No. 4 photos, the Raha poster, and the Khous book in
// the cover and standing mockup he picked (B). Git-excluded like SORTED.
const V2 = (name) => path.join(repoRoot, 'BOOK_ASSETS', 'v2-design', name)

/** @type {{room:string,id:string,src:string,alt?:string}[]} */
const IMAGES = [
  // Room vignettes — decorative watercolours, circular, empty alt at render time.
  { room: 'started', id: '01-started-mothers-kitchen', src: GEN_PILOT('01-started-mothers-kitchen.png') },
  { room: 'started', id: '01b-started-supplying-cafes', src: GEN_SET('01b-started-supplying-cafes.png') },
  { room: 'started', id: '01c-started-story-becomes-product', src: GEN_SET('01c-started-story-becomes-product.png') },
  { room: 'started', id: '01d-started-not-yet-begun', src: GEN_SET('01d-started-not-yet-begun.png') },
  { room: 'built', id: '02-built-raha-millstone', src: GEN_PILOT('02-built-raha-millstone.png') },
  { room: 'built', id: '02b-built-teacher-trust', src: GEN_SET('02b-built-teacher-trust.png') },
  { room: 'built', id: '02c-built-seven-lanterns', src: GEN_SET('02c-built-seven-lanterns.png') },
  { room: 'passed', id: '03-passed-street-of-shops', src: GEN_PILOT('03-passed-street-of-shops.png') },
  { room: 'passed', id: '03b-passed-doorstep-delivery', src: GEN_SET('03b-passed-doorstep-delivery.png') },
  { room: 'shelf', id: '04-shelf-moonlit-shelf', src: GEN_PILOT('04-shelf-moonlit-shelf.png') },
  { room: 'shelf', id: '04b-shelf-thura-najdi-triangles', src: GEN_SET('04b-shelf-thura-najdi-triangles.png') },
  { room: 'shelf', id: '04c-shelf-moonlight-shop-dream', src: GEN_SET('04c-shelf-moonlight-shop-dream.png') },
  { room: 'shelf', id: '04d-shelf-boutique-open-book', src: GEN_SET('04d-shelf-boutique-open-book.png') },
  { room: 'shelf', id: '90-divider-najdi-triangles', src: GEN_SET('90-divider-najdi-triangles.png') },

  // بنيتُ هنا — brand mark
  { room: 'built', id: 'raha-logo', src: P('02-built-here', 'raha-logo.png') },

  // مررتُ من هنا — brand wall (bare circular marks, true colour)
  { room: 'passed', id: 'soub', src: P('03-passed-here', 'logos', '09-soub_صوب.png') },
  { room: 'passed', id: 'arm', src: P('03-passed-here', 'logos', '08-arm_ارم.png') },
  { room: 'passed', id: 'murady', src: P('03-passed-here', 'logos', '11-murady_مرادي.png') },
  { room: 'passed', id: 'falafel-baraka', src: P('03-passed-here', 'logos', '12-falafel-baraka_فلافل-بركة.png') },
  { room: 'passed', id: 'chaiat', src: P('03-passed-here', 'logos', '13-chaiat_شايات.png') },
  { room: 'passed', id: 'esar', src: P('03-passed-here', 'logos', '14-esar_إيسار.png') },
  { room: 'passed', id: 'inuit-caffee', src: P('03-passed-here', 'logos', '16-inuit-caffee_INUIT-CAFFEE.png') },
  { room: 'passed', id: 'berlanti', src: P('03-passed-here', 'logos', '17-berlanti_برلنتي.png') },
  { room: 'passed', id: 'fayyat-alshay', src: P('03-passed-here', 'logos', '19-fayyat-alshay_فيّة-الشاي.png') },
  { room: 'passed', id: 'blue-cups', src: P('03-passed-here', 'logos', '20-blue-cups_بلو-كبز.png') },
  { room: 'passed', id: 'golden-deer', src: P('03-passed-here', 'logos', '21-golden-deer_قولدن-دير.png') },

  // مررتُ من هنا — product gallery (25-cookie-HAS-IG-OVERLAY excluded per task)
  { room: 'passed', id: '23-caramel-popcorn-cheesecake', src: P('03-passed-here', 'products', '23-caramel-popcorn-cheesecake.jpg') },
  { room: 'passed', id: '24-boxed-loaf-cake', src: P('03-passed-here', 'products', '24-boxed-loaf-cake.jpg') },
  { room: 'passed', id: '26-murady-cake-and-coffee', src: P('03-passed-here', 'products', '26-murady-cake-and-coffee.jpg') },
  { room: 'passed', id: '27-t-mark-brownie-white-sauce', src: P('03-passed-here', 'products', '27-t-mark-brownie-white-sauce.jpg') },
  { room: 'passed', id: '28-gold-tarts', src: P('03-passed-here', 'products', '28-gold-tarts.jpg') },
  { room: 'passed', id: '29-cheesecake-chocolate-hazelnut', src: P('03-passed-here', 'products', '29-cheesecake-chocolate-hazelnut.jpg') },
  { room: 'passed', id: '30-cheesecake-raspberry-lime', src: P('03-passed-here', 'products', '30-cheesecake-raspberry-lime.jpg') },
  { room: 'passed', id: '31-murady-french-toast-banana', src: P('03-passed-here', 'products', '31-murady-french-toast-banana.jpg') },
  { room: 'passed', id: '32-arm-brownie-bites', src: P('03-passed-here', 'products', '32-arm-brownie-bites.jpg') },
  { room: 'passed', id: '33-brownie-vanilla-sauce', src: P('03-passed-here', 'products', '33-brownie-vanilla-sauce.jpg') },

  // على الرف — ذرى
  { room: 'shelf', id: 'thura-67', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-67.jpg') },
  { room: 'shelf', id: 'thura-68', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-68.jpg') },
  { room: 'shelf', id: 'thura-69', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-69.jpg') },
  { room: 'shelf', id: 'thura-70', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-70.jpg') },
  { room: 'shelf', id: 'thura-75', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-75.jpg') },
  { room: 'shelf', id: 'thura-77', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-77.jpg') },
  { room: 'shelf', id: 'thura-81', src: P('04-on-the-shelf', 'thura', 'photos', 'thura-81.jpg') },

  // على الرف — كوب ضوء القمر (exactly the task's approved set; the upscaled
  // mug-inside photo is rejected in CONTENT.md, so only the original is used)
  { room: 'shelf', id: 'render-83', src: P('04-on-the-shelf', 'moonlight-cup', 'render-83.jpg') },
  { room: 'shelf', id: 'render-84', src: P('04-on-the-shelf', 'moonlight-cup', 'render-84.jpg') },
  { room: 'shelf', id: 'factory-yellow-mug_upscaled', src: P('04-on-the-shelf', 'moonlight-cup', 'factory-yellow-mug_upscaled.png') },
  { room: 'shelf', id: 'factory-mug-inside_original-ONLY', src: P('04-on-the-shelf', 'moonlight-cup', 'factory-mug-inside_original-ONLY.jpg') },

  // D39 — the v2 direction B material (see V2 above).
  { room: 'v2', id: 'anas-portrait', src: V2('anas-portrait.jpg') },
  { room: 'v2', id: 'khous-cover-b', src: V2('khous-cover-b.png') },
  { room: 'v2', id: 'khous-standing-b', src: V2('khous-standing-b.png') },
  { room: 'v2', id: 'khous-spine', src: V2('khous-spine.png') },
  { room: 'v2', id: 'khous-bookmark', src: V2('khous-bookmark.png') },
  { room: 'v2', id: 'raha-poster-orange', src: V2('raha-poster-orange.jpg') },
  { room: 'v2', id: 'street4-street-sign', src: V2('street4-street-sign.jpg') },
  { room: 'v2', id: 'street4-school-gate', src: V2('street4-school-gate.jpg') },
  { room: 'v2', id: 'street4-closed-door', src: V2('street4-closed-door.jpg') },
  { room: 'v2', id: 'street4-majlis', src: V2('street4-majlis.jpg') },
  { room: 'v2', id: 'street4-kindergarten-portrait', src: V2('street4-kindergarten-portrait.jpg') },
]

/** @type {{room:string,id:string,src:string,keepAudio?:boolean}[]} */
const VIDEOS = [
  // بدأتُ من هنا — seven family-product reels (two animated, five with a child;
  // guardian consent for the child-featuring reels is an open question in
  // CONTENT.md and is flagged separately in the task report, not decided here)
  { room: 'started', id: '44-animated-kitchen', src: P('01-started-here', 'videos', '44-animated-kitchen.mp4') },
  { room: 'started', id: '45-animated-pottery-signature', src: P('01-started-here', 'videos', '45-animated-pottery-signature.mp4') },
  { room: 'started', id: '46-kid-picnic-jam', src: P('01-started-here', 'videos', '46-kid-picnic-jam.mp4') },
  { room: 'started', id: '47-kid-bisht-honey-jar', src: P('01-started-here', 'videos', '47-kid-bisht-honey-jar.mp4') },
  { room: 'started', id: '48-kid-supermarket-tomato-pesto', src: P('01-started-here', 'videos', '48-kid-supermarket-tomato-pesto.mp4') },
  { room: 'started', id: '49-kid-hotel-breakfast', src: P('01-started-here', 'videos', '49-kid-hotel-breakfast.mp4') },
  { room: 'started', id: '50-kid-cafe-croissant-jam', src: P('01-started-here', 'videos', '50-kid-cafe-croissant-jam.mp4') },

  // بنيتُ هنا — Raha reels + drone films. The drive-thru reel keeps its audio:
  // the slogan «اتسعت الدار وحيّ الله الجار» is spoken in it and is the point
  // of that clip; every other reel here is ambient and loses its audio track.
  { room: 'built', id: 'raha-reel-community', src: P('02-built-here', 'videos', 'raha-reel-community.mp4') },
  { room: 'built', id: 'raha-branch-walkthrough', src: P('02-built-here', 'videos', 'raha-branch-walkthrough.mp4') },
  { room: 'built', id: 'raha-coffee-roasting_HD', src: P('02-built-here', 'videos', 'raha-coffee-roasting_HD.mp4') },
  { room: 'built', id: 'raha-roaster-drivethru-slogan', src: P('02-built-here', 'videos', 'raha-roaster-drivethru-slogan.mp4'), keepAudio: true },
  { room: 'built', id: 'raha-drone-branch_vertical', src: P('02-built-here', 'videos', 'raha-drone-branch_vertical.mp4') },
  { room: 'built', id: 'raha-drone-opening_landscape', src: P('02-built-here', 'videos', 'raha-drone-opening_landscape.mp4') },

  // مررتُ من هنا — ARM Modern reels (watermarked, brand's own content)
  { room: 'passed', id: 'arm-modern-black-gold-dessert_HD', src: P('03-passed-here', 'videos', 'arm-modern-black-gold-dessert_HD.mp4') },
  { room: 'passed', id: 'arm-modern-green-cube-dessert_HD', src: P('03-passed-here', 'videos', 'arm-modern-green-cube-dessert_HD.mp4') },
  { room: 'passed', id: 'arm-modern-layered-drink_HD', src: P('03-passed-here', 'videos', 'arm-modern-layered-drink_HD.mp4') },
  { room: 'passed', id: 'arm-modern-purple-dessert_HD', src: P('03-passed-here', 'videos', 'arm-modern-purple-dessert_HD.mp4') },
  { room: 'passed', id: 'arm-modern-red-drink_HD', src: P('03-passed-here', 'videos', 'arm-modern-red-drink_HD.mp4') },
]

/**
 * على الرف — ذرى: the task calls for a poster frame only (the teaser cut is
 * not yet decided; DESIGN-DIRECTION §3 "the teaser seconds are still
 * unknown"), so this is a still extraction, not a transcode.
 */
const POSTER_ONLY = [
  { room: 'shelf', id: 'thura-film_1080p', src: P('04-on-the-shelf', 'thura', 'thura-film_1080p.mp4'), atSeconds: 12 },
]

// ---- helpers ---------------------------------------------------------------

function ffprobe(src, args) {
  return execFileSync('ffprobe', ['-v', 'error', ...args, src], { encoding: 'utf8' }).trim()
}

function videoDims(src) {
  const out = ffprobe(src, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0'])
  const [w, h] = out.split(',').map(Number)
  return { width: w, height: h }
}

function videoDuration(src) {
  return parseFloat(ffprobe(src, ['-show_entries', 'format=duration', '-of', 'csv=p=0']))
}

/** Mean luma and its standard deviation for one frame — cheap content signal
 * to tell a flat/black tile apart from a frame with something to look at. */
async function frameLumaStats(framePath) {
  const { data } = await sharp(framePath).greyscale().raw().toBuffer({ resolveWithObject: true })
  const n = data.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  const mean = sum / n
  let sqDiff = 0
  for (let i = 0; i < n; i++) {
    const d = data[i] - mean
    sqDiff += d * d
  }
  return { mean, stddev: Math.sqrt(sqDiff / n) }
}

async function processImage({ room, id, src }) {
  if (!existsSync(src)) return { id, room, status: 'missing', src }
  const outDir = path.join(IMAGES_OUT, room)
  mkdirSync(outDir, { recursive: true })
  const image = sharp(src)
  const meta = await image.metadata()
  const sourceWidth = meta.width ?? 0
  const widths = IMAGE_WIDTHS.filter((w) => w <= sourceWidth)
  // No standard breakpoint reaches the source width — either the source is
  // smaller than the smallest one (360), or it falls in a gap between two
  // breakpoints (e.g. a ~1059px source between 720 and 1200). Either way,
  // the largest derivative available would otherwise be smaller than the
  // source, forcing the browser to upscale it in the layout. Ship the
  // source's own native width too — never upscaled (round 3 audit fix 1).
  if (widths.length === 0 || widths[widths.length - 1] < sourceWidth) widths.push(sourceWidth)
  const derivatives = []
  for (const width of widths) {
    const outPath = path.join(outDir, `${id}-${width}.webp`)
    const resized = width === sourceWidth ? sharp(src) : sharp(src).resize({ width })
    const info = await resized.webp({ quality: 82 }).toFile(outPath)
    derivatives.push({ width: info.width, height: info.height, file: `images/${room}/${id}-${width}.webp` })
  }
  return { id, room, status: 'ok', sourceWidth, sourceHeight: meta.height, derivatives }
}

const POSTER_SAMPLE_FRACTIONS = [0.1, 0.25, 0.4, 0.55, 0.7]
const POSTER_MIN_MEAN_LUMA = 40

/**
 * `atSeconds` set: a curated single still (POSTER_ONLY's teaser frame,
 * decided by hand, not picked). Otherwise samples POSTER_SAMPLE_FRACTIONS of
 * the clip's duration and keeps the frame with the most contrast (highest
 * luminance stddev) among those clearing POSTER_MIN_MEAN_LUMA; if every
 * sample is dark (a genuinely dark clip, not a bad pick), falls back to the
 * highest-stddev sample rather than reject outright.
 */
async function extractPoster({ room, id, src, atSeconds }) {
  const outDir = path.join(IMAGES_OUT, room)
  mkdirSync(outDir, { recursive: true })
  const posterPath = path.join(outDir, `${id}-poster.webp`)

  const times =
    atSeconds !== undefined
      ? [atSeconds]
      : POSTER_SAMPLE_FRACTIONS.map((fraction) => Math.max(0.1, videoDuration(src) * fraction))

  const candidates = []
  for (let i = 0; i < times.length; i++) {
    const framePath = path.join(outDir, `${id}-poster-candidate-${i}.png`)
    execFileSync('ffmpeg', ['-y', '-ss', String(times[i]), '-i', src, '-frames:v', '1', framePath], {
      stdio: 'pipe',
    })
    candidates.push({ path: framePath, ...(await frameLumaStats(framePath)) })
  }

  const lit = candidates.filter((c) => c.mean >= POSTER_MIN_MEAN_LUMA)
  const pool = lit.length > 0 ? lit : candidates
  const best = pool.reduce((a, b) => (b.stddev > a.stddev ? b : a))

  const info = await sharp(best.path).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toFile(posterPath)
  for (const c of candidates) unlinkSync(c.path)
  return { width: info.width, height: info.height, file: `images/${room}/${id}-poster.webp` }
}

function processVideo({ room, id, src, keepAudio }) {
  mkdirSync(MEDIA_OUT, { recursive: true })
  const outPath = path.join(MEDIA_OUT, `${id}.mp4`)
  const { width, height } = videoDims(src)
  const longSide = Math.max(width, height)
  const scaleArgs =
    longSide > VIDEO_MAX_LONG_SIDE
      ? width >= height
        ? ['-vf', `scale=${VIDEO_MAX_LONG_SIDE}:-2`]
        : ['-vf', `scale=-2:${VIDEO_MAX_LONG_SIDE}`]
      : []
  const audioArgs = keepAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', src,
      ...scaleArgs,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '26',
      '-movflags', '+faststart',
      ...audioArgs,
      outPath,
    ],
    { stdio: 'pipe' },
  )
  const outBytes = statSync(outPath).size
  const outDims = videoDims(outPath)
  return { file: `media/${id}.mp4`, bytes: outBytes, width: outDims.width, height: outDims.height, audioKept: Boolean(keepAudio) }
}

// ---- main --------------------------------------------------------------

/** `--only=id1,id2,...`: regenerate just the named image entries' derivatives
 * against the existing, already-committed manifest — for a targeted fix
 * (like a source-width gap) that shouldn't touch every other image. */
async function regenerateImagesOnly(ids) {
  const imageManifestPath = path.join(IMAGES_OUT, 'manifest.json')
  const imageManifest = JSON.parse(readFileSync(imageManifestPath, 'utf8'))
  const missing = []
  const wanted = new Set(ids)
  const entries = IMAGES.filter((entry) => wanted.has(entry.id))
  const found = new Set(entries.map((e) => e.id))
  for (const id of ids) {
    if (!found.has(id)) console.log(`--only: no IMAGES entry named ${id}, skipped`)
  }

  for (const entry of entries) {
    const result = await processImage(entry)
    if (result.status === 'missing') {
      missing.push(entry.src)
      continue
    }
    imageManifest[result.id] = {
      room: result.room,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      derivatives: result.derivatives,
    }
    console.log(`image  ${result.room}/${result.id}: ${result.derivatives.length} derivative(s)`)
  }

  writeFileSync(imageManifestPath, JSON.stringify(imageManifest, null, 2) + '\n')
  console.log(`\n${entries.length} image entr${entries.length === 1 ? 'y' : 'ies'} regenerated.`)
  if (missing.length > 0) {
    console.log(`Missing source files (${missing.length}):`)
    for (const m of missing) console.log(`  ${path.relative(repoRoot, m)}`)
  }
}

/** `--posters-only`: re-pick every video's poster against the existing,
 * already-committed manifests, with no ffmpeg transcode and no image
 * derivative regeneration. */
async function regeneratePostersOnly() {
  const imageManifestPath = path.join(IMAGES_OUT, 'manifest.json')
  const videoManifestPath = path.join(MEDIA_OUT, 'manifest.json')
  const imageManifest = JSON.parse(readFileSync(imageManifestPath, 'utf8'))
  const videoManifestFile = JSON.parse(readFileSync(videoManifestPath, 'utf8'))
  const missing = []

  for (const entry of VIDEOS) {
    if (!existsSync(entry.src)) {
      missing.push(entry.src)
      continue
    }
    const poster = await extractPoster({ room: entry.room, id: entry.id, src: entry.src })
    imageManifest[`${entry.id}-poster`] = { room: entry.room, poster }
    if (videoManifestFile.videos[entry.id]) videoManifestFile.videos[entry.id].poster = poster.file
    console.log(`poster ${entry.room}/${entry.id} -> ${poster.file}`)
  }

  writeFileSync(imageManifestPath, JSON.stringify(imageManifest, null, 2) + '\n')
  writeFileSync(videoManifestPath, JSON.stringify(videoManifestFile, null, 2) + '\n')
  console.log(`\nPosters regenerated for ${VIDEOS.length} videos.`)
  if (missing.length > 0) {
    console.log(`Missing source files (${missing.length}):`)
    for (const m of missing) console.log(`  ${path.relative(repoRoot, m)}`)
  }
}

async function main() {
  assertSharpNeverImportedBySrc()

  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  if (onlyArg) {
    await regenerateImagesOnly(onlyArg.slice('--only='.length).split(','))
    return
  }

  if (process.argv.includes('--posters-only')) {
    await regeneratePostersOnly()
    return
  }

  const imageManifest = {}
  const missing = []
  for (const entry of IMAGES) {
    const result = await processImage(entry)
    if (result.status === 'missing') {
      missing.push(entry.src)
      continue
    }
    imageManifest[result.id] = {
      room: result.room,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      derivatives: result.derivatives,
    }
    console.log(`image  ${result.room}/${result.id}: ${result.derivatives.length} derivative(s)`)
  }

  for (const entry of POSTER_ONLY) {
    if (!existsSync(entry.src)) {
      missing.push(entry.src)
      continue
    }
    const poster = await extractPoster(entry)
    imageManifest[entry.id] = { room: entry.room, poster }
    console.log(`poster ${entry.room}/${entry.id}`)
  }

  const videoManifest = {}
  let totalVideoBytes = 0
  for (const entry of VIDEOS) {
    if (!existsSync(entry.src)) {
      missing.push(entry.src)
      continue
    }
    const video = processVideo(entry)
    const poster = await extractPoster({ room: entry.room, id: entry.id, src: entry.src })
    imageManifest[`${entry.id}-poster`] = { room: entry.room, poster }
    videoManifest[entry.id] = { room: entry.room, ...video, poster: poster.file }
    totalVideoBytes += video.bytes
    console.log(`video  ${entry.room}/${entry.id}: ${(video.bytes / 1024).toFixed(0)} KiB, audio=${video.audioKept}`)
  }

  writeFileSync(path.join(IMAGES_OUT, 'manifest.json'), JSON.stringify(imageManifest, null, 2) + '\n')
  mkdirSync(MEDIA_OUT, { recursive: true })
  writeFileSync(
    path.join(MEDIA_OUT, 'manifest.json'),
    JSON.stringify({ videos: videoManifest, totalBytes: totalVideoBytes }, null, 2) + '\n',
  )

  console.log(`\nDone. ${Object.keys(imageManifest).length} image entries, ${Object.keys(videoManifest).length} videos (${(totalVideoBytes / 1024 / 1024).toFixed(1)} MiB).`)
  if (missing.length > 0) {
    console.log(`Missing source files (${missing.length}):`)
    for (const m of missing) console.log(`  ${path.relative(repoRoot, m)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
