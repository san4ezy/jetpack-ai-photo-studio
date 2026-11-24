import { JetPackAppClient } from '@jetpack/client';
import type { JetPackOpcodeMap } from './jetpack-env';

export async function runStarterDemo(): Promise<Uint8Array> {
  const client = new JetPackAppClient<JetPackOpcodeMap>();
  await client.connectAndEnsureApp({
    appId: 'dev.codingbro.ai-photo-studio',
    daemonPort: 9470,
  });

  try {
    const payload = new TextEncoder().encode('hello-jetpack');
    const reply = await client.request('worker.echo', {}, payload);
    return reply.payload;
  } finally {
    client.close();
  }
}
