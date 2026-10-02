// anas.studio before the launch: one of three designs, a different one on
// every load (owner, 2026-10-02). Files under site/ are served without this
// script; it runs only for an address that is not a file: `/` and anything
// unknown.
//
// MODE (wrangler.toml) says which page the domain shows:
//   soon         the soon designs (site/v/<letter>/), 200
//   maintenance  the maintenance designs (site/m/<letter>/), 503
// `/m/` always shows a maintenance design, to look at it without switching.
const DESIGNS = ['a', 'b', 'c']

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const { pathname } = url
    // Always over HTTPS: a page asked for in plain HTTP is sent to its secure address.
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url.href, 301)
    }
    const maintenance = env.MODE === 'maintenance' || pathname === '/m/' || pathname === '/m'

    // The design shown last time is remembered in a cookie that holds one
    // letter and nothing about the visitor, so a reload never repeats it.
    const last = /(?:^|;\s*)soon=([abc])/.exec(request.headers.get('Cookie') ?? '')?.[1]
    const choices = DESIGNS.length > 1 ? DESIGNS.filter((design) => design !== last) : DESIGNS
    const pick = choices[Math.floor(Math.random() * choices.length)]

    const page = await env.ASSETS.fetch(new URL(`/${maintenance ? 'm' : 'v'}/${pick}/`, request.url))
    // Maintenance answers 503 so that a search engine keeps what it has and
    // comes back; the hour is for crawlers only and is shown to no one.
    const response = new Response(page.body, { status: maintenance ? 503 : 200, headers: page.headers })
    if (maintenance) response.headers.set('Retry-After', '3600')
    response.headers.set('Cache-Control', 'no-store')
    response.headers.append('Set-Cookie', `soon=${pick}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`)
    return response
  },
}
