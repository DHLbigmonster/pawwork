import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { LocalCredentialProvider } from "@deepseek-ai/dsh-credentials-local"

const fromDesktop = createRequire(import.meta.url)
const fromDsh = createRequire(fromDesktop.resolve("@deepseek-ai/dsh/package.json"))
const fromWeb = createRequire(fromDsh.resolve("@deepseek-ai/dsh-web-app/package.json"))
const load = (name: string) => import(fromDsh.resolve(name))
const { Context } = await load("@deepseek-ai/cordis") as any
const { AuthorizationService } = await load("@deepseek-ai/dsh-authorization") as any
const { TypertRegistry } = await load("@deepseek-ai/dsh-typert-registry") as any
const { TypertGatewayService } = await load("@deepseek-ai/dsh-api-gateway") as any
const { RemoteAccessService } = await load("@deepseek-ai/dsh-api-remote-access") as any

afterEach(() => vi.unstubAllGlobals())

test("device authorization through the real gateway stores a grant readable by the model adapter", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pawwork-chatgpt-test-"))
  const ctx = new Context()
  let api: any
  let modelAdapter: any
  const noop = () => {}
  ctx.provide("connection", { rpc: { intercept: (_channel: string, matches: any, dispatch: any) => {
    api = { matches, dispatch }; return noop
  } } })
  ctx.provide("llm", {
    registerAdapter: (_routes: string[], adapter: unknown) => { modelAdapter = adapter; return { replace: noop } },
    registerConfigurableProviders: () => ({ replace: noop }),
    registerModelDiscovery: noop,
  })
  const requests: string[] = []
  const tokenGrants: string[] = []
  const accessToken = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.test`
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    requests.push(input)
    expect(init.method).toBe("POST")
    if (input === "https://chatgpt.com/backend-api/codex/responses") {
      const headers = new Headers(init.headers)
      expect(headers.get("authorization")).toBe(`Bearer ${accessToken}`)
      expect(headers.get("chatgpt-account-id")).toBe("test-account")
      const events = [
        { type: "response.created", response: { id: "test-response", status: "in_progress", output: [] } },
        { type: "response.completed", response: { id: "test-response", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } },
      ]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
    }
    if (input.endsWith("/deviceauth/usercode")) return Response.json({ device_auth_id: "test-device", user_code: "TEST-CODE", interval: 1 })
    if (input.endsWith("/deviceauth/token")) return Response.json({ authorization_code: "test-code", code_verifier: "test-verifier" })
    if (input.endsWith("/oauth/token")) {
      tokenGrants.push(new URLSearchParams(String(init.body)).get("grant_type")!)
      return Response.json({ access_token: accessToken, refresh_token: "test-refresh", expires_in: 3600 })
    }
    throw new Error("Unexpected network request")
  })
  try {
    await ctx.plugin(LocalCredentialProvider, { path: join(directory, "credentials.yaml"), watch: false })
    await ctx.plugin(AuthorizationService)
    const adapter = await import(fromWeb.resolve("@deepseek-ai/dsh-llm-pi-ai"))
    await ctx.plugin(adapter as never, { providers: { "openai-codex": { transport: "sse" } } })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(RemoteAccessService)
    await ctx.plugin(TypertGatewayService)
    const plugin = await import("../../resources/dsh/chatgpt/lib/index.js")
    await ctx.plugin(plugin as never)
    const peer = { principal: { kind: "owner" }, signal: new AbortController().signal }
    async function call(method: string, args: Record<string, unknown> = {}) {
      const result = await api.dispatch(`pawworkChatGpt/${method}`, { args }, peer.signal, peer)
      if (!result.ok) throw new Error(JSON.stringify(result.error))
      return result.value
    }
    expect(api.matches("pawworkChatGpt/status")).toBe(true)
    expect(api.matches("pawworkChatGpt/engine")).toBe(false)
    expect((await call("status")).configured).toBe(false)
    await call("start", { method: "device_code" })
    await expect.poll(async () => (await call("status")).phase).toBe("authorized")
    const status = await call("status")
    expect(status.configured).toBe(true)
    expect(JSON.stringify(status)).not.toContain(accessToken)
    expect(requests).toEqual([
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      "https://auth.openai.com/api/accounts/deviceauth/token",
      "https://auth.openai.com/oauth/token",
    ])
    const key = adapter.recordKeyFor("openai-codex")
    const record = await ctx.credentials.readRecord(key)
    expect(record.kind).toBe("grant")
    expect(record.payload).toMatchObject({ type: "oauth", access: accessToken, refresh: "test-refresh", accountId: "test-account" })
    const models = await modelAdapter.listModels("openai-codex")
    expect(models.length).toBeGreaterThan(0)
    const prepared = await modelAdapter.prepareCall("openai-codex", models[0].id)
    const chunks = []
    for await (const chunk of prepared.stream({ provider: "openai-codex", model: models[0].id, messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] })) chunks.push(chunk)
    expect(requests.at(-1)).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(chunks.length).toBeGreaterThan(0)
    await ctx.credentials.modifyRecord(key, async (current: any) => ({ ...current, payload: { ...current.payload, expires: 0 } }))
    for await (const chunk of prepared.stream({ provider: "openai-codex", model: models[0].id, messages: [] })) void chunk
    expect(tokenGrants).toEqual(["authorization_code", "refresh_token"])
    expect((await ctx.credentials.readRecord(key)).payload.expires).toBeGreaterThan(Date.now())
    await call("signOut")
    expect((await call("status")).configured).toBe(false)
    expect(await ctx.credentials.readRecord(key)).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)
