# JetPack Worker Agent Instructions (dev.codingbro.ai-photo-studio)

Read this file before editing any code in this repository.

## Mandatory Architectural Invariants

1. **Always Connect via `JetPackAppClient.connectAndEnsureApp()`**:
   - In browser/frontend TypeScript code, ALWAYS initialize connections using `JetPackAppClient` from `@jetpack-desktop/client` (`await client.connectAndEnsureApp({ appId: "dev.codingbro.ai-photo-studio", daemonPort: 9470 })`).
   - NEVER open raw `WebSocket` connections directly to Python workers or bypass `jetpack://pair` Out-of-Band pairing. `jetpack-daemon` (`127.0.0.1:9470`) is the sole authenticated gatekeeper.

2. **Strict Separation of MsgPack Metadata & Zero-Copy Binary Payloads**:
   - Use `client.request(opcode, meta, binaryPayload)` where `meta` is a structured object (serialized as MsgPack by `@jetpack-desktop/client`'s bundled WASM engine) and `binaryPayload` is a raw `Uint8Array` transferred zero-copy.
   - NEVER JSON-stringify binary buffers (`base64`, `Array.from(bytes)`) inside `meta`, and NEVER send raw JSON over WebSockets.

3. **Frontend-to-Worker Opcode Parity & Type Codegen**:
   - Every `opcode` called via `client.request(...)` or subscribed via `client.onStream(...)` MUST have an exact matching handler in `worker.py`.
   - After changing Python worker opcodes or Pydantic request/response models, run:
     ```bash
     jetpack codegen --worker worker.py --out src/jetpack-env.d.ts
     ```
   - Parameterize `new JetPackAppClient<JetPackOpcodeMap>()` so `tsc --noEmit` catches mismatched opcodes, invalid metadata fields, or missing `Uint8Array` payloads at compile time.

4. **Strict `app.toml` Constraints**:
   - `app.toml` is parsed with `#[serde(deny_unknown_fields)]` — do NOT invent undocumented keys.
   - Local developer builds MUST use a non-official `package.id` (`com.dev.<slug>`, never `io.jetpack.*`).
   - Keep `[permissions]` default-deny (`filesystem_scopes = []`, `network_allowlist = []`, `gpu_access = false` unless required).
   - Host folder access belongs in `[volumes.<name>]` (`mode = "read-only"` or `"read-write"`) — never hardcode host paths in `app.toml`.
   - Never create symlinks inside the worker directory (rejected by OCI packaging and unprivileged Windows environments).

5. **Validation & Local Testing Workflow**:
   - Validate manifest before running: `jetpack validate app.toml` (or MCP tool `validate_manifest`).
   - Install locally into `jetpack-daemon`: `jetpack-daemon --install-local-app .`
   - Diagnose worker crashes via MCP `read_worker_logs(app_id="dev.codingbro.ai-photo-studio", lines=100)` or `get_daemon_status()`.
