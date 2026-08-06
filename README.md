# sanity-plugin-redirects

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
// structure.ts — optional, for a tidy sidebar entry
import {redirectsListItem} from 'sanity-plugin-redirects'

export const structure = (S) =>
  S.list().items([
    // …
    redirectsListItem(S),
  ])
```

Editors get a **Redirects** list where each row reads `/board.shtml →
/leadership · 301`, with fields for source, destination, a 301/302 toggle, an
enabled toggle and free-text notes.

Validation refuses the mistakes that are expensive to find later: duplicate
sources (checked against the dataset), rules that point at themselves, `*`
anywhere but a trailing `/*`, and sources under your reserved paths.

## 2. Your host

Rules are stored in Sanity but applied by you, because only your host can
return a redirect before the page renders.

```ts
import {fetchRedirects, matchRedirect} from 'sanity-plugin-redirects/match'

const rules = await fetchRedirects({
  projectId: 'yourProjectId',
  dataset: 'production',
  // Where each platform's caching goes. Without it you pay a Sanity round
  // trip per request.
  fetchOptions: {cf: {cacheTtl: 60, cacheEverything: true}}, // Cloudflare
  // fetchOptions: {next: {revalidate: 60}},                 // Next.js
})

const hit = matchRedirect(url.pathname, url.search, rules)
if (hit) {
  const location = /^https?:\/\//.test(hit.location) ? hit.location : url.origin + hit.location
  return Response.redirect(location, hit.status)
}
```

Two things worth getting right when you wire this up:

- **Check redirects after your own routes** (APIs, sitemap, assets), so a rule
  can never shadow the site's plumbing. The schema blocks such sources, but
  ordering is what actually enforces it.
- **Only for `GET`/`HEAD`.** Redirecting a `POST` drops its body.

<details>
<summary>Cloudflare Worker</summary>

```ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // …your own routes first…

    if (request.method === 'GET' || request.method === 'HEAD') {
      const rules = await fetchRedirects({
        projectId: env.SANITY_PROJECT_ID,
        fetchOptions: {cf: {cacheTtl: 60, cacheEverything: true}},
      })
      const hit = matchRedirect(url.pathname, url.search, rules)
      if (hit) {
        const location = /^https?:\/\//.test(hit.location)
          ? hit.location
          : url.origin + hit.location
        return Response.redirect(location, hit.status)
      }
    }

    return env.ASSETS.fetch(request)
  },
}
```

</details>

<details>
<summary>Next.js middleware</summary>

```ts
// middleware.ts
import {NextResponse} from 'next/server'
import {fetchRedirects, matchRedirect} from 'sanity-plugin-redirects/match'

export async function middleware(request) {
  const rules = await fetchRedirects({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    fetchOptions: {next: {revalidate: 60}},
  })
  const {pathname, search, origin} = request.nextUrl
  const hit = matchRedirect(pathname, search, rules)
  if (!hit) return NextResponse.next()

  const location = /^https?:\/\//.test(hit.location) ? hit.location : origin + hit.location
  return NextResponse.redirect(location, hit.status)
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

- Letter case and trailing slashes never distinguish two paths.
- The query string always carries over.
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

REDIRECT_TYPE     // 'redirect'
REDIRECTS_QUERY   // the GROQ behind fetchRedirects, if you'd rather use your own client
```

## Licence

MIT
