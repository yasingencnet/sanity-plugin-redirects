/**
 * The serving half of sanity-plugin-redirects.
 *
 * Zero dependencies and no Sanity or React imports, so it runs anywhere a
 * request can be intercepted: a Cloudflare Worker, Next.js middleware, an
 * Astro middleware, Express, Deno. Import it from `sanity-plugin-redirects/match`
 * — the Studio half never reaches your server bundle.
 *
 *   import {fetchRedirects, redirectResponse} from 'sanity-plugin-redirects/match'
 *
 *   const rules = await fetchRedirects({projectId: 'abc123'})
 *   const redirect = redirectResponse(request, rules)
 *   if (redirect) return redirect
 */

import {ABSOLUTE, resolveRedirect, type RedirectRule} from './resolve.js'

export type {RedirectRule} from './resolve.js'

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
  /** Path + query, or an absolute URL when the rule points off-site. Percent-encoded. */
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
  const resolved = resolveRedirect(pathname, search, rules)
  return resolved && {location: resolved.location, status: resolved.status}
}

export interface RedirectResponseOptions {
  /**
   * Seconds a browser may remember a 301. Defaults to 3600 (an hour). Sent
   * without it, browsers keep a 301 indefinitely, so a mistake in a rule
   * would outlive its fix. A 302 is never remembered.
   */
  maxAge?: number
}

/**
 * The redirect for `request` as a Response to return as it is, or null when
 * no rule applies. Only GET and HEAD are redirected: redirecting a POST drops
 * what it sends.
 *
 * The Location is absolute, and unlike `Response.redirect`'s, the headers can
 * still be changed, for middleware that adds its own afterwards.
 *
 * @param request The incoming request
 * @param rules   From {@link fetchRedirects}
 */
export function redirectResponse(
  request: Request,
  rules: RedirectRule[],
  options: RedirectResponseOptions = {},
): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const url = new URL(request.url)
  const hit = matchRedirect(url.pathname, url.search, rules)
  if (!hit) return null

  const {maxAge = 3600} = options
  return new Response(null, {
    status: hit.status,
    headers: {
      Location: ABSOLUTE.test(hit.location) ? hit.location : url.origin + hit.location,
      'Cache-Control': hit.status === 301 ? `max-age=${maxAge}` : 'no-store',
    },
  })
}
