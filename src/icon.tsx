import type {SVGProps} from 'react'

/**
 * The plugin's arrow, drawn here rather than imported from @sanity/icons. That
 * package's exports changed between major versions (named icons from the root
 * in 3.x, one import path per icon in 5.x), and a Studio may have either.
 *
 * Same 25×25 grid, stroke and `data-sanity-icon` attribute as Sanity's own
 * icons, so Sanity UI sizes and aligns it the same way.
 */
export function RedirectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      data-sanity-icon="redirect"
      width="1em"
      height="1em"
      viewBox="0 0 25 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M19.5 12.5H5" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M14 7L19.5 12.5L14 18" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  )
}

/** A magnifying glass, for the test area. Drawn the same way as the arrow. */
export function TestIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      data-sanity-icon="redirect-test"
      width="1em"
      height="1em"
      viewBox="0 0 25 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth={1.2} />
      <path d="M15 15L20 20" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  )
}
