import { afterEach, expect, test, vi } from 'vitest';
import type {
  CloseApplicationInput,
  LocalApplicationInteractorHost,
} from '@agent-device/contracts/application-lifecycle-runtime';
import type { PlatformRuntimeHost } from '@agent-device/contracts/platform-runtime-operations';
import type { Interactor } from '@agent-device/contracts/interactor-types';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { bindAndroidApplicationLifecycle } from './lifecycle.ts';
import { killAndroidApp } from './app-lifecycle.ts';

vi.mock('./app-lifecycle.ts', () => ({
  killAndroidApp: vi.fn(async () => {}),
}));

const mockKillAndroidApp = vi.mocked(killAndroidApp);

const device: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  target: 'mobile',
  booted: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  mockKillAndroidApp.mockClear();
});

test('preserves a runtime launch URL duration after the admitted Android follow-up open', async () => {
  const opens: string[] = [];
  const localInteractors: LocalApplicationInteractorHost = {
    resolve: async () =>
      ({
        open: async (app: string) => {
          opens.push(app);
        },
        openDevice: async () => {},
        close: async () => {},
        setSetting: async () => {},
      }) as unknown as Interactor,
  };
  const host = {
    localInteractors,
    deviceReadiness: {
      android: { ensureReady: async () => ({ ...device, booted: true }) },
    },
    deviceShutdown: {
      android: { shutdownTarget: async () => undefined },
    },
    androidApplications: {
      resolveOpenTarget: async () => ({}),
      inferOpenedAppBundleId: async () => 'com.example.app',
      resetFramePerfStats: async () => {},
      applyRuntimeHints: async () => {},
      clearRuntimeHints: async () => {},
      activateTestIme: async () => {},
      restoreTestIme: async () => {},
      recoverTestImeStartup: async () => {},
      hasTestImeRecoveryEvidence: async () => false,
    },
  } as unknown as Pick<
    PlatformRuntimeHost,
    | 'androidApplications'
    | 'clock'
    | 'commands'
    | 'deviceReadiness'
    | 'deviceShutdown'
    | 'localInteractors'
    | 'toolchains'
  >;
  vi.spyOn(Date, 'now')
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(20)
    .mockReturnValueOnce(30)
    .mockReturnValueOnce(50);
  const lifecycle = bindAndroidApplicationLifecycle({
    host,
    device,
    signal: new AbortController().signal,
  });

  const outcome = await lifecycle.openApplication({
    target: 'com.example.app',
    positionals: ['com.example.app'],
    runtimeLaunchUrl: 'example://after-open',
    appBundleId: 'com.example.app',
    surface: 'app',
    hasExistingSession: false,
    relaunch: false,
    prewarmRunnerBeforeOpen: false,
    enableTestIme: false,
    stateDir: '/state',
    runtimeHints: {},
    execution: {},
  });

  expect(opens).toEqual(['com.example.app', 'example://after-open']);
  expect(outcome.timing.launchUrlDurationMs).toBe(20);
});

function closeLifecycleHost(resolve: LocalApplicationInteractorHost['resolve']) {
  return {
    localInteractors: { resolve },
    deviceReadiness: {
      android: { ensureReady: async () => ({ ...device, booted: true }) },
    },
    deviceShutdown: {
      android: { shutdownTarget: async () => undefined },
    },
    androidApplications: {
      resolveOpenTarget: async () => ({}),
      inferOpenedAppBundleId: async () => 'com.example.app',
      resetFramePerfStats: async () => {},
      applyRuntimeHints: async () => {},
      clearRuntimeHints: async () => {},
      activateTestIme: async () => {},
      restoreTestIme: async () => {},
      recoverTestImeStartup: async () => {},
      hasTestImeRecoveryEvidence: async () => false,
    },
  } as unknown as Pick<
    PlatformRuntimeHost,
    | 'androidApplications'
    | 'clock'
    | 'commands'
    | 'deviceReadiness'
    | 'deviceShutdown'
    | 'localInteractors'
    | 'toolchains'
  >;
}

function closeInput(overrides: Partial<CloseApplicationInput> = {}): CloseApplicationInput {
  return {
    positionals: ['com.example.app'],
    appBundleId: 'com.example.app',
    surface: 'app',
    execution: {},
    ...overrides,
  };
}

test('kill mode calls am kill without resolving an interactor', async () => {
  let resolved = 0;
  const closed: string[] = [];
  const host = closeLifecycleHost(async () => {
    resolved += 1;
    return {
      open: async () => {},
      openDevice: async () => {},
      close: async (app: string) => {
        closed.push(app);
      },
      setSetting: async () => {},
    } as unknown as Interactor;
  });
  const lifecycle = bindAndroidApplicationLifecycle({
    host,
    device,
    signal: new AbortController().signal,
  });

  await lifecycle.closeApplication(closeInput({ mode: 'kill' }));

  expect(resolved).toBe(0);
  expect(closed).toEqual([]);
  expect(mockKillAndroidApp).toHaveBeenCalledOnce();
  expect(mockKillAndroidApp).toHaveBeenCalledWith(device, 'com.example.app');
});

test('stop close resolves an interactor and force-stops', async () => {
  let resolved = 0;
  const closed: string[] = [];
  const host = closeLifecycleHost(async () => {
    resolved += 1;
    return {
      open: async () => {},
      openDevice: async () => {},
      close: async (app: string) => {
        closed.push(app);
      },
      setSetting: async () => {},
    } as unknown as Interactor;
  });
  const lifecycle = bindAndroidApplicationLifecycle({
    host,
    device,
    signal: new AbortController().signal,
  });

  await lifecycle.closeApplication(closeInput());

  expect(resolved).toBe(1);
  expect(closed).toEqual(['com.example.app']);
  expect(mockKillAndroidApp).not.toHaveBeenCalled();
});
