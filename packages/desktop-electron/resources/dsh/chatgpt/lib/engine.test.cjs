const { test } = require('node:test')
const assert = require('node:assert/strict')

async function fixture(run) {
  const { createChatGptEngine } = await import('./engine.js')
  let configured = false
  const credentials = {
    describeRecord: async () => ({ configured }),
    deleteRecord: async () => { configured = false },
  }
  const engine = createChatGptEngine({
    key: 'test-key', credentials,
    authorization: { async begin(request) {
      return run(request, () => { configured = true })
    } },
  })
  return engine
}

async function until(check) {
  for (let n = 0; n < 100; n++) {
    const result = await check()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('Timed out')
}

test('device login chooses device code, keeps tokens private and signs out', async () => {
  const engine = await fixture(async ({ interaction }, commit) => {
    assert.equal(await interaction.prompt({ kind: 'select', options: [{ id: 'device_code' }] }), 'device_code')
    interaction.notify({ message: 'Authorize', url: 'https://auth.openai.com/codex/device', code: 'ABCD' })
    commit()
    return { status: 'authorized' }
  })
  await engine.start('device_code')
  await until(async () => (await engine.status()).phase === 'authorized')
  assert.deepEqual(await engine.status(), { phase: 'authorized', configured: true })
  await engine.signOut()
  assert.deepEqual(await engine.status(), { phase: 'idle', configured: false })
})

test('manual callback validates origin, state and stale prompt ids', async () => {
  const engine = await fixture(async ({ interaction }, commit) => {
    interaction.notify({ message: 'Authorize', url: 'https://auth.openai.com/oauth/authorize?state=expected' })
    const answer = await interaction.prompt({ kind: 'text', message: 'Callback' })
    assert.match(answer, /code=abc/)
    commit()
    return { status: 'authorized' }
  })
  await engine.start()
  const { prompt } = await engine.status()
  await assert.rejects(engine.start(), /already running/)
  await assert.rejects(engine.answer(prompt.id + 1, 'abc'), /expired/)
  await assert.rejects(engine.answer(prompt.id, 'http://localhost:1455/auth/callback?code=abc&state=wrong'), /complete callback/)
  await assert.rejects(engine.answer(prompt.id, 'https://evil.example/auth/callback?code=abc&state=expected'), /complete callback/)
  await engine.answer(prompt.id, 'http://localhost:1455/auth/callback?code=abc&state=expected')
  await until(async () => (await engine.status()).configured)
})

test('cancellation withdraws prompts, allows retry, and never leaves a grant', async () => {
  const engine = await fixture(async ({ signal, interaction }) => {
    await interaction.prompt({ kind: 'text', message: 'Callback', signal })
    return { status: 'cancelled' }
  })
  await engine.start()
  const { prompt } = await engine.status()
  await engine.cancel()
  assert.equal((await engine.status()).configured, false)
  await assert.rejects(engine.answer(prompt.id, 'abc'), /expired/)
  await engine.start()
  await engine.signOut()
  assert.deepEqual(await engine.status(), { phase: 'idle', configured: false })
})

test('upstream failures do not leak credentials, and unsupported methods fail', async () => {
  const engine = await fixture(async () => { throw new Error('secret-access-token') })
  await assert.rejects(engine.start('unsupported'), /Unknown/)
  await engine.start()
  await until(async () => (await engine.status()).phase === 'failed')
  assert.doesNotMatch(JSON.stringify(await engine.status()), /secret-access-token/)
})

test('sign out reserves the lifecycle until credential deletion completes', async () => {
  const { createChatGptEngine } = await import('./engine.js')
  let release
  let deletions = 0
  const engine = createChatGptEngine({
    key: 'test-key', authorization: { begin: async () => ({ status: 'authorized' }) },
    credentials: {
      describeRecord: async () => ({ configured: false }),
      deleteRecord: async () => { deletions++; await new Promise(resolve => { release = resolve }) },
    },
  })
  const first = engine.signOut()
  const second = engine.signOut()
  await until(() => release)
  assert.equal((await engine.status()).signingOut, true)
  await assert.rejects(engine.start(), /sign-out is still running/)
  release()
  await Promise.all([first, second])
  assert.equal(deletions, 1)
  assert.deepEqual(await engine.status(), { phase: 'idle', configured: false })
})
