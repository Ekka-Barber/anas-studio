# The soon and maintenance pages of anas.studio

One screen that holds anas.studio until the real site launches, and one for when the site is taken down on purpose (D46, D47, owner, 2026-10-02). It uses the brand's colours and Thmanyah, and none of the main site's compositions: the real design is first seen at launch. It is separate from the product: nothing in `src/`, `public/` or `supabase/` knows about it.

## The designs

Three designs were made, and the domain shows one of them at random, a different one on every load (owner, 2026-10-02). `worker.js` picks it; a cookie holding one letter (the design shown last) keeps a reload from repeating it.

| | Design | Address |
|---|---|---|
| `a` | «الحصير»: a palm mat still being woven, its strips left uncut | `/v/a/` |
| `b` | The word «قريباً» as a poster on coral | `/v/b/` |
| `c` | Anas at an open door, «أهلاً بك» | `/v/c/` |

The share picture (`site/og.png`) can only be one image: it is the design named in `main.txt`. To show one design only, make `DESIGNS` in `worker.js` a list of one.

## Soon or maintenance

Each design has a maintenance twin in `site/m/<letter>/`: the same page and stylesheet with maintenance words («صيانة», «أرتّب المكان، وأعود قريباً.», «الموقع في صيانة الآن.», «أعود قريباً»). In maintenance the domain answers 503 with `Retry-After`, so a search engine keeps what it has; the hour in that header is for crawlers and is shown to no one.

The state is the Worker variable `MODE` in `wrangler.toml` (`soon` or `maintenance`). To switch it:

```sh
node --env-file=.env artifacts/soon/deploy.cjs --mode=maintenance
node --env-file=.env artifacts/soon/deploy.cjs --mode=soon
```

A deploy without `--mode` publishes the mode written in `wrangler.toml`.

https://anas.studio/m/ always shows a maintenance design, to look at it without switching. The switch in the admin («حالة الموقع» on `/admin/settings`) is SITE-STATE-1: `PLANS/SITE-STATE-CONTRACT.md`.

## What is in it

- `site/v/<letter>/index.html` and `style.css`: one soon design each. No script in the page. `site/m/<letter>/index.html`: its maintenance twin, on the same stylesheet. The mat's two drawings (wide and tall) are inline SVG, and the strip rules at the end of its `style.css` belong to them.
- `site/fonts/`, `site/brand/`, `site/images/v2/`, the icons: copied unchanged from `public/` and `src/app/`.
- `site/_headers`: security headers and `X-Robots-Tag: noindex`. The page is not indexed until the launch (P10 owns the search title and description). Remove that one line to open it.
- `site/og.png`: the share picture, a 1200x630 shot of the main design.
- `wrangler.toml` and `worker.js`: the Worker `anas-studio-soon` on the Custom Domains `anas.studio` and `www.anas.studio`. Files are served as they are; `/` and any unknown path get one of the designs from the script.
- `deploy.cjs`: deploys.
- `shots.cjs`: screenshots into `shots/` and the checks (overflow, page height, hidden text, console errors).

## The words

His name as «أنس القرني» (owner, 2026-10-02: no «عبدالله» here), «قريباً», his own line «أبني الأفكار والأماكن والحكايات», «تجدني هنا:» and three links. Design `c` also says «أهلاً بك».

- The name is one text node in each `index.html`, and it is also in the `<title>` and the `og:` tags.
- The X link is left out: the seeded address is `x.com/anasa.aq`, and an X handle cannot contain a dot.
- No date, no price, no form.

## Change it and deploy

```sh
node artifacts/soon/shots.cjs --og
node --env-file=.env artifacts/soon/deploy.cjs
```

The deploy goes to Anas's Cloudflare account with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `.env`; the script passes wrangler nothing else from that file, and deploys from a copy outside the repository (the repository's wrangler cache pins another account).

The zone adds Cloudflare Web Analytics to the page by itself, so the Content-Security-Policy allows that one script and its two endpoints. Nothing else leaves the domain.

## At launch (P11)

The real site goes on Cloudflare Pages (D32). Before attaching anas.studio to the Pages project, free the name: delete this Worker (`npx wrangler delete --name anas-studio-soon`, with the same two variables), which removes its Custom Domains and DNS records, then add the domain to Pages. When the real site is live, this Worker becomes the gate that shows these pages in front of it when the owner switches the state (SITE-STATE-1).
