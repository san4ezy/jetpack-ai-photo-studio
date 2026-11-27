---
name: add-binary-opcode
description: Add a typed request/response or streaming binary opcode across worker.py, jetpack codegen, and @jetpack-desktop/client.
---

# Add a Binary Opcode with Type Contract Parity

1. **Define Request/Response Models in `worker.py`**:
   ```python
   from pydantic import BaseModel

   class ProcessMeta(BaseModel):
       quality: int = 85

   class ProcessResult(BaseModel):
       width: int
       height: int
   ```

2. **Register or Handle the Opcode in `worker.py`**:
   - Echo `channel_id` and `correlation_id` on replies so `JetPackAppClient.request()` resolves the matching `Promise`.
   - Pass raw binary bytes directly as `payload=output_bytes` (zero JSON/base64 overhead).
   - Example decorator recognized by `jetpack codegen`:
     ```python
     @opcode("image.resize", request=ProcessMeta, response=ProcessResult, binary=True)
     def handle_resize(client: JetPackClient, frame: HybridFrame) -> None:
         ...
     ```

3. **Regenerate TypeScript Contracts**:
   ```bash
   jetpack codegen --worker worker.py --out src/jetpack-env.d.ts
   ```

4. **Call from `@jetpack-desktop/client`**:
   ```ts
   import { JetPackAppClient } from '@jetpack-desktop/client';
   import type { JetPackOpcodeMap } from './jetpack-env';

   const client = new JetPackAppClient<JetPackOpcodeMap>();
   const res = await client.request('image.resize', { quality: 90 }, imageBytes);
   ```
   Run `npx tsc --noEmit` to confirm compile-time opcode, metadata, and binary payload parity.
