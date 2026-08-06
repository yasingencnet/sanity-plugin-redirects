import {test} from 'node:test'
import assert from 'node:assert/strict'

// Deliberately imported from dist, not src: these assert what consumers get,
// including that the entry point resolves in plain Node with no bundler.
import {matchRedirect, fetchRedirects, REDIRECT_TYPE, REDIRECTS_QUERY} from '../dist/match.js'

const rules = [
  {source: '/board.shtml', destination: '/leadership', permanent: true},
  {source: '/temp-appeal', destination: '/donate-online', permanent: false},
  {source: '/old-news/*', destination: '/news/*'},
  {source: '/old-news/annual/*', destination: '/newsletters'},
  {source: '/gone/*', destination: '/'},
  {source: '/external', destination: 'https://example.org/page'},
  {source: '/loop', destination: '/loop'},
  {source: '/LOOP2/', destination: '/loop2'},
  {source: undefined, destination: '/x'},
  {source: '/no-dest', destination: '   '},
]

const hit = (path, search = '') => matchRedirect(path, search, rules)

test('exact source redirects with 301', () => {
  assert.deepEqual(hit('/board.shtml'), {location: '/leadership', status: 301})
})

test('matching ignores letter case', () => {
  assert.deepEqual(hit('/Board.SHTML'), {location: '/leadership', status: 301})
})

test('matching ignores a trailing slash', () => {
  assert.deepEqual(hit('/board.shtml/'), {location: '/leadership', status: 301})
})

test('the query string survives the hop', () => {
  assert.deepEqual(hit('/board.shtml', '?utm_source=fb'), {
    location: '/leadership?utm_source=fb',
    status: 301,
  })
})

test('permanent:false yields a 302', () => {
  assert.deepEqual(hit('/temp-appeal'), {location: '/donate-online', status: 302})
})

test('a folder rule carries the suffix across', () => {
  assert.deepEqual(hit('/old-news/2019/gala'), {location: '/news/2019/gala', status: 301})
})

test('a folder rule also matches its bare prefix', () => {
  assert.deepEqual(hit('/old-news'), {location: '/news', status: 301})
})

test('the longest matching folder rule wins', () => {
  assert.deepEqual(hit('/old-news/annual/2020'), {location: '/newsletters', status: 301})
})

test('a destination without /* drops the suffix', () => {
  assert.deepEqual(hit('/gone/deep/page'), {location: '/', status: 301})
})

test('an absolute destination is passed through', () => {
  assert.deepEqual(hit('/external'), {location: 'https://example.org/page', status: 301})
})

test('a rule pointing at its own source is ignored', () => {
  assert.equal(hit('/loop'), null)
  assert.equal(hit('/loop2'), null)
})

test('a folder prefix only matches at a / boundary', () => {
  assert.equal(hit('/old-newsletter'), null)
})

test('rules missing a source or destination are skipped', () => {
  assert.equal(hit('/no-dest'), null)
})

test('an unmatched path yields null', () => {
  assert.equal(hit('/leadership'), null)
  assert.equal(hit('/'), null)
})

test('an empty rule set is harmless', () => {
  assert.equal(matchRedirect('/anything', '', []), null)
})

test('fetchRedirects yields [] rather than throwing without a projectId', async () => {
  assert.deepEqual(await fetchRedirects({projectId: ''}), [])
})

test('fetchRedirects yields [] when the API is unreachable', async () => {
  const rules = await fetchRedirects({projectId: 'this-project-does-not-exist-xyz'})
  assert.deepEqual(rules, [])
})

test('the exported query targets the exported type', () => {
  assert.equal(REDIRECT_TYPE, 'redirect')
  assert.match(REDIRECTS_QUERY, /_type == "redirect"/)
  assert.match(REDIRECTS_QUERY, /enabled != false/)
})
