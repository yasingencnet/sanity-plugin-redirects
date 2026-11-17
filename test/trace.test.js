import {test} from 'node:test'
import assert from 'node:assert/strict'

// The Studio test area's logic. Like match.test.js, run against dist.
import {currentRules, traceRedirects} from '../dist/trace.js'

const ends = (address, rules) => {
  const {hops, end} = traceRedirects(address, rules)
  return {path: hops.map((hop) => `${hop.from} ${hop.status} ${hop.to}`), end}
}

test('an address no rule matches has no hops', () => {
  assert.deepEqual(ends('/about', [{source: '/old', destination: '/new'}]), {path: [], end: 'stays'})
})

test('one hop names the rule behind it', () => {
  const rule = {source: '/old', destination: '/new', permanent: false}
  const {hops, end} = traceRedirects('/old', [rule])
  assert.equal(end, 'stays')
  assert.deepEqual(hops, [{from: '/old', to: '/new', status: 302, rule}])
})

test('a chain is followed hop by hop, query and all', () => {
  const rules = [
    {source: '/a', destination: '/b'},
    {source: '/b', destination: '/c'},
  ]
  assert.deepEqual(ends('/a?x=1', rules), {path: ['/a?x=1 301 /b?x=1', '/b?x=1 301 /c?x=1'], end: 'stays'})
})

test('a circle is caught', () => {
  const rules = [
    {source: '/a', destination: '/b'},
    {source: '/B/', destination: '/a'},
  ]
  assert.deepEqual(ends('/a', rules), {path: ['/a 301 /b', '/b 301 /a'], end: 'loops'})
})

test('leaving the site ends the trace', () => {
  const rules = [
    {source: '/a', destination: '/b'},
    {source: '/b', destination: 'https://example.org/x'},
  ]
  assert.deepEqual(ends('/a', rules), {
    path: ['/a 301 /b', '/b 301 https://example.org/x'],
    end: 'leaves',
  })
})

test('a folder rule feeding itself stops at the limit', () => {
  const {hops, end} = traceRedirects('/x', [{source: '/*', destination: '/archive/*'}])
  assert.equal(end, 'endless')
  assert.equal(hops.length, 10)
  assert.equal(hops[1].to, '/archive/archive/x')
})

test('an address can be typed without its slash, or as a full URL', () => {
  const rules = [{source: '/old', destination: '/new'}]
  assert.deepEqual(ends('old', rules).path, ['/old 301 /new'])
  assert.equal(traceRedirects('Café-menu/?utm=x', []).start, '/Caf%C3%A9-menu/?utm=x')
  assert.deepEqual(ends(' https://site.example/old?a=1 ', rules).path, ['/old?a=1 301 /new?a=1'])
})

const documents = [
  {_id: 'one', source: '/one', destination: '/published'},
  {_id: 'drafts.one', source: '/one', destination: '/draft'},
  {_id: 'two', source: '/two', destination: '/two-new'},
  {_id: 'drafts.two', source: '/two', destination: '/two-new', enabled: false},
  {_id: 'drafts.three', source: '/three', destination: '/three-new'},
  {_id: 'off', source: '/off', destination: '/x', enabled: false},
  {_id: 'versions.r1.one', source: '/one', destination: '/release'},
]

test('published rules only, unless asked for unpublished changes', () => {
  assert.deepEqual(
    currentRules(documents, false).map((rule) => `${rule._id} ${rule.destination}`),
    ['one /published', 'two /two-new'],
  )
})

test('unpublished changes replace, switch off and add rules, under the published id', () => {
  assert.deepEqual(
    currentRules(documents, true).map((rule) => `${rule._id} ${rule.destination}`),
    ['one /draft', 'three /three-new'],
  )
})
