import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { LocalCredentialProvider } from "@deepseek-ai/dsh-credentials-local"
import { createChatGptEngine } from "../../resources/dsh/chatgpt/lib/engine.js"

const fromDesktop = createRequire(import.meta.url)
const fromDsh = createRequire(fromDesktop.resolve("@deepseek-ai/dsh/package.json"))
const fromWeb = createRequire(fromDsh.resolve("@deepseek-ai/dsh-web-app/package.json"))
const { Context } = await import(fromDsh.resolve("@deepseek-ai/cordis")) as any
const { AuthorizationService } = await import(fromDsh.resolve("@deepseek-ai/dsh-authorization")) as any

afterEach(() => vi.unstubAllGlobals())

// Delay entry to the underlying local credential transaction. The authorization
// seam settles cancellation before that provider operation finishes, so the
// adapter must recheck the login signal inside the eventual mutation. This also
// covers providers that await readiness before entering their own write queue.
test.each(["cancel", "signOut"] as const)("%s prevents a queued login from restoring its grant", async (action) => {
  const directory = mkdtempSync(join(tmpdir(), "pawwork-chatgpt-cancel-"))
  const ctx = new Context()
  const noop = () => {}
  ctx.provide("llm", {
    registerAdapter: () => ({ replace: noop }),
    registerConfigurableProviders: () => ({ replace: noop }),
    registerModelDiscovery: noop,
  })
  const accessToken = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.test`
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "https://auth.openai.com/api/accounts/deviceauth/usercode") return Response.json({ device_auth_id: "test-device", user_code: "TEST-CODE", interval: 1 })
    if (url === "https://auth.openai.com/api/accounts/deviceauth/token") return Response.json({ authorization_code: "test-code", code_verifier: "test-verifier" })
    if (url === "https://auth.openai.com/oauth/token") return Response.json({ access_token: accessToken, refresh_token: "test-refresh", expires_in: 3600 })
    throw new Error("Unexpected network request")
  })
  let releaseWrite!: () => void
  const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
  let enteredWrite!: () => void
  const writeEntered = new Promise<void>((resolve) => { enteredWrite = resolve })
  let settleWrite!: () => void
  const writeSettled = new Promise<void>((resolve) => { settleWrite = resolve })
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(directory, "credentials.yaml"), watch: false })
    await ctx.plugin(AuthorizationService)
    const adapter = await import(fromWeb.resolve("@deepseek-ai/dsh-llm-pi-ai"))
    await ctx.plugin(adapter as never, { providers: {} })
    const credentials = ctx.credentials
    const originalModify = credentials.modifyRecord.bind(credentials)
    credentials.modifyRecord = async (...args: unknown[]) => {
      enteredWrite()
      await writeGate
      try { return await originalModify(...args) }
      finally { settleWrite() }
    }
    const key = adapter.recordKeyFor("openai-codex")
    const engine = createChatGptEngine({ authorization: ctx.authorization, credentials, key })
    await engine.start("device_code")
    await writeEntered
    // Cancellation/sign-out can settle before a delayed provider operation.
    // The stale login is then allowed to reach its queued mutation; it must not
    // recreate the grant after the user has already been told they signed out.
    await engine[action]()
    releaseWrite()
    await writeSettled
    expect(await credentials.readRecord(key)).toBeUndefined()
    expect((await engine.status()).configured).toBe(false)
  } finally {
    releaseWrite()
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)
