// Return only allowlisted diagnostics. OAuth exception messages may contain
// authorization codes, access tokens, refresh tokens or entire response bodies.
export function loginFailureCode(error) {
  const messages = []
  const codes = []
  const seen = new Set()
  for (let current = error; current && !seen.has(current) && seen.size < 8; current = current.cause) {
    seen.add(current)
    if (typeof current.message === "string") messages.push(current.message)
    if (typeof current.code === "string") codes.push(current.code)
  }
  const message = messages.join("\n")
  const http = /OpenAI Codex token (?:exchange|refresh) failed \(([1-5]\d{2})\)/.exec(message)
  if (http) return `TOKEN_HTTP_${http[1]}`
  if (/Failed to extract accountId/.test(message)) return "ACCOUNT_ID_MISSING"
  if (/token .*response missing fields/.test(message)) return "TOKEN_RESPONSE_INVALID"
  if (codes.some(code => (/CERT|TLS|SSL/.test(code) || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"))) return "NETWORK_TLS"
  if (codes.some(code => ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) || /fetch failed/i.test(message)) return "NETWORK_CONNECTION"
  if (codes.includes("NOT_COMMITTED") || codes.includes("NO_CREDENTIAL_STORE") || /credential store|file lock|EACCES|EROFS|ENOSPC/i.test(message)) return "CREDENTIAL_STORE"
  if (/state mismatch|Missing authorization code/i.test(message)) return "CALLBACK_INVALID"
  if (codes.includes("NO_FLOW")) return "LOGIN_UNAVAILABLE"
  return "UNKNOWN"
}
