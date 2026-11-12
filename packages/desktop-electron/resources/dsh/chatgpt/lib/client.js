window.__ModuleLoader__.load({
  id: "@pawwork/dsh-chatgpt",
  factory: (require) => {
    const { createElement: h, useEffect, useRef, useState } = require("react")
    const { Button } = require("@deepseek-ai/dsh-client-ui-primitives")
    const text = (zh, en) => document.documentElement.lang.startsWith("zh") ? zh : en

    function Surface({ connection }) {
      const [state, setState] = useState({ phase: "loading" })
      const [error, setError] = useState("")
      const [connectionError, setConnectionError] = useState("")
      const [answer, setAnswer] = useState("")
      const [busy, setBusy] = useState(false)
      const revision = useRef(0)
      const writing = useRef(false)
      const rpc = async (method, ...values) => {
        const args = method === "start" ? { method: values[0] }
          : method === "answer" ? { id: values[0], value: values[1] } : {}
        const result = await connection.rpc.call("/api", `pawworkChatGpt/${method}`, { args })
        if (!result.ok) throw new Error(text("操作失败，请重试。", "Operation failed. Please retry."))
        return result.value
      }
      useEffect(() => {
        let disposed = false
        let timer
        const poll = async () => {
          const observedRevision = revision.current
          try {
            const next = await rpc("status")
            if (!disposed && !writing.current && revision.current === observedRevision) {
              setState(next)
              setConnectionError("")
            }
          } catch {
            if (!disposed && !writing.current && revision.current === observedRevision) setConnectionError(text("无法读取登录状态。", "Could not read sign-in status."))
          } finally {
            if (!disposed) timer = setTimeout(poll, 1000)
          }
        }
        void poll()
        return () => { disposed = true; clearTimeout(timer) }
      }, [connection])
      useEffect(() => { setAnswer("") }, [state.prompt?.id])

      async function act(method, ...args) {
        if (writing.current) return
        writing.current = true
        revision.current += 1
        setBusy(true)
        setError("")
        try {
          await rpc(method, ...args)
          setState(await rpc("status"))
          setAnswer("")
        } catch {
          setError(text("操作失败，请重试。", "Operation failed. Please retry."))
        } finally {
          revision.current += 1
          writing.current = false
          setBusy(false)
        }
      }
      const pending = state.phase === "pending"
      const failureText = () => {
        const reasons = {
          NETWORK_CONNECTION: text("应用连接 OpenAI 授权服务失败。浏览器登录成功不代表应用能连接换取令牌的接口。", "The app could not connect to OpenAI's token service. Browser sign-in alone does not verify the app's connection."),
          NETWORK_TLS: text("应用与 OpenAI 的 TLS 证书校验失败。请检查系统时间和受信任证书配置。", "The app could not verify the TLS certificate. Check system time and trusted certificate configuration."),
          CREDENTIAL_STORE: text("授权未能写入本机凭据文件。请检查应用数据目录的写入权限和磁盘空间。", "The grant could not be saved. Check profile directory permissions and free disk space."),
          ACCOUNT_ID_MISSING: text("OpenAI 返回的令牌缺少 Codex 账户标识。此授权响应暂不兼容。", "The token lacks a Codex account identifier. This authorization response is not compatible."),
          TOKEN_RESPONSE_INVALID: text("OpenAI 返回的令牌格式与当前适配器不兼容。", "The token response is incompatible with the current adapter."),
          CALLBACK_INVALID: text("登录回调无效或与当前登录不匹配，请重新开始登录。", "The callback is invalid or belongs to a different attempt. Start a new login."),
          LOGIN_UNAVAILABLE: text("登录服务尚未准备好，请重启应用后重试。", "The login service is unavailable. Restart the app and retry."),
        }
        const code = state.errorCode
        if (/^TOKEN_HTTP_[1-5]\d{2}$/.test(code ?? "")) return text("浏览器回调已到达，但 OpenAI 令牌接口拒绝了请求，HTTP 状态：", "The callback arrived, but OpenAI's token endpoint rejected the request. HTTP status: ") + code.slice(-3)
        return reasons[code] ?? text("ChatGPT 登录失败，请重试或使用设备码登录。", "ChatGPT sign-in failed. Retry or use device code login.")
      }
      const link = state.notice?.url
      // Never turn a server-supplied string into an arbitrary external link.
      let safeLink
      try {
        const parsed = new URL(link)
        if (parsed.protocol === "https:" && parsed.hostname === "auth.openai.com" && !parsed.username && !parsed.password) safeLink = parsed.href
      } catch { /* no authorization link yet */ }
      return h("section", { style: { maxWidth: 720, display: "grid", gap: 12 } },
        h("h2", null, "ChatGPT / Codex"),
        h("p", null, text("使用 ChatGPT 账户授权 Codex，无需填写 API Key。可用模型、额度和使用限制由 OpenAI 及你的账户决定。", "Authorize Codex with your ChatGPT account, without an API key. Available models, limits and usage depend on OpenAI and your account.")),
        h("p", { role: "status" }, pending ? text("等待授权…", "Waiting for authorization…") : state.configured ? text("已保存账户授权", "Account authorization saved") : text("尚未登录", "Not signed in")),
        h("div", { style: { display: "flex", gap: 8 } },
          h(Button, { disabled: busy || state.signingOut || pending || state.phase === "loading", onClick: () => void act("start", "browser") }, text("通过浏览器登录", "Sign in with browser")),
          h(Button, { disabled: busy || state.signingOut || pending || state.phase === "loading", onClick: () => void act("start", "device_code") }, text("设备码登录", "Sign in with device code")),
          pending ? h(Button, { disabled: busy, onClick: () => void act("cancel") }, text("取消", "Cancel")) : null,
          state.configured ? h(Button, { disabled: busy, onClick: () => void act("signOut") }, text("退出登录", "Sign out")) : null),
        pending && safeLink ? h("a", { href: safeLink, target: "_blank", rel: "noopener noreferrer" }, text("打开 OpenAI 授权页面", "Open OpenAI authorization page")) : null,
        pending && state.notice?.code ? h("p", null, text("授权码：", "Authorization code: "), h("code", null, state.notice.code)) : null,
        pending && state.prompt ? h("form", { onSubmit: (event) => { event.preventDefault(); void act("answer", state.prompt.id, answer) } },
          h("label", null, text("若浏览器未自动完成，请粘贴回调页面的完整地址：", "If the browser did not complete sign-in, paste the full callback URL: "),
            h("input", { type: "password", value: answer, autoComplete: "off", onChange: (event) => setAnswer(event.target.value), style: { width: "100%" } })),
          h(Button, { type: "submit", disabled: busy || !answer.trim() }, text("完成登录", "Complete sign-in"))) : null,
        error || connectionError || state.error ? h("p", { role: "alert" }, error || connectionError || failureText()) : null,
        h("p", null, text("登录后，前往「模型」添加 openai-codex，选择其中可用的模型，然后在对话中切换。不要为此提供商填写 API Key 或自定义 Base URL。退出只删除本机授权，不会撤销其他设备的会话。", "After signing in, add openai-codex in Models, choose an available model, then select it in your conversation. Leave API key and custom Base URL unset for this provider. Sign out removes this device's stored grant; it does not revoke other sessions.")))
    }
    return {
      inject: ["slots", "connection"],
      apply(ctx) {
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section", id: "pawwork-chatgpt", order: 44,
          label: () => "ChatGPT / Codex",
        }, (props) => h(Surface, { ...props, connection: ctx.connection })))
      },
    }
  },
})
