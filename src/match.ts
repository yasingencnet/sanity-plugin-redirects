/**
 * The serving half of sanity-plugin-redirects.
 *
 * Zero dependencies and no Sanity or React imports, so it runs anywhere a
 * request can be intercepted: a Cloudflare Worker, Next.js middleware, an
 * Astro middleware, Express, Deno. Import it from `sanity-plugin-redirects/match`
 * — the Studio half never reaches your server bundle.
 *
 *   import {fetchRedirects, matchRedirect} from 'sanity-plugin-redirects/match'
 *
 *   const rules = await fetchRedirects({projectId: 'abc123'})
 *   const hit = matchRedirect(url.pathname, url.search, rules)
 *   if (hit) return Response.redirect(url.origin + hit.location, hit.status)
 */

/** One rule as stored in Sanity. */
export interface RedirectRule {
  source?: string
  destination?: string
  permanent?: boolean
}

export interface RedirectsConfig {
  /** Your Sanity project id. Required — there is no sensible default. */
  projectId: string
  /** Defaults to 'production'. */
  dataset?: string
  /** Defaults to '2024-10-01'. */
  apiVersion?: string
  /**
   * Passed straight to `fetch`. This is where each platform's caching goes,
   * and it matters: without it every request costs a Sanity round trip.
   *
   *   Cloudflare  {cf: {cacheTtl: 60, cacheEverything: true}}
   *   Next.js     {next: {revalidate: 60}}
   *
   * On a plain Node host, cache the resolved array yourself instead.
   */
  fetchOptions?: RequestInit
}

export interface RedirectHit {
  /** Path + query, or an absolute URL when the rule points off-site. */
  location: string
  status: 301 | 302
}

/** The document type this plugin registers. */
export const REDIRECT_TYPE = 'redirect'

/** Every enabled rule. Exported so you can run it through your own client. */
export const REDIRECTS_QUERY = `*[_type == "${REDIRECT_TYPE}" && enabled != false]{
  source, destination, permanent
}`

/**
 * Fetch the rules from Sanity's CDN API.
 *
 * `perspective=published` is deliberate: a half-written draft redirect must
 * never take a live URL out of service.
 *
 * A failed fetch yields no rules rather than throwing. A redirects outage
 * should cost you redirects, not the whole site.
 */
export async function fetchRedirects(config: RedirectsConfig): Promise<RedirectRule[]> {
  const {projectId, dataset = 'production', apiVersion = '2024-10-01', fetchOptions} = config
  if (!projectId) return []

  const url =
    `https://${projectId}.apicdn.sanity.io/v${apiVersion}/data/query/${dataset}` +
    `?query=${encodeURIComponent(REDIRECTS_QUERY)}&perspective=published`

  try {
    const res = await fetch(url, fetchOptions)
    if (!res.ok) return []
    const body = (await res.json()) as {result?: RedirectRule[]}
    return Array.isArray(body.result) ? body.result : []
  } catch {
    return []
  }
}

/** Trailing slashes and letter case never distinguish two pages. */
const canonicalize = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  return (trimmed === '' ? '/' : trimmed).toLowerCase()
}

/**
 * The redirect for `pathname`, or null when no rule applies.
 *
 * Precedence: an exact rule beats a folder (`/*`) rule, and among folder rules
 * the longest prefix wins — so `/old/news/*` can carve an exception out of
 * `/old/*`.
 *
 * The query string always survives the hop, because campaign tags on inbound
 * links are exactly what a migration must not drop.
 *
 * One hop only: if a destination is itself redirected the browser makes the
 * second request, and a rule that resolves to its own source is dropped rather
 * than bounced forever.
 *
 * @param pathname Request path, e.g. `/board.shtml`
 * @param search   Query string including `?`, or `''`
 * @param rules    From {@link fetchRedirects}
 */
export function matchRedirect(
  pathname: string,
  search: string,
  rules: RedirectRule[],
): RedirectHit | null {
  const path = canonicalize(pathname)

  let best: {rule: RedirectRule; suffix: string; exact: boolean; length: number} | null = null

  for (const rule of rules) {
    const source = rule.source?.trim()
    if (!source || !rule.destination?.trim()) continue

    if (source.endsWith('/*')) {
      const prefix = canonicalize(source.slice(0, -2))
      const matches = path === prefix || path.startsWith(prefix === '/' ? '/' : prefix + '/')
      if (!matches) continue
      if (!best || (!best.exact && prefix.length > best.length)) {
        best = {rule, suffix: path.slice(prefix.length), exact: false, length: prefix.length}
      }
    } else if (canonicalize(source) === path) {
      best = {rule, suffix: '', exact: true, length: source.length}
      break
    }
  }

  if (!best) return null

  const destination = best.rule.destination!.trim()
  const location = destination.endsWith('/*')
    ? destination.slice(0, -2) + best.suffix
    : destination

  if (canonicalize(location) === path && !/^https?:\/\//.test(location)) return null

  return {
    location: (location || '/') + search,
    status: best.rule.permanent === false ? 302 : 301,
  }
}
