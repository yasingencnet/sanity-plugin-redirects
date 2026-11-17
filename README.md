# sanity-plugin-redirects

[![npm](https://img.shields.io/npm/v/sanity-plugin-redirects)](https://www.npmjs.com/package/sanity-plugin-redirects)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/sanity-plugin-redirects)](https://bundlephobia.com/package/sanity-plugin-redirects)
[![licence](https://img.shields.io/npm/l/sanity-plugin-redirects)](./LICENSE)

Editor-managed 301/302 redirects for Sanity, in the spirit of WordPress's
[Redirection](https://wordpress.org/plugins/redirection/) plugin: an SEO team
owns a list of "this old URL now lives here" rules in the Studio, and your host
applies them with a real redirect status.

Two entry points ship in one package, so you cannot install one half and forget
the other:

| Import | What it is | Dependencies |
| --- | --- | --- |
| `sanity-plugin-redirects` | Studio schema + sidebar item | peer: `sanity`, `react` |
| `sanity-plugin-redirects/match` | the matcher you run per request | **none** |

The `/match` entry pulls in neither Sanity nor React, so it is safe in edge
middleware and Workers where a React import would be dead weight or an error.

## Install

```sh
npm install sanity-plugin-redirects
```

## 1. Studio

```ts
// sanity.config.ts
import {defineConfig} from 'sanity'
import {redirectsPlugin} from 'sanity-plugin-redirects'

export default defineConfig({
  // …
  plugins: [redirectsPlugin()],
})
```

```ts
// structure.ts — for the sidebar entry and its test area
import {redirectsListItem} from 'sanity-plugin-redirects'

export const structure = (S) =>
  S.list().items([
    // …
    redirectsListItem(S),
  ])
```

Editors get **Redirects** in the sidebar, with two items:

- **All redirects**: a list where each row reads `/board.shtml → /leadership ·
  301`, with fields for source, destination, a 301/302 toggle, an enabled
  toggle and free-text notes.
- **Test an address**: type an old address and see every hop it takes, the
  rule behind each (one click opens it), and a warning for chains
  (`/a` → `/b` → `/c`), circles, and folder rules that keep feeding
  themselves. It reads the published rules, or with *Include unpublished
  changes*, the drafts too, so a rule can be tried before it goes live. It
  runs the same matcher your host does.

Validation refuses the mistakes that are expensive to find later: duplicate
sources (checked against the dataset), rules that point at themselves, `*`
anywhere but a trailing `/*`, and sources under your reserved paths.

## 2. Your host

Rules are stored in Sanity but applied by you, because only your host can
return a redirect before the page renders.

```ts
import {fetchRedirects, redirectResponse} from 'sanity-plugin-redirects/match'

const rules = await fetchRedirects({
  projectId: 'yourProjectId',
  dataset: 'production',
  // Where each platform's caching goes. Without it you pay a Sanity round
  // trip per request.
  fetchOptions: {cf: {cacheTtl: 60, cacheEverything: true}}, // Cloudflare
  // fetchOptions: {next: {revalidate: 60}},                 // Next.js
})

const redirect = redirectResponse(request, rules)
if (redirect) return redirect
```

`redirectResponse` builds the whole answer: the status, an absolute
`Location`, and headers you can still change, so middleware that adds its own
(a password gate, say) works on it. `Response.redirect`'s headers can't be
changed.

Things worth getting right when you wire this up:

- **Check redirects after your own routes** (APIs, sitemap, assets), so a rule
  can never shadow the site's plumbing. The schema blocks such sources, but
  ordering is what actually enforces it.
- **Only `GET` and `HEAD` are redirected.** Redirecting a `POST` drops its
  body, so `redirectResponse` returns `null` for anything else.
- **Browsers remember a 301 for an hour** (`Cache-Control: max-age=3600`), so a
  mistake in a rule fixes itself soon after the rule does. Sent without it,
  browsers keep a 301 indefinitely. Change it with `{maxAge}`, in seconds; a
  302 is never remembered.

On a host without Fetch's `Request` and `Response` (Express, say), call
`matchRedirect(pathname, search, rules)` and send its `status` and `location`
yourself.

<details>
<summary>Cloudflare Worker</summary>

```ts
import {fetchRedirects, redirectResponse} from 'sanity-plugin-redirects/match'

export default {
  async fetch(request, env) {
    // …your own routes first…

    const rules = await fetchRedirects({
      projectId: env.SANITY_PROJECT_ID,
      fetchOptions: {cf: {cacheTtl: 60, cacheEverything: true}},
    })
    return redirectResponse(request, rules) ?? env.ASSETS.fetch(request)
  },
}
```

**With static assets and a 404 page** (`not_found_handling`), Cloudflare
answers a browser's visit to a missing page with that page without running
your Worker, on compatibility dates from 2025-04-01. No redirect would be
checked. Add the `assets_navigation_has_no_effect` compatibility flag so those
visits reach your Worker, or set `run_worker_first`.

</details>

<details>
<summary>Next.js middleware</summary>

```ts
// middleware.ts
import {NextResponse} from 'next/server'
import {fetchRedirects, redirectResponse} from 'sanity-plugin-redirects/match'

export async function middleware(request) {
  const rules = await fetchRedirects({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    fetchOptions: {next: {revalidate: 60}},
  })
  return redirectResponse(request, rules) ?? NextResponse.next()
}

export const config = {matcher: '/((?!_next|api|.*\\..*).*)'}
```

</details>

## How a rule matches

| Rule | Request | Result |
| --- | --- | --- |
| `/board.shtml` → `/leadership` | `/board.shtml` | `301 /leadership` |
| `/board.shtml` → `/leadership` | `/Board.shtml/?a=1` | `301 /leadership?a=1` |
| `/old-news/*` → `/news/*` | `/old-news/2019/gala` | `301 /news/2019/gala` |
| `/old-news/*` → `/archive` | `/old-news/2019/gala` | `301 /archive` |
| `/temp` → `/x`, permanent off | `/temp` | `302 /x` |
| `/old/*` → `/new/*` | `/OLD/Report.PDF` | `301 /new/Report.PDF` |
| `/*` → `https://new.example/*` | `/about/team` | `301 https://new.example/about/team` |
| `/café` → `/cafe` | `/caf%C3%A9` | `301 /cafe` |
| `/promo` → `https://shop.example/p?ref=1` | `/promo?utm=x` | `301 https://shop.example/p?ref=1&utm=x` |

- Letter case (A to Z), trailing slashes and percent-encoding never
  distinguish two paths: `/Café/` and `/caf%C3%A9` are one.
- A folder rule carries the rest of the address across as the visitor typed
  it, letter case included.
- The query string always carries over, added to any the destination has.
- The `location` is percent-encoded, ready for a `Location` header.
- An exact rule beats a folder rule; among folder rules the longest prefix
  wins, so `/old/news/*` can carve an exception out of `/old/*`.
- One hop only. A rule resolving to its own source is dropped rather than
  looped; if a destination is itself redirected, the browser makes that request.
- Drafts are never applied — a half-written rule cannot take a live URL down.
- A failed fetch yields no rules rather than throwing. A redirects outage
  should cost you redirects, not your site.

## Deliberately not included

**Hit counting.** A database write per redirected visit is the wrong trade at
the edge. Your CDN or analytics already counts these.

**Regex sources.** Nearly every real rule is an exact path or a folder move.
Regex mostly ships foot-guns — an unanchored pattern can swallow the whole
site. A migration that genuinely needs one should express it in code, where it
can be reviewed and tested.

**Host-level redirects** — HTTP→HTTPS, `www`↔apex. These are settings on your
CDN or DNS, not content. Nobody should be able to change the site's canonical
host from a CMS.

## API

```ts
redirectsPlugin(options?: {
  reservedPaths?: string[]  // default ['/api', '/assets', '/_next', '/static']
  title?: string            // default 'Redirects'
})

redirectsListItem(S, options?)

fetchRedirects(config: {
  projectId: string
  dataset?: string          // default 'production'
  apiVersion?: string       // default '2024-10-01'
  fetchOptions?: RequestInit
}): Promise<RedirectRule[]>

matchRedirect(
  pathname: string,
  search: string,
  rules: RedirectRule[],
): {location: string; status: 301 | 302} | null

redirectResponse(
  request: Request,
  rules: RedirectRule[],
  options?: {maxAge?: number}  // seconds a browser keeps a 301; default 3600
): Response | null

REDIRECT_TYPE     // 'redirect'
REDIRECTS_QUERY   // the GROQ behind fetchRedirects, if you'd rather use your own client
```

## Contributing

```sh
npm install
npm test          # 42 tests, run against dist so they check what ships
npm run build
```

Issues and pull requests are welcome at
[yasingencnet/sanity-plugin-redirects](https://github.com/yasingencnet/sanity-plugin-redirects).

## Licence

MIT © [Yasin Genc](https://github.com/yasingencnet)
