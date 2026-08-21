import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveApiBase } from '../src/api/base.ts'

/**
 * VITE_API_URL arrives in three shapes depending on how the app is deployed,
 * and one of them once got a scheme glued onto the front of it — which put
 * "https:///api" in front of every user of the AWS build.
 */
test('a path is left alone: the API is behind the same web server', () => {
  assert.equal(resolveApiBase('/api'), '/api')
  assert.equal(resolveApiBase('/api/'), '/api')
})

test('a bare hostname gets a scheme: platforms link services by host', () => {
  assert.equal(resolveApiBase('spice-api.onrender.com'), 'https://spice-api.onrender.com')
})

test('a full URL is used as given', () => {
  assert.equal(resolveApiBase('https://api.example.com'), 'https://api.example.com')
  assert.equal(resolveApiBase('http://localhost:3000'), 'http://localhost:3000')
})

test('nothing configured means the developer machine', () => {
  assert.equal(resolveApiBase(undefined), 'http://localhost:3000')
  assert.equal(resolveApiBase(''), 'http://localhost:3000')
})

test('no result ever has an empty authority', () => {
  for (const input of ['/api', 'host.example', 'https://x.example', undefined, '']) {
    assert.ok(!resolveApiBase(input).includes(':///'), `"${input}" produced a triple slash`)
  }
})
