# ChatGPT / Codex sign-in

Open **Settings → ChatGPT / Codex** and choose browser or device-code login.
Authorize in the OpenAI page, then add **OpenAI Codex (legacy)** in **Models**
and select an available model in the conversation. Leave API key and Base URL
unset for this route. Existing DeepSeek settings and the default model are
unchanged. The route uses the subscription's Codex allowance, subject to the
account's entitlements and OpenAI limits; it does not create API credit.

Browser login uses the installed provider's PKCE flow and loopback callback on
`localhost:1455`. If the callback is not received, paste the **full callback URL**
into the settings page; PawWork checks its origin, path and state. Device-code
login is useful when the app runs on another machine. Enable device-code login
in the account's OpenAI settings if OpenAI requires it. The user must complete
authorization themselves; no password or token should be pasted into chat.

This plugin is a UI and RPC bridge over DSH's authorization service and the
already pinned pi-ai `openai-codex` provider. That provider implements OAuth,
token refresh and Codex Responses streaming. It is distinct from the `openai`
API-key provider. CodePilot's OAuth implementation was used as an architectural
reference; no CodePilot source is vendored here.

Grants are kept in DSH's existing local credential store under the model
adapter's `llm-pi-ai / openai-codex` record. They are not returned by the status
RPC, put in YAML model settings, or logged by this plugin. Protect the profile
and credential files as you would existing API credentials. Sign out cancels
pending login and deletes the local grant; it does not revoke other sessions.
An attempt expires after 15 minutes and can also be cancelled manually.

Required outbound services are `auth.openai.com` for sign-in/refresh and
`chatgpt.com` for the Codex provider. Environment or corporate policies must
permit these services. Use this integration only where those services are
approved. No traffic concealment or monitoring bypass is implemented.

Validation covers the real DSH gateway, authorization flow and credential store
with mocked OpenAI responses, plus cancellation and callback checks. A live
account login and inference need the user's account authorization and must be
verified on a supported desktop (macOS or Windows); passing these tests does
not prove an account's entitlement or quota.
