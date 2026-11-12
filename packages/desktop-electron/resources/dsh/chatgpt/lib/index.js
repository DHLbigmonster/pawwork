import { credentialKey } from "@deepseek-ai/dsh-credentials"
import { Remote, bindTypertRemote } from "@deepseek-ai/dsh-typert-protocol"
import { createChatGptEngine } from "./engine.js"

export const name = "pawwork-chatgpt"
export const inject = ["authorization", "credentials"]

export class ChatGptService {
  constructor(engine) {
    this.engine = engine
    this.typertRemote = bindTypertRemote(this, "pawworkChatGpt")
  }
  status() { return this.engine.status() }
  start(method) { return this.engine.start(method) }
  answer(id, value) { return this.engine.answer(id, value) }
  cancel() { return this.engine.cancel() }
  signOut() { return this.engine.signOut() }
}

for (const name of ["status", "start", "answer", "cancel", "signOut"]) {
  Remote(ChatGptService.prototype[name], {
    kind: "method", name, static: false, private: false,
    addInitializer: (initialize) => initialize.call(Object.create(ChatGptService.prototype)),
  })
}

export function apply(ctx) {
  const engine = createChatGptEngine({
    authorization: ctx.authorization,
    credentials: ctx.credentials,
    key: credentialKey("llm-pi-ai", "openai-codex"),
  })
  ctx.provide("pawworkChatGpt", new ChatGptService(engine))
  ctx.effect(() => () => { void engine.cancel() }, "pawwork-chatgpt.login")
}
