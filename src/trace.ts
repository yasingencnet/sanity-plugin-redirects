/**
 * The Studio test area's logic, apart from its screen: which rules apply,
 * and every hop an address takes through them. No React, so it is tested
 * in plain Node.
 */
import {ABSOLUTE, canonicalize, resolveRedirect, splitAddress, type RedirectRule} from './resolve.js'

/** A rule document as the test area reads it. */
export interface RuleDocument extends RedirectRule {
  _id: string
  enabled?: boolean
}

/**
 * The enabled rules: the published ones, or with `drafts`, the published
 * ones with unpublished changes laid over them (and new rules not yet
 * published). Each keeps its published id, which is what opens it.
 */
export function currentRules(documents: RuleDocument[], drafts: boolean): RuleDocument[] {
  const byId = new Map<string, RuleDocument>()
  for (const document of documents) {
    if (!document._id.startsWith('drafts.') && !document._id.startsWith('versions.')) {
      byId.set(document._id, document)
    }
  }
  if (drafts) {
    for (const document of documents) {
      if (!document._id.startsWith('drafts.')) continue
      const _id = document._id.slice('drafts.'.length)
      byId.set(_id, {...document, _id})
    }
  }
  return [...byId.values()].filter((document) => document.enabled !== false)
}

export interface Hop {
  /** Where this hop starts: path and query. */
  from: string
  /** Where it sends the visitor: path and query, or a full URL. */
  to: string
  status: 301 | 302
  rule: RedirectRule
}

export interface Trace {
  /** The address as visitors would send it: `/old?a=1` for `old?a=1`. */
  start: string
  hops: Hop[]
  /**
   * - `stays`: at an address no rule redirects (with no hops: no redirect at all)
   * - `leaves`: at another site
   * - `loops`: back at an address it already passed
   * - `endless`: still redirecting after the limit
   */
  end: 'stays' | 'leaves' | 'loops' | 'endless'
}

/**
 * Every hop a visitor to `address` takes, the way a browser follows them:
 * one redirect, then the next request, and so on.
 */
export function traceRedirects(address: string, rules: RedirectRule[], limit = 10): Trace {
  const hops: Hop[] = []
  let {pathname, search} = splitAddress(address)
  const start = pathname + search
  const seen = new Set([canonicalize(pathname)])

  for (;;) {
    const hit = resolveRedirect(pathname, search, rules)
    if (!hit) return {start, hops, end: 'stays'}
    hops.push({from: pathname + search, to: hit.location, status: hit.status, rule: hit.rule})
    if (ABSOLUTE.test(hit.location)) return {start, hops, end: 'leaves'}

    ;({pathname, search} = splitAddress(hit.location))
    const key = canonicalize(pathname)
    if (seen.has(key)) return {start, hops, end: 'loops'}
    seen.add(key)
    if (hops.length >= limit) return {start, hops, end: 'endless'}
  }
}
