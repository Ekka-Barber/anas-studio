#!/usr/bin/env node
/**
 * Frozen-source integrity check.
 *
 * `deploy/` holds the frozen V1 design sources: the eight room compositions,
 * their runtime, the licensed fonts and the images. No implementation package
 * may edit them; they are a visual reference, not a build input.
 *
 * This script re-hashes every file under `deploy/` and compares the result with
 * the manifest recorded below. Any change — content, addition or removal —
 * fails with a non-zero exit and names the file.
 *
 * Re-recording the manifest is a deliberate, reviewable act:
 *   node scripts/check-frozen.mjs --write
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const selfPath = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(selfPath), '..')
const FROZEN_ROOT = 'deploy'

/** sha256 of every file under `deploy/`, recorded at the start of P00. */
const MANIFEST = /* FROZEN-MANIFEST-START */ {
  "deploy/design/fonts/thmanyah/thmanyahsans-Bold.woff2": "90f7c5b4c796e102eee70e20a9346fe680c8bfe38289932b5e94290d9f150fb7",
  "deploy/design/fonts/thmanyah/thmanyahsans-Light.woff2": "79bcb61f004600088363b40c3feea4add5a0883c326d767b0994fe1b76044c72",
  "deploy/design/fonts/thmanyah/thmanyahsans-Medium.woff2": "490bf85c58c82b5989a557ed18cd6c6e5a7518b8a440032acf946b5cb7de2850",
  "deploy/design/fonts/thmanyah/thmanyahsans-Regular.woff2": "5bb4fa412273ca31d5c7a165191568b099069cb74bf1fc1dfcdc6a3c2a97552e",
  "deploy/design/fonts/thmanyah/thmanyahserifdisplay-Medium.woff2": "e21a2ea53f90d8e57560d34e0f7dd613d0ebd3a6a19a9a2af3e258638f5f6259",
  "deploy/design/fonts/thmanyah/thmanyahserifdisplay-Regular.woff2": "214a70d9dabcfa18649086841c25ccc67ef6630179837834bcffd3a149131ca6",
  "deploy/design/Home.dc.html": "a65103961670d0c6a9b69247937bcaee4bdd4120beff259888738d28ff7608bd",
  "deploy/design/index.html": "33a0b6faeb6d91a790e6ca22498d87816ba00f5148104a9bb1123bd323da02e2",
  "deploy/design/Motion Spec-print-11tko18.dc.html": "b09113bcba750a33653e64f7a07a64427611e8d1b12e6582fefdc6843af5bd09",
  "deploy/design/Motion Spec.dc.html": "3a5f769845a678eb8e839f74cf0fdf8c213e89cbf332aec1c790c3124cb5ff45",
  "deploy/design/Responsive Frames.dc.html": "5e1b15dd4f7d4bff46043211ac2dfe73c2e5a90bac08c7718bbcc8c4e2b24534",
  "deploy/design/Style Board.dc.html": "2f4491ca7891e6facf6d4eee0f92159cdcf6361d4c1a38dd9b79bfcd4df23b89",
  "deploy/design/support.js": "c2dad9138a0ba660b488702a7414e6116ec6e00a88d6ee6ae37728803c202c2b",
  "deploy/design/المشاهد.dc.html": "c3a7135831f1b1190dad5c739ba8c74c8e852e05082ebcf817ca2ced7d98e383",
  "deploy/design/بدأت هنا.dc.html": "123e1453611c845deea50d15ccd1c3d9a3a23f36bbe3087fa9e584c5dceb0a65",
  "deploy/design/بُنيت هنا.dc.html": "89ade2f6c5737dd1b605b082e509f5074fc24a3db7c583e9e377180bae6a784a",
  "deploy/design/تواصل.dc.html": "2457c547c3380f1984605d9a31e4239186ad8b57b54f8697ed7f797b198daf39",
  "deploy/design/على الرف.dc.html": "2987696bfccef30b4d8c4914ab3b52933dbf90fafefd0d88f21edc835717e2dd",
  "deploy/design/كُتبت هنا.dc.html": "28297833030cfb6802150f44b39d865fac327004e831873e214dea3d50cd5890",
  "deploy/design/مرّت من هنا.dc.html": "e5c2707a2df8449a759c2cdf9624ed75f08517a160918a3db9354cae5c48f7df",
  "deploy/fonts/thmanyah/thmanyahsans-Bold.woff2": "90f7c5b4c796e102eee70e20a9346fe680c8bfe38289932b5e94290d9f150fb7",
  "deploy/fonts/thmanyah/thmanyahsans-Light.woff2": "79bcb61f004600088363b40c3feea4add5a0883c326d767b0994fe1b76044c72",
  "deploy/fonts/thmanyah/thmanyahsans-Medium.woff2": "490bf85c58c82b5989a557ed18cd6c6e5a7518b8a440032acf946b5cb7de2850",
  "deploy/fonts/thmanyah/thmanyahsans-Regular.woff2": "5bb4fa412273ca31d5c7a165191568b099069cb74bf1fc1dfcdc6a3c2a97552e",
  "deploy/fonts/thmanyah/thmanyahserifdisplay-Medium.woff2": "e21a2ea53f90d8e57560d34e0f7dd613d0ebd3a6a19a9a2af3e258638f5f6259",
  "deploy/fonts/thmanyah/thmanyahserifdisplay-Regular.woff2": "214a70d9dabcfa18649086841c25ccc67ef6630179837834bcffd3a149131ca6",
  "deploy/images/char-anas.webp": "85b2a62e1201c45d4b12ddade3419b9dd5a82f7f863e7f88022bcc2f1411f86a",
  "deploy/images/char-children.webp": "0ce817943af9a1acc39f55867927f1fd6db1c6fe387936bb6b3ee557188b3732",
  "deploy/images/char-mothers.webp": "9cc4fbeb26bbe9ca2e5de45bd07963ad725e732ca8d6fa0729a963bc714d003f",
  "deploy/images/ill-closed-door.webp": "20814f68a3ae3c8e459a7a9290f6d5f7c90a4cc0a3cf966b48fb4526b9ac414c",
  "deploy/images/ill-majlis.webp": "c92cfc0a242e05199eb8f92c3035ffe540b3f5e8bc12a38a44133edcc8311ade",
  "deploy/images/ill-portrait.webp": "bd6f6ac70e0f7d081653ff290707a8eb07fc4aa8b5fca000a1e3310c83e48f3d",
  "deploy/images/ill-school-gate.webp": "437d7ae6ff5bf86899daec8469bc058784de3169b783b881a8a7539901d29ff1",
  "deploy/images/ill-street-sign.webp": "f8f4c006cd74ad814d1c9dd902a91b1a73ba11f923490f7221a610d75e62768a",
  "deploy/images/khous-concept-door.webp": "91cd7d5d1d7db79e689ac184e656069c68702767c6c3eb1d3944a680564952d3",
  "deploy/images/khous-concept-engraving.webp": "b441b2cfacc3548b4d7416295f286e4d884b61462eb29bb439d8544a71115969",
  "deploy/images/khous-cover.webp": "3597a878250706085fe51c24c53b90d056f0688c09d4dbe9ebf7d1ffba9ea40e",
  "deploy/images/khous-divider.webp": "5a5101c90f5acd9c484a0971f3e14486e8df9d9e960a61d217e456f92b3c4d50",
  "deploy/images/khous-flat-cover.webp": "0162ce203f5cbf01e56e671e92ad531648c5ee560610ee61dd8b2c79969056e1",
  "deploy/images/khous-flatlay.webp": "0b234775acdb3791910444a564f5b2015e287d34149c8e563cb564cc6920626a",
  "deploy/images/khous-og.jpg": "ffd60f5fb9c5e413f8dfd331e7b6d95f19affa04033563fa3bb001dc55f6f85f",
  "deploy/images/khous-tray.webp": "b2f35c3cf252311daa6b1cd039f8ba5367e38637b96d8ccf1caeec8466ee1cfd",
  "deploy/images/signature-anas.svg": "d9b80ed969a480b757a17d8cbe44f1cb45ac3eb37f84a84689b8c9e80ea913e9",
  "deploy/images/world-closed-door.webp": "3fca5d4f6db7f86be2a2763c4ced03d00779481d3bf1bbd91d16fbdb81da2bc2",
  "deploy/images/world-kindergarten-portrait.webp": "3f2c3e838c01e8bf701f5dd376662b2468e194cdd3c83fa9d1724f01cd0fce19",
  "deploy/images/world-majlis.webp": "bd23cdcee39e440d333613b40eccc45be65cf3ab5ef2f54f9694abb0da0415cc",
  "deploy/images/world-school-gate.webp": "602f87d91c5295cc01c88daadcb825f5be1de88b1f5be75ed8debc5976a3eae8",
  "deploy/images/world-street-sign.webp": "585e854b062752794f4e36b93abdaf88b94066286edbb2cebe59bcbef9be2dd3",
  "deploy/index.html": "30f4768bf86bdc8b16f6bd1f03b8981cbb4e74bbc0212d18652a7ccdc537ddf1",
  "deploy/mobile-fix.css": "7db4220a1bc9919d0aa2a93626ef9a48e9d14f4402efb3810373b3f73b714ab5"
} /* FROZEN-MANIFEST-END */

function listFiles(relativeDir) {
  const entries = readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )
  const files = []
  for (const entry of entries) {
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) files.push(...listFiles(relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

function currentManifest() {
  const manifest = {}
  for (const relative of listFiles(FROZEN_ROOT)) {
    manifest[relative] = createHash('sha256')
      .update(readFileSync(path.join(repoRoot, relative)))
      .digest('hex')
  }
  return manifest
}

const actual = currentManifest()

if (process.argv.includes('--write')) {
  const source = readFileSync(selfPath, 'utf8')
  const anchor = source.indexOf('const MANIFEST =')
  const startMarker = source.indexOf('/*', anchor)
  const startEnd = source.indexOf('*/', startMarker) + 2
  const endMarker = source.indexOf('/*', startEnd)
  const next =
    source.slice(0, startEnd) +
    ' ' +
    JSON.stringify(actual, null, 2) +
    ' ' +
    source.slice(endMarker)
  writeFileSync(selfPath, next)
  console.log(`Recorded ${Object.keys(actual).length} frozen file hashes.`)
  process.exit(0)
}

const recordedCount = Object.keys(MANIFEST).length
if (recordedCount === 0) {
  console.error('Frozen manifest is empty. Run `node scripts/check-frozen.mjs --write`.')
  process.exit(1)
}

const problems = []
for (const [relative, hash] of Object.entries(MANIFEST)) {
  if (!(relative in actual)) problems.push(`removed:  ${relative}`)
  else if (actual[relative] !== hash) problems.push(`modified: ${relative}`)
}
for (const relative of Object.keys(actual)) {
  if (!(relative in MANIFEST)) problems.push(`added:    ${relative}`)
}

if (problems.length > 0) {
  console.error(`Frozen sources under ${FROZEN_ROOT}/ changed:`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(`check:frozen OK — ${recordedCount} files under ${FROZEN_ROOT}/ unchanged.`)
