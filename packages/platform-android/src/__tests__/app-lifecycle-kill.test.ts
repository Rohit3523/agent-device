import { test } from 'vitest';
import assert from 'node:assert/strict';
import { killAndroidApp } from '../app-lifecycle.ts';
import { withAndroidAdbProvider } from '../adb-executor.ts';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { assertRejectsAppError } from './test-utils/app-error.ts';
import './test-utils/android-host-test-setup.ts';

test('killAndroidApp dispatches am kill rather than am force-stop', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  const calls: (readonly string[])[] = [];

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        calls.push(args);
        if (args.join(' ') === 'shell dumpsys window windows') {
          return {
            stdout: 'mCurrentFocus=Window{43 u0 com.android.launcher/.Launcher}\n',
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => await killAndroidApp(device, 'com.example.app'),
  );

  assert.deepEqual(calls, [
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'am', 'kill', 'com.example.app'],
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'pidof', 'com.example.app'],
    ['shell', 'pidof', 'com.example.app'],
    ['shell', 'pidof', 'com.example.app'],
  ]);
});

// Live evidence (2026-09-25, Android 16 emulator): immediately after `launchApp`,
// `dumpsys window`'s `mCurrentFocus` still named the previous foreground app for one read while
// `dumpsys activity activities` already showed the launched app resumed. A single "not the target"
// foreground read is not proof the target left the foreground, so `killAndroidApp` corroborates it
// once before trusting it enough to skip the `android-kill-requires-background-app` refusal.
test('killAndroidApp refuses when a corroborating read shows the target back in the foreground', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  let foregroundReads = 0;

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        if (args.join(' ') === 'shell dumpsys window windows') {
          foregroundReads += 1;
          const stdout =
            foregroundReads === 1
              ? 'mCurrentFocus=Window{43 u0 com.android.launcher/.Launcher}\n'
              : 'mCurrentFocus=Window{44 u0 com.example.app/.MainActivity}\n';
          return { stdout, stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /Background the app before killApp/,
        details: { reason: 'android-kill-requires-background-app' },
      });
    },
  );

  assert.equal(foregroundReads, 2);
});

test('killAndroidApp refuses a foreground target before killing', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  const calls: (readonly string[])[] = [];

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        calls.push(args);
        if (args.join(' ') === 'shell dumpsys window windows') {
          return {
            stdout: 'mCurrentFocus=Window{42 u0 com.example.app/.MainActivity}\n',
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /Background the app before killApp/,
        details: { reason: 'android-kill-requires-background-app' },
      });
    },
  );

  assert.deepEqual(calls, [
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'dumpsys', 'window', 'windows'],
  ]);
});

test('killAndroidApp proceeds when a stale same-app read settles to background', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  let foregroundReads = 0;
  const calls: (readonly string[])[] = [];

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        calls.push(args);
        if (args.join(' ') === 'shell dumpsys window windows') {
          foregroundReads += 1;
          // First read still names the target (stale `mCurrentFocus` right after
          // `pressKey: Home`); later reads see the launcher so the kill completes.
          const stdout =
            foregroundReads === 1
              ? 'mCurrentFocus=Window{42 u0 com.example.app/.MainActivity}\n'
              : 'mCurrentFocus=Window{43 u0 com.android.launcher/.Launcher}\n';
          return { stdout, stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => await killAndroidApp(device, 'com.example.app'),
  );

  assert.equal(foregroundReads >= 2, true);
  assert.ok(calls.some((args) => args.join(' ') === 'shell am kill com.example.app'));
});

test('killAndroidApp fails closed when the confirmatory read cannot answer', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  let foregroundReads = 0;

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        if (args.join(' ') === 'shell dumpsys window windows') {
          foregroundReads += 1;
          if (foregroundReads === 1) {
            return {
              stdout: 'mCurrentFocus=Window{42 u0 com.example.app/.MainActivity}\n',
              stderr: '',
              exitCode: 0,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /Background the app before killApp/,
        details: { reason: 'android-kill-requires-background-app' },
      });
    },
  );

  assert.equal(foregroundReads, 2);
});

test('killAndroidApp fails when the process survives the kill', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        if (args.join(' ') === 'shell dumpsys window windows') {
          return {
            stdout: 'mCurrentFocus=Window{43 u0 com.android.launcher/.Launcher}\n',
            stderr: '',
            exitCode: 0,
          };
        }
        if (args.join(' ') === 'shell pidof com.example.app') {
          return { stdout: '12345\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /foreground service|force-stop/,
        details: { reason: 'android-kill-process-survived' },
      });
    },
  );
});

test('killAndroidApp fails when the liveness probe itself cannot answer', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        if (args.join(' ') === 'shell dumpsys window windows') {
          return {
            stdout: 'mCurrentFocus=Window{43 u0 com.android.launcher/.Launcher}\n',
            stderr: '',
            exitCode: 0,
          };
        }
        if (args.join(' ') === 'shell pidof com.example.app') {
          return { stdout: '', stderr: 'error: device offline\n', exitCode: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /pidof did not answer/,
        details: { reason: 'android-process-probe-unavailable' },
      });
    },
  );
});

test('killAndroidApp fails closed when the foreground probe cannot answer', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  const calls: (readonly string[])[] = [];

  await withAndroidAdbProvider(
    {
      exec: async (args) => {
        calls.push(args);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      reverse: {
        ensure: async () => {},
        remove: async () => {},
        removeAllOwned: async () => {},
      },
    },
    { serial: 'emulator-5554' },
    async () => {
      await assertRejectsAppError(() => killAndroidApp(device, 'com.example.app'), {
        code: 'COMMAND_FAILED',
        hint: /dumpsys did not answer/,
        details: { reason: 'android-process-probe-unavailable' },
      });
    },
  );

  assert.ok(!calls.some((args) => args.join(' ').includes('am kill')));
});
