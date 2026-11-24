---
name: create-jetpack-worker
description: Step-by-step workflow for configuring, validating, and locally installing a sandboxed JetPack Python worker (dev.codingbro.ai-photo-studio).
---

# Create & Verify a JetPack Worker

1. **Configure `app.toml`**:
   - Keep `package.id = "dev.codingbro.ai-photo-studio"` (non-official `com.dev.*` namespace).
   - Declare `[python_env]` (`python_version = "3.12"`, `requirements = ["jetpack-sdk"]`, `isolated = true`).
   - Declare only required `[permissions]` (`gpu_access`, `network_allowlist`) and user-directed `[volumes.<name>]` (`mode = "read-only" | "read-write"`).
   - Never add unknown fields (`#[serde(deny_unknown_fields)]` rejects them).

2. **Implement `worker.py`**:
   - Connect via `with JetPackClient() as client:`.
   - Read frames via `client.read_frame()` and reply via `client.send_frame(opcode=..., payload=..., channel_id=frame.channel_id, correlation_id=frame.correlation_id)`.
   - Handle `app.terminate` / `worker.stop` cleanly so graceful shutdown exits with code `0`.

3. **Validate & Install Locally**:
   ```bash
   jetpack validate app.toml
   jetpack-daemon --install-local-app .
   ```
   Or invoke the `validate_manifest` MCP tool on `app.toml`.

4. **Package for Distribution**:
   ```bash
   jetpack-daemon --package-app . --out ./dist/oci-bundle --oci-ref ghcr.io/your-org/worker:0.1.0
   ```
