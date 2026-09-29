/**
 * I40: a production export must never ship the local demo catalog (D37). The
 * demo seed (`scripts/seed-demo-catalog.mjs`) writes only to a loopback
 * database and marks what it writes with «تجريبي»: the product names end in
 * «(تجريبي)» and every policy reads «نص تجريبي يكتبه أنس ويعتمده قبل فتح
 * المتجر.». Demo text on a page built against a non-loopback Supabase
 * therefore means demo rows reached a real database.
 *
 * The Supabase target is read from the export itself, never from the shell,
 * which may differ from the build's: the build inlines NEXT_PUBLIC_SUPABASE_URL
 * into its JavaScript (and into media URLs in HTML), followed by an API path
 * such as `/rest/v1/`. A bare URL is not enough, because supabase-js carries
 * its own `http://localhost:9999` default.
 *
 * Only a page's visible text counts: the admin bundle names the demo badge
 * «تجريبي» in its JavaScript, and a page's inline scripts repeat its content.
 */

const DEMO_WORD = 'تجريبي'
const SUPABASE_URL = /(https?:\/\/[^\s"'`<>\\/?#]+)\/+(?:rest|functions|storage|auth)\/v1\b/g

function isLoopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost')
}

/** The page's text outside scripts, styles, comments and tags. */
function visibleText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
}

/**
 * The I40 decision for one export: it fails when the Supabase origin cannot
 * be found, or when a page shows demo text in a build against a non-loopback
 * Supabase. The message names origins and pages, never a key.
 *
 * @param {Array<{ path: string, text: string }>} files the export's HTML and JavaScript, paths relative to out/
 * @returns {{ ok: boolean, message: string }}
 */
export function checkDemoContent(files) {
  const origins = new Set()
  for (const { text } of files) {
    for (const match of text.matchAll(SUPABASE_URL)) {
      try {
        origins.add(new URL(match[1]).origin)
      } catch {
        // Not a URL after all.
      }
    }
  }
  if (origins.size === 0) {
    return {
      ok: false,
      message:
        'cannot find the Supabase origin (NEXT_PUBLIC_SUPABASE_URL) in the built JavaScript or HTML, so a local build cannot be told from a production one (PLANS/ISSUES.md I40)',
    }
  }

  const list = [...origins].join(', ')
  const local = [...origins].every((origin) => isLoopback(new URL(origin).hostname))
  const demoPages = files
    .filter((file) => file.path.endsWith('.html') && visibleText(file.text).includes(DEMO_WORD))
    .map((file) => file.path)

  if (demoPages.length === 0) return { ok: true, message: `no demo content; Supabase origin ${list}` }
  if (local) {
    return {
      ok: true,
      message: `demo content («${DEMO_WORD}») on ${demoPages.length} page(s), allowed only in a build against a loopback Supabase (${list}); a production build fails here (I40)`,
    }
  }
  return {
    ok: false,
    message:
      `demo content («${DEMO_WORD}») in a build against ${list}, on ${demoPages.join(', ')}. ` +
      "The demo catalog (D37) must never ship: remove the demo rows, publish Anas's approved policy text and rebuild (PLANS/ISSUES.md I40).",
  }
}
