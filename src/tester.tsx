import {useState, type CSSProperties, type FormEvent, type ReactNode} from 'react'
import {useClient} from 'sanity'
import {IntentLink} from 'sanity/router'

import {REDIRECT_TYPE} from './match.js'
import {currentRules, traceRedirects, type Hop, type RuleDocument, type Trace} from './trace.js'

/**
 * The test area: type an address, see every hop it takes and the rule behind
 * each, using the same matcher the site runs.
 *
 * Built from plain elements styled with Sanity UI's own colour variables
 * (`--card-*`, the same in every version), rather than importing @sanity/ui:
 * a Studio has exactly one copy of it, and the plugin shouldn't bring another.
 */

/** Every rule, drafts and disabled ones too: which apply is worked out here. */
const RULES_QUERY = `*[_type == $type]{_id, source, destination, permanent, enabled}`

type State =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'done'; trace: Trace}
  | {status: 'error'; message: string}

export function RedirectTester() {
  const client = useClient({apiVersion: '2024-10-01'})
  const [address, setAddress] = useState('')
  const [drafts, setDrafts] = useState(false)
  const [state, setState] = useState<State>({status: 'idle'})

  async function run(typed: string, withDrafts: boolean) {
    if (!typed.trim()) return
    setState({status: 'loading'})
    try {
      const documents = await client.fetch<RuleDocument[]>(
        RULES_QUERY,
        {type: REDIRECT_TYPE},
        {perspective: 'raw'},
      )
      const trace = traceRedirects(typed, currentRules(documents, withDrafts))
      setState({status: 'done', trace})
    } catch (error) {
      setState({status: 'error', message: error instanceof Error ? error.message : String(error)})
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    run(address, drafts)
  }

  return (
    <div style={styles.page}>
      <p style={styles.muted}>
        Type an old address to see where visitors end up. If a page still exists at that
        address, your site may show it instead.
      </p>

      <form onSubmit={submit} style={styles.row}>
        <input
          aria-label="Address to test"
          placeholder="/old-page"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          style={styles.input}
          autoFocus
        />
        <button type="submit" style={styles.button} disabled={!address.trim()}>
          Test
        </button>
      </form>

      <label style={styles.checkbox}>
        <input
          type="checkbox"
          style={styles.box}
          checked={drafts}
          onChange={(event) => {
            setDrafts(event.target.checked)
            if (state.status === 'done') run(address, event.target.checked)
          }}
        />
        Include unpublished changes
      </label>

      <div aria-live="polite">
        {state.status === 'loading' && <p style={styles.muted}>Checking…</p>}
        {state.status === 'error' && (
          <Note tone="critical">Couldn't read the redirects: {state.message}</Note>
        )}
        {state.status === 'done' && <Result trace={state.trace} />}
      </div>
    </div>
  )
}

/** Exported for trying the screen with made-up rules; not part of the package's API. */
export function Result({trace}: {trace: Trace}) {
  const {start, hops, end} = trace
  if (hops.length === 0) {
    return (
      <Note tone="default">
        No redirect. Visitors to <Code>{readable(start)}</Code> stay there.
      </Note>
    )
  }

  const last = hops[hops.length - 1]
  // Endless ones repeat themselves: the first few show how.
  const shown = end === 'endless' ? hops.slice(0, 3) : hops
  return (
    <div style={styles.stack}>
      <ol style={styles.hops}>
        {shown.map((hop, index) => (
          <HopRow key={index} hop={hop} />
        ))}
        {shown.length < hops.length && (
          <li style={styles.muted}>…and {hops.length - shown.length} more hops the same way.</li>
        )}
      </ol>
      {end === 'loops' && (
        <Note tone="critical">
          These redirects go round in a circle, so browsers give up and show an error. Change
          one of them.
        </Note>
      )}
      {end === 'endless' && (
        <Note tone="critical">
          Still redirecting after {hops.length} hops, so browsers give up and show an error. A
          folder rule (ending in /*) may be sending addresses back into itself.
        </Note>
      )}
      {(end === 'stays' || end === 'leaves') && hops.length > 1 && (
        <Note tone="caution">
          This takes {hops.length} hops. Point <Code>{readable(hops[0].from)}</Code> straight to{' '}
          <Code>{readable(last.to)}</Code> so visitors get there in one.
        </Note>
      )}
      {(end === 'stays' || end === 'leaves') && hops.length === 1 && (
        <Note tone="positive">
          Visitors end up at <Code>{readable(last.to)}</Code>
          {end === 'leaves' ? ', on another site.' : '.'}
        </Note>
      )}
    </div>
  )
}

function HopRow({hop}: {hop: Hop}) {
  const rule = hop.rule as RuleDocument
  return (
    <li style={styles.hop}>
      <div style={styles.hopLine}>
        <span style={hop.status === 301 ? styles.badge301 : styles.badge302}>{hop.status}</span>
        <Code>{readable(hop.from)}</Code>
        <span aria-label="to">→</span>
        <Code>{readable(hop.to)}</Code>
      </div>
      <div style={styles.muted}>
        {hop.status === 301 ? 'Permanent' : 'Temporary'}, by the rule{' '}
        <IntentLink intent="edit" params={{id: rule._id, type: REDIRECT_TYPE}} style={styles.link}>
          {rule.source} → {rule.destination}
        </IntentLink>
      </div>
    </li>
  )
}

function Note({tone, children}: {tone: 'default' | 'positive' | 'caution' | 'critical'; children: ReactNode}) {
  return <p style={{...styles.note, ...tones[tone]}}>{children}</p>
}

const Code = ({children}: {children: ReactNode}) => <code style={styles.code}>{children}</code>

/** `/caf%C3%A9` as `/café`, the way editors type it. */
function readable(address: string): string {
  try {
    return decodeURI(address)
  } catch {
    return address
  }
}

const text: CSSProperties = {margin: 0, fontSize: 14, lineHeight: 1.5}

const badge: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 3,
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 16,
    maxWidth: 640,
    color: 'var(--card-fg-color)',
  },
  stack: {display: 'flex', flexDirection: 'column', gap: 12},
  row: {display: 'flex', gap: 8},
  muted: {...text, color: 'var(--card-muted-fg-color)'},
  input: {
    flex: 1,
    minWidth: 0,
    font: 'inherit',
    fontSize: 14,
    padding: '7px 10px',
    borderRadius: 3,
    border: '1px solid var(--card-border-color)',
    background: 'var(--card-bg-color)',
    color: 'var(--card-fg-color)',
  },
  button: {
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    padding: '7px 14px',
    borderRadius: 3,
    border: '1px solid var(--card-border-color)',
    background: 'var(--card-bg-color)',
    color: 'var(--card-fg-color)',
    cursor: 'pointer',
  },
  checkbox: {...text, display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start'},
  // The Studio's base styles shrink a bare checkbox to nothing; this brings it back.
  box: {
    appearance: 'auto',
    display: 'inline-block',
    width: 16,
    height: 16,
    margin: 0,
    accentColor: 'var(--card-focus-ring-color)',
  },
  hops: {margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8},
  hop: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 12,
    borderRadius: 3,
    border: '1px solid var(--card-border-color)',
  },
  hopLine: {...text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
  code: {
    fontSize: 13,
    padding: '1px 4px',
    borderRadius: 3,
    background: 'var(--card-code-bg-color)',
    color: 'var(--card-code-fg-color)',
    overflowWrap: 'anywhere',
  },
  link: {color: 'inherit', textDecoration: 'underline'},
  note: {...text, padding: 12, borderRadius: 3},
  badge301: {
    ...badge,
    background: 'var(--card-badge-positive-bg-color)',
    color: 'var(--card-badge-positive-fg-color)',
  },
  badge302: {
    ...badge,
    background: 'var(--card-badge-caution-bg-color)',
    color: 'var(--card-badge-caution-fg-color)',
  },
} satisfies Record<string, CSSProperties>

const tones = {
  default: {background: 'var(--card-badge-default-bg-color)', color: 'var(--card-badge-default-fg-color)'},
  positive: {background: 'var(--card-badge-positive-bg-color)', color: 'var(--card-badge-positive-fg-color)'},
  caution: {background: 'var(--card-badge-caution-bg-color)', color: 'var(--card-badge-caution-fg-color)'},
  critical: {background: 'var(--card-badge-critical-bg-color)', color: 'var(--card-badge-critical-fg-color)'},
} satisfies Record<string, CSSProperties>
