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
    ['shell', 'am', 'kill', 'com.example.app'],
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'pidof', 'com.example.app'],
    ['shell', 'pidof', 'com.example.app'],
    ['shell', 'pidof', 'com.example.app'],
  ]);
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

  assert.deepEqual(calls, [['shell', 'dumpsys', 'window', 'windows']]);
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
