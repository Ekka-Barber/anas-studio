// Screenshots of the soon page, with no server: the files are handed to the
// browser straight from site/. Run from the repository:
//   node artifacts/soon/shots.cjs                       the main design (main.txt)
//   node artifacts/soon/shots.cjs /v/b/                 another design
//   node artifacts/soon/shots.cjs --sizes=390x844,1280x720
//   node artifacts/soon/shots.cjs --og                  also render site/og.png from the main design
// (In Git Bash, set MSYS_NO_PATHCONV=1 so a leading slash is not rewritten.)
// Each page is shot with reduced motion (its final state), then with motion
// on, and checked: horizontal overflow, page height, console errors, and that
// no text is still hidden a few seconds after it opens.
const { chromium } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const site = path.join(__dirname, 'site')
const shots = path.join(__dirname, 'shots')
const ORIGIN = 'http://soon.local'
const main = `/v/${fs.readFileSync(path.join(__dirname, 'main.txt'), 'utf8').trim()}/`
const args = process.argv.slice(2)
const pages = args.filter((arg) => arg.startsWith('/'))
if (!pages.length) pages.push(main)
const sizes = (args.find((arg) => arg.startsWith('--sizes='))?.slice(8) ?? '360x780,1440x900').split(',').map((size) => size.split('x').map(Number))

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  const browser = await chromium.launch()
  const open = async (viewport, url, options = {}) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options })
    await context.route(`${ORIGIN}/**`, (route) => {
      const { pathname } = new URL(route.request().url())
      const file = path.join(site, pathname.endsWith('/') ? `${pathname}index.html` : pathname)
      return fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' })
    })
    const page = await context.newPage()
    page.on('console', (message) => message.type() === 'error' && console.log(`${url} console error:`, message.text()))
    page.on('pageerror', (error) => console.log(`${url} page error:`, error.message))
    page.on('response', (response) => response.status() >= 400 && console.log(`${url} ${response.status()}:`, response.url()))
    await page.goto(ORIGIN + url, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    return page
  }

  if (args.includes('--og')) {
    // The share picture is the main design itself, at the size link previews use.
    const og = await open({ width: 1200, height: 630 }, main, { reducedMotion: 'reduce' })
    await og.screenshot({ path: path.join(site, 'og.png') })
    console.log(`og.png rendered from ${main}`)
  }

  for (const url of pages) {
    const name = url.replace(/^\/|\/$/g, '').replace(/\//g, '-')
    for (const [width, height] of sizes) {
      const still = await open({ width, height }, url, { reducedMotion: 'reduce' })
      const size = await still.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        height: document.documentElement.scrollHeight,
      }))
      console.log(`${url} ${width}: horizontal overflow ${size.overflow}px, page height ${size.height}px (viewport ${height})`)
      await still.screenshot({ path: path.join(shots, `${name}-${width}.png`) })
      if (size.height > height + 4) await still.screenshot({ path: path.join(shots, `${name}-${width}-full.png`), fullPage: true })

      // Motion on: a frame mid-entrance, then the settled page.
      const moving = await open({ width, height }, url)
      await moving.waitForTimeout(600)
      await moving.screenshot({ path: path.join(shots, `${name}-${width}-motion-early.png`) })
      await moving.waitForTimeout(5000)
      await moving.screenshot({ path: path.join(shots, `${name}-${width}-motion-settled.png`) })
      const hidden = await moving.evaluate(
        () =>
          [...document.querySelectorAll('body *')].filter((el) => {
            const style = getComputedStyle(el)
            return el.textContent.trim() && el.children.length === 0 && (Number(style.opacity) < 0.99 || style.visibility === 'hidden')
          }).length,
      )
      console.log(`${url} ${width}: ${hidden} text element(s) still hidden 5.6s after opening with motion on`)
    }
  }
  await browser.close()
})()
