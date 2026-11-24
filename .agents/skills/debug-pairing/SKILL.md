---
name: debug-pairing
description: Diagnose jetpack://pair authentication, Origin/PNA rejections, and sandboxed worker startup crashes.
---

# Debug Pairing & Worker Crashes (dev.codingbro.ai-photo-studio)

1. **Check Local Daemon Health & Paired Origins**:
   - Call MCP tool `get_daemon_status()` (or run `jetpack-daemon --list-paired-clients`).
   - Confirm `jetpack-daemon` is reachable on `127.0.0.1:9470` and your frontend `Origin` (e.g. `http://127.0.0.1:5173`) is paired.

2. **Verify Local-Dev Origin Rules**:
   - Apps installed via `--install-local-app` run in unverified developer mode and only accept loopback origins (`http://127.0.0.1:*` or `http://localhost:*`).
   - Non-loopback origins fail with `ORIGIN_NOT_AUTHORIZED_FOR_APP`.

3. **Inspect Worker Logs & Crash Tracebacks**:
   - Call MCP tool `read_worker_logs(app_id="dev.codingbro.ai-photo-studio", lines=100)` to inspect `stdout`, `stderr`, Python `Traceback`s, and daemon sandbox logs (secrets are automatically redacted).
   - If the worker failed during `uv sync` or Python startup, verify `[python_env]` dependencies in `app.toml` via `validate_manifest`.
