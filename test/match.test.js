import {test} from 'node:test'
import assert from 'node:assert/strict'

// Deliberately imported from dist, not src: these assert what consumers get,
// including that the entry point resolves in plain Node with no bundler.
import {
  matchRedirect,
  redirectResponse,
  fetchRedirects,
  REDIRECT_TYPE,
  REDIRECTS_QUERY,
} from '../dist/match.js'

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

test('a folder rule keeps the letter case of what it carries across', () => {
  assert.deepEqual(hit('/old-news/Annual-Report.PDF'), {
    location: '/news/Annual-Report.PDF',
    status: 301,
  })
  assert.deepEqual(hit('/OLD-NEWS/2019/Gala'), {location: '/news/2019/Gala', status: 301})
})

const accents = [
  {source: '/café', destination: '/cafe'},
  {source: '/na%c3%afve', destination: '/naive'},
  {source: '/menü/*', destination: '/menu/*'},
  {source: '/old-shop', destination: '/boutique-été'},
]

test('an accented source matches the encoded address browsers send', () => {
  assert.deepEqual(matchRedirect('/caf%C3%A9', '', accents), {location: '/cafe', status: 301})
  assert.deepEqual(matchRedirect('/na%C3%AFve', '', accents), {location: '/naive', status: 301})
})

test('an accented suffix and destination come out encoded', () => {
  assert.deepEqual(matchRedirect('/men%C3%BC/K%C3%A4se', '', accents), {
    location: '/menu/K%C3%A4se',
    status: 301,
  })
  assert.deepEqual(matchRedirect('/old-shop', '', accents), {
    location: '/boutique-%C3%A9t%C3%A9',
    status: 301,
  })
})

test('a malformed escape is harmless', () => {
  assert.equal(matchRedirect('/%E0%A4%A', '', accents), null)
})

test('a /* rule moves the whole site, path and all', () => {
  const site = [{source: '/*', destination: 'https://new.example/*'}]
  assert.deepEqual(matchRedirect('/about/team', '?a=1', site), {
    location: 'https://new.example/about/team?a=1',
    status: 301,
  })
  assert.deepEqual(matchRedirect('/', '', site), {location: 'https://new.example/', status: 301})
})

test('a /* rule loses to a longer folder rule', () => {
  const folders = [
    {source: '/*', destination: '/archive/*'},
    {source: '/blog/*', destination: '/news/*'},
  ]
  assert.deepEqual(matchRedirect('/old/page', '', folders), {location: '/archive/old/page', status: 301})
  assert.deepEqual(matchRedirect('/blog/post', '', folders), {location: '/news/post', status: 301})
})

const shop = [
  {source: '/promo', destination: 'https://shop.example/p?ref=promo'},
  {source: '/buy', destination: 'https://shop.example/p#buy'},
  {source: '/both', destination: 'https://shop.example/p?ref=1#buy'},
]

test("the visitor's query joins one the destination already has", () => {
  assert.deepEqual(matchRedirect('/promo', '?utm_source=x', shop), {
    location: 'https://shop.example/p?ref=promo&utm_source=x',
    status: 301,
  })
  assert.deepEqual(matchRedirect('/promo', '', shop), {
    location: 'https://shop.example/p?ref=promo',
    status: 301,
  })
})

test("the visitor's query goes before the destination's #fragment", () => {
  assert.deepEqual(matchRedirect('/buy', '?utm_source=x', shop), {
    location: 'https://shop.example/p?utm_source=x#buy',
    status: 301,
  })
  assert.deepEqual(matchRedirect('/both', '?u=2', shop), {
    location: 'https://shop.example/p?ref=1&u=2#buy',
    status: 301,
  })
})

const visit = (path, init) => new Request('https://site.example' + path, init)

test('redirectResponse answers with an absolute Location', () => {
  const response = redirectResponse(visit('/board.shtml?utm_source=fb'), rules)
  assert.equal(response.status, 301)
  assert.equal(response.headers.get('Location'), 'https://site.example/leadership?utm_source=fb')
  assert.equal(response.body, null)
})

test('redirectResponse passes an off-site destination through', () => {
  const response = redirectResponse(visit('/external'), rules)
  assert.equal(response.headers.get('Location'), 'https://example.org/page')
})

test('redirectResponse lets browsers remember a 301 for an hour, or as told', () => {
  assert.equal(redirectResponse(visit('/board.shtml'), rules).headers.get('Cache-Control'), 'max-age=3600')
  const shorter = redirectResponse(visit('/board.shtml'), rules, {maxAge: 60})
  assert.equal(shorter.headers.get('Cache-Control'), 'max-age=60')
})

test('redirectResponse never lets a 302 be remembered', () => {
  const response = redirectResponse(visit('/temp-appeal'), rules)
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('redirectResponse only redirects GET and HEAD', () => {
  assert.equal(redirectResponse(visit('/board.shtml', {method: 'HEAD'}), rules).status, 301)
  assert.equal(redirectResponse(visit('/board.shtml', {method: 'POST', body: 'x'}), rules), null)
})

test('redirectResponse yields null when no rule applies', () => {
  assert.equal(redirectResponse(visit('/leadership'), rules), null)
})

test("redirectResponse's headers can be changed afterwards", () => {
  const response = redirectResponse(visit('/board.shtml'), rules)
  response.headers.set('X-Robots-Tag', 'noindex')
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex')
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
