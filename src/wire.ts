import {
  JetPackAppClient,
  type AppPullProgress,
  type JetPackControlBarOptions,
} from '@jetpack-desktop/client';
import type { JetPackOpcodeMap } from './jetpack-env';

export * from './codec';

export const STUDIO_APP_ID = 'dev.codingbro.ai-photo-studio';

export interface DaemonEndpointConfig {
  daemonPort: number;
  wsUrl: string;
  controlCenterUrl: string;
}

export function resolveDaemonEndpoint(): DaemonEndpointConfig {
  if (typeof window === 'undefined') {
    return {
      daemonPort: 9470,
      wsUrl: 'ws://127.0.0.1:9470',
      controlCenterUrl: 'http://127.0.0.1:9470/#apps',
    };
  }
  const isLoopback =
    window.location.protocol === 'http:' &&
    (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
  const isViteDev = window.location.port === '5174' || window.location.port === '5173';
  const daemonPort = isLoopback && !isViteDev ? Number(window.location.port || 9470) : 9470;
  const host = isLoopback ? window.location.hostname : '127.0.0.1';
  return {
    daemonPort,
    wsUrl: `ws://${host}:${daemonPort}`,
    controlCenterUrl: `http://${host}:${daemonPort}/#apps`,
  };
}

export async function connectStudioClient(options: {
  isProcessing: () => boolean;
  onPairingUri?: (uri: string) => void;
  onProgress?: (progress: AppPullProgress) => void;
  onAfterStop?: () => Promise<void> | void;
}): Promise<JetPackAppClient<JetPackOpcodeMap>> {
  const endpoint = resolveDaemonEndpoint();
  const client = new JetPackAppClient<JetPackOpcodeMap>();

  const controlBar: JetPackControlBarOptions = {
    appId: STUDIO_APP_ID,
    appName: 'AI Photo Studio',
    controlCenterUrl: endpoint.controlCenterUrl,
    warnOnUnsavedWork: () => options.isProcessing(),
    stopConfirmTitle: 'Active Processing Job',
    stopConfirmMessage:
      'AI Photo Studio is currently processing images. Stopping the worker now may interrupt the active job.',
    onAfterStop: options.onAfterStop,
  };

  await client.connectAndEnsureApp({
    appId: STUDIO_APP_ID,
    daemonPort: endpoint.daemonPort,
    wsUrl: endpoint.wsUrl,
    controlBar,
    onPairingUri: options.onPairingUri,
    onProgress: options.onProgress,
  });

  return client;
}
