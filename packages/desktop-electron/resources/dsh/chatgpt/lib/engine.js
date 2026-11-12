// The installed pi-ai adapter owns PKCE, callbacks, refresh and inference.
// This surface only bridges its authorization conversation; grants never leave
// the existing DSH credential service.
import { loginFailureCode } from "./failure.js"

export function createChatGptEngine({ authorization, credentials, key }) {
  let active
  let signingOut
  let state = { phase: "idle" }
  let sequence = 0

  async function status() {
    const record = await credentials.describeRecord(key)
    return { ...state, configured: record.configured, ...(signingOut ? { signingOut: true } : {}) }
  }

  async function cancel() {
    if (!active) return
    active.controller.abort()
    active.answer?.(undefined)
    await active.completion
  }

  async function start(method = "browser") {
    if (!["browser", "device_code"].includes(method)) throw new Error("Unknown login method")
    if (signingOut) throw new Error("ChatGPT sign-out is still running")
    if (active) throw new Error("A ChatGPT login is already running")
    const attempt = { controller: new AbortController() }
    active = attempt
    state = { phase: "pending" }
    const timer = setTimeout(() => attempt.controller.abort(), 15 * 60 * 1000)
    attempt.completion = authorization.begin({
      key,
      method: "oauth",
      signal: attempt.controller.signal,
      interaction: {
        notify(notice) {
          if (attempt.controller.signal.aborted) return
          // Only provider authorization URLs are ever offered to the browser.
          let url
          if (notice.url) {
            const parsed = new URL(notice.url)
            if (parsed.protocol !== "https:" || parsed.hostname !== "auth.openai.com" || parsed.username || parsed.password) {
              throw new Error("Unexpected authorization destination")
            }
            url = parsed.href
          }
          state = { ...state, notice: {
            message: notice.message,
            ...(url ? { url } : {}),
            ...(notice.code ? { code: notice.code } : {}),
          } }
        },
        prompt(prompt) {
          if (attempt.controller.signal.aborted) return Promise.resolve(undefined)
          if (prompt.kind === "select") {
            if (!prompt.options.some((option) => option.id === method)) throw new Error("Unsupported login choice")
            return Promise.resolve(method)
          }
          return new Promise((resolve) => {
            const id = ++sequence
            state = { ...state, prompt: { id, message: prompt.message } }
            const finish = (value) => {
              prompt.signal?.removeEventListener("abort", abort)
              attempt.controller.signal.removeEventListener("abort", abort)
              if (state.prompt?.id === id) { state = { ...state }; delete state.prompt }
              attempt.answer = undefined
              resolve(value)
            }
            const abort = () => finish(undefined)
            attempt.answer = finish
            prompt.signal?.addEventListener("abort", abort, { once: true })
            attempt.controller.signal.addEventListener("abort", abort, { once: true })
            if (prompt.signal?.aborted || attempt.controller.signal.aborted) abort()
          })
        },
      },
    }).then((result) => {
      state = { phase: result.status }
    }).catch((error) => {
      // OAuth errors can contain token responses. Do not send them to clients.
      state = { phase: "failed", error: "ChatGPT sign-in failed. Retry or use device code login.", errorCode: loginFailureCode(error) }
    }).finally(() => {
      clearTimeout(timer)
      attempt.answer?.(undefined)
      active = undefined
    })
    return status()
  }

  return {
    status, start, cancel,
    async answer(id, value) {
      if (!active?.answer || state.prompt?.id !== id) throw new Error("This login prompt has expired")
      if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid authorization response")
      const callback = new URL(value.trim())
      const expectedState = new URL(state.notice.url).searchParams.get("state")
      if (callback.origin !== "http://localhost:1455" || callback.pathname !== "/auth/callback" ||
          !expectedState || callback.searchParams.get("state") !== expectedState || !callback.searchParams.get("code")) {
        throw new Error("Paste the complete callback URL from this sign-in attempt")
      }
      active.answer(value)
      return status()
    },
    async signOut() {
      if (!signingOut) {
        // Reserve this lifecycle operation before yielding. Another window may
        // otherwise start a new login between cancel and deletion of the grant.
        signingOut = Promise.resolve().then(async () => {
          await cancel()
          await credentials.deleteRecord(key)
          state = { phase: "idle" }
        }).finally(() => { signingOut = undefined })
      }
      await signingOut
      return status()
    },
  }
}
