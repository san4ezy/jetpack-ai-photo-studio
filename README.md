# dev.codingbro.ai-photo-studio

Starter JetPack Python worker generated with `jetpack init` / `jetpack-daemon --init-app`.

## Quick Start

1. Validate the manifest:
   ```bash
   jetpack validate app.toml
   ```

2. Generate TypeScript opcode declarations (`JetPackOpcodeMap`):
   ```bash
   jetpack codegen --worker worker.py --out src/jetpack-env.d.ts
   ```

3. Install locally for development (unverified local-dev mode):
   ```bash
   jetpack-daemon --install-local-app .
   ```

4. Package into an OCI Image Layout bundle for distribution:
   ```bash
   jetpack-daemon --package-app . --out ./dist/my-worker-oci
   ```
