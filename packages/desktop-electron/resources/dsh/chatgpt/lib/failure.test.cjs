const { test } = require('node:test')
const assert = require('node:assert/strict')

test('nested failures expose only an allowlisted category, never token responses', async () => {
  const { loginFailureCode } = await import('./failure.js')
  const examples = [
    [new Error('OpenAI Codex token exchange failed (403): secret-token'), 'TOKEN_HTTP_403'],
    [new Error('fetch failed', { cause: Object.assign(new Error('secret'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) }), 'NETWORK_TLS'],
    [new Error('fetch failed', { cause: Object.assign(new Error('secret'), { code: 'CERT_HAS_EXPIRED' }) }), 'NETWORK_TLS'],
    [new Error('credential store failed: secret'), 'CREDENTIAL_STORE'],
    [new Error('Failed to extract accountId from token: secret'), 'ACCOUNT_ID_MISSING'],
    [new Error('OpenAI Codex token exchange response missing fields: secret'), 'TOKEN_RESPONSE_INVALID'],
    [new Error('unknown secret'), 'UNKNOWN'],
  ]
  for (const [error, expected] of examples) {
    assert.equal(loginFailureCode(new Error('wrapper', { cause: error })), expected)
  }
})
