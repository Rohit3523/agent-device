import type {
  AppleSessionObservation,
  AppleSessionObservationHost,
} from '@agent-device/contracts/apple-session-observation';

export function createAppleSessionObservation(
  host: AppleSessionObservationHost,
): AppleSessionObservation {
  return Object.freeze({
    async observeRunnerSession(deviceId) {
      const { getRunnerSessionSnapshot } = await import('./core/runner-client.ts');
      const snapshot = await getRunnerSessionSnapshot(deviceId);
      return snapshot ? { alive: snapshot.alive, sessionId: snapshot.sessionId } : undefined;
    },
    async resolveSoleForegroundApp(options = {}) {
      try {
        const booted = await host.listLocalDevices({
          platform: 'ios',
          iosSimulatorSetPath: options.simulatorSetPath,
          kind: 'simulator',
          booted: true,
        });
        if (booted.length !== 1) return undefined;
        const [device] = booted;
        if (!device) return undefined;

        const { detectSoleRunningIosSimulatorApp } = await import('./core/app-resolution.ts');
        const app = await detectSoleRunningIosSimulatorApp(device);
        return app ? { device, app: { bundleId: app.bundleId } } : undefined;
      } catch (error) {
        if (host.shouldPropagateProbeError(error)) throw error;
        return undefined;
      }
    },
  });
}
