# AGENTS.md — workers-auth

OAuth-2.0-with-PKCE flow against Cloudflare's `dash.cloudflare.com` (or staging /
custom-overridden) endpoints. Used by wrangler and (in future) other Cloudflare
CLIs. Internal-only — published as `prerelease: true`.

## STRUCTURE

- `src/pkce.ts` — PKCE code-verifier / code-challenge generation (RFC 7636)
- `src/errors.ts` — `ErrorOAuth2` class hierarchy + `toErrorClass` mapper
- `src/generate-auth-url.ts` — authorize URL builder + `OAUTH_CALLBACK_URL`
- `src/generate-random-state.ts` — CSRF state generator
- `src/env-vars.ts` — `WRANGLER_*` and `CLOUDFLARE_AUTH_*` env-var getters
- `src/access.ts` — Cloudflare Access detection + service-token / `cloudflared` headers
- `src/auth-config-file.ts` — `writeAuthConfigFile` / `readAuthConfigFile` / `deleteAuthConfig` free functions that delegate to the active `CredentialStore`
- `src/state.ts` — `readStoredAuthState()` + `StoredAuthState` shape
- `src/token-exchange.ts` — auth-code → token + refresh-token rotation + `fetchAuthToken`
- `src/callback-server.ts` — local HTTP server on `localhost:8976` for the OAuth callback
- `src/flow.ts` — `createOAuthFlow(ctx)` factory wiring everything together
- `src/context.ts` — `OAuthFlowContext` + `CredentialStorageContext` interfaces (DI surface)
- `src/credential-store/` — credential persistence layer (see below)
- `src/test-helpers/` — MSW handlers for consumers' tests (`@cloudflare/workers-auth/test-helpers`)

### Credential storage (`src/credential-store/`)

Pluggable credential persistence layer. Default backend is the legacy
plaintext TOML file (`FileCredentialStore`); an opt-in
`EncryptedFileCredentialStore` writes AES-256-GCM-encrypted credentials
to a sibling `.enc` file using a key held in the OS keyring.

- `interface.ts` — `CredentialStore` interface
- `file-store.ts` — `FileCredentialStore` (plaintext TOML, default)
- `encrypted-file-store.ts` — `EncryptedFileCredentialStore` + legacy-TOML migration
- `crypto.ts` — AES-256-GCM `encryptString` / `decryptString` helpers
- `resolver.ts` — `getActiveCredentialStore()` picks the store based on env var + consumer preference
- `state.ts` — module-level credential-storage config installed by `createOAuthFlow`
- `key-providers/` — per-platform OS-keyring backends that store only the 32-byte encryption key (never the credential blob itself, so the macOS Keychain 2.5 KB item limit is never a concern):
  - `interface.ts` — `KeyProvider` interface
  - `mac-security.ts` — `/usr/bin/security` shell-out
  - `linux-secret-tool.ts` — `secret-tool` shell-out (probes `libsecret-tools`)
  - `napi-keyring.ts` — `@napi-rs/keyring` wincred binding on Windows
  - `lazy-installer.ts` — Windows-only `npm install @napi-rs/keyring` on first opt-in
  - `factory.ts` — `resolveKeyProvider(serviceName)` picks the right per-platform implementation
  - `shared.ts` — account-name derivation + keyring JSON envelope encoding

## DI SURFACE

`createOAuthFlow(ctx)` accepts a context object:

- `logger` — drop-in replacement for wrangler's logger singleton
- `isNonInteractiveOrCI()` — whether to suppress interactive prompts
- `openInBrowser(url)` — opens the browser to the OAuth authorize URL
- `hasEnvCredentials()` — short-circuits refresh logic when env-based auth is set
- `purgeOnLoginOrLogout()` — invalidate consumer-side caches after login/logout
- `generateAuthUrl?` / `generateRandomState?` — test overrides for deterministic
  snapshot tests (defaults pull from `./generate-auth-url` / `./generate-random-state`)
- `credentialStorage` — REQUIRED. Configures the credential persistence layer:
  - `serviceName` — keyring service identifier (e.g. `"wrangler"`); becomes the
    `-s` arg to `security`, `service` attribute for `secret-tool`, and `service`
    arg to `@napi-rs/keyring`'s `Entry`. Must be non-empty.
  - `isKeyringEnabled()` — whether the consumer has opted into keyring storage.
    Consulted on every credential read/write so runtime preference changes
    take effect.
  - `cliName?` — consumer's CLI name for error-message templating (e.g.
    `"wrangler"`). Defaults to `"your CLI"`.

`createOAuthFlow` returns an `OAuthFlowAPI` that includes `getCredentialStore()`
for `whoami`-style code that wants to report the active storage location.

Wrangler wires all of this once in `packages/wrangler/src/user/user.ts`.

## CONVENTIONS

- License: dual MIT/Apache-2.0. Files derived from
  [BitySA/oauth2-auth-code-pkce](https://github.com/BitySA/oauth2-auth-code-pkce)
  carry the Apache-2.0 header.
- No `console.*` — use the injected `ctx.logger`.
- No global `fetch` — use undici's `fetch`.
- `UserError` instances must carry stable `telemetryMessage` labels
  (`<area> <sub-area> <failure>`, e.g. `user oauth invalid scope`).
  These labels are part of the telemetry contract — preserve them verbatim.
- No direct Cloudflare REST API calls. This package talks to OAuth endpoints
  (`/oauth2/auth`, `/oauth2/token`, `/oauth2/revoke`) only.
- OAuth callback server listens on `localhost:8976` by default; override via
  `LoginProps.callbackHost` / `callbackPort` per-call.

## BUILD

- tsup: two entry points — `src/index.ts` and `src/test-helpers/index.ts`
- ESM-only output to `dist/`
- `@cloudflare/*`, `undici`, `msw`, and `vitest` are kept external

## CREDENTIAL STORAGE NOTES

- The encrypted file uses `AES-256-GCM` via `node:crypto` (no third-party
  crypto deps). The 12-byte IV is generated fresh per write; the 16-byte
  GCM auth tag is verified on every read.
- The keyring entry holds only a 32-byte AES key wrapped in a small JSON
  envelope (`{v, key, created}`). It's well under the macOS Keychain ~2.5 KB
  per-item limit no matter how the credential schema grows.
- `@napi-rs/keyring` (the Windows backend's native binding) is installed
  lazily on first opt-in via `npm install` into
  `<globalWranglerConfigPath>/native/keyring/`. Pinned to
  `PINNED_KEYRING_VERSION` so CI users running `npm install -g @napi-rs/keyring`
  by hand get the same version as the lazy-install path.
- The credential-storage configuration set by `createOAuthFlow` lives in
  module-level state (`src/credential-store/state.ts`). One process should
  call `createOAuthFlow` once; tests use `resetCredentialStorageState` and
  the per-component `set*Runner` / `setKeyProviderFactoryForTesting` seams
  to swap in stubs.
