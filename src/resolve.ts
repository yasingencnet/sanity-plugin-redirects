/**
 * How a rule is chosen and where it sends a visitor. Shared by the matcher
 * (`/match`) and the Studio's test area, which also shows which rule applied.
 * Not exported from the package: `matchRedirect` is the public way in.
 */

/** One rule as stored in Sanity. */
export interface RedirectRule {
  source?: string
  destination?: string
  permanent?: boolean
}

export const ABSOLUTE = /^https?:\/\//i

/** Paths are joined to this, never resolved against it, so `//x` stays a path. */
const PLACEHOLDER = 'http://placeholder.invalid'

/**
 * Percent-encoded the way a browser sends it, so `/café` typed in the Studio
 * and `/caf%C3%A9` from the request are one address. Escapes already there
 * are kept as they are.
 */
const encodePath = (path: string): string => {
  try {
    return new URL(PLACEHOLDER + path).pathname
  } catch {
    return path
  }
}

/** Without trailing slashes, except for the root itself. */
const trimSlashes = (path: string): string => path.replace(/\/+$/, '') || '/'

/** Trailing slashes, letter case and percent-encoding never distinguish two pages. */
export const canonicalize = (path: string): string => trimSlashes(encodePath(path)).toLowerCase()

/**
 * `target` ready for a Location header: percent-encoded (a header can't carry
 * `é`), with the visitor's query string added after any the destination has
 * of its own, and before its #fragment.
 */
function toLocation(target: string, search: string): string | null {
  const absolute = ABSOLUTE.test(target)
  let url: URL
  try {
    url = new URL(absolute ? target : PLACEHOLDER + target)
  } catch {
    return null
  }
  const query = search.replace(/^\?/, '')
  if (query) url.search = url.search ? `${url.search}&${query}` : query
  return absolute ? url.href : url.pathname + url.search + url.hash
}

/** A path and query as typed, split apart: `/a?b=1`, `a`, or a full URL on this site. */
export function splitAddress(address: string): {pathname: string; search: string} {
  const trimmed = address.trim()
  try {
    const url = new URL(
      ABSOLUTE.test(trimmed) ? trimmed : PLACEHOLDER + (trimmed.startsWith('/') ? '' : '/') + trimmed,
    )
    return {pathname: url.pathname, search: url.search}
  } catch {
    return {pathname: '/', search: ''}
  }
}

export interface Resolved {
  rule: RedirectRule
  location: string
  status: 301 | 302
}

/** See `matchRedirect`, which this is, plus the rule that applied. */
export function resolveRedirect(
  pathname: string,
  search: string,
  rules: RedirectRule[],
): Resolved | null {
  // Matched lowercased; the visitor's own letter case is what a folder rule
  // carries across.
  const visited = trimSlashes(encodePath(pathname))
  const path = visited.toLowerCase()

  let best: {
    rule: RedirectRule
    destination: string
    suffix: string
    exact: boolean
    length: number
  } | null = null

  for (const rule of rules) {
    const source = rule.source?.trim()
    const destination = rule.destination?.trim()
    if (!source?.startsWith('/') || !destination) continue
    if (!destination.startsWith('/') && !ABSOLUTE.test(destination)) continue

    if (source.endsWith('/*')) {
      const prefix = canonicalize(source.slice(0, -2))
      const root = prefix === '/'
      if (!root && path !== prefix && !path.startsWith(prefix + '/')) continue
      if (!best || (!best.exact && prefix.length > best.length)) {
        // What follows the folder: '' or '/…'. Under `/*` that's the whole path.
        const suffix = root ? (path === '/' ? '' : visited) : visited.slice(prefix.length)
        best = {rule, destination, suffix, exact: false, length: prefix.length}
      }
    } else if (canonicalize(source) === path) {
      best = {rule, destination, suffix: '', exact: true, length: path.length}
      break
    }
  }

  if (!best) return null

  const {rule, destination, suffix} = best
  const target = (destination.endsWith('/*') ? destination.slice(0, -2) + suffix : destination) || '/'

  if (!ABSOLUTE.test(target) && canonicalize(target) === path) return null

  const location = toLocation(target, search)
  return location ? {rule, location, status: rule.permanent === false ? 302 : 301} : null
}
