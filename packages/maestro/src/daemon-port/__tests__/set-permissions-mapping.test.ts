import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import { MAESTRO_PERMISSION_VALUES } from '@agent-device/maestro';
import {
  MAESTRO_ANDROID_PERMISSION_TARGETS,
  MAESTRO_IOS_PERMISSION_TARGETS,
  MOBILE_PERMISSION_TARGETS,
} from '@agent-device/contracts/settings';
import { AppError } from '@agent-device/kernel/errors';
import {
  MAESTRO_PERMISSION_ALIASES,
  mapMaestroSetPermissions,
  type MaestroPermissionMutation,
} from '../set-permissions-mapping.ts';

function assertIosHintListsAdmissionSet(name: string): void {
  try {
    mapMaestroSetPermissions({ [name]: 'allow' }, 'ios');
  } catch (error) {
    assert.ok(error instanceof AppError && error.code === 'UNSUPPORTED_OPERATION');
    const hint = String((error.details as { hint?: unknown } | undefined)?.hint ?? '');
    for (const supported of MAESTRO_IOS_PERMISSION_TARGETS) {
      assert.ok(hint.includes(supported), `iOS hint omits ${supported} for ${name}: ${hint}`);
    }
    assert.ok(!hint.includes('contacts-limited'), `iOS hint lists native-only name: ${hint}`);
    assert.ok(!hint.includes('location-always'), `iOS hint lists native-only name: ${hint}`);
    return;
  }
  assert.fail(`expected iOS ${name} to be unsupported`);
}

function mapAndroidOrNull(name: string, value: string): MaestroPermissionMutation[] | null {
  try {
    return mapMaestroSetPermissions({ [name]: value }, 'android');
  } catch (error) {
    assert.ok(
      error instanceof AppError &&
        (error.code === 'UNSUPPORTED_OPERATION' || error.code === 'INVALID_ARGS'),
      `unexpected ${String(error)} for Android ${name}:${value}`,
    );
    return null;
  }
}

function assertAndroidMutationServable(
  mutation: MaestroPermissionMutation,
  servable: ReadonlySet<string>,
): void {
  assert.ok(
    servable.has(mutation.permission),
    `Android mutation ${mutation.permission} not in ${[...servable].join(',')}`,
  );
  assert.equal(mutation.mode, undefined);
}

function checkAndroidName(
  name: string,
  servable: ReadonlySet<string>,
  checkedPlain: Set<string>,
): number {
  let checked = 0;
  for (const value of MAESTRO_PERMISSION_VALUES) {
    const mutations = mapAndroidOrNull(name, value);
    if (!mutations) continue;
    for (const mutation of mutations) {
      assertAndroidMutationServable(mutation, servable);
      checked += 1;
      if (value === 'allow' || value === 'deny' || value === 'unset') {
        checkedPlain.add(`${mutation.permission}:${value}`);
      }
    }
  }
  return checked;
}

function assertAndroidPlainCoverage(checkedPlain: ReadonlySet<string>): void {
  for (const target of MAESTRO_ANDROID_PERMISSION_TARGETS) {
    for (const value of ['allow', 'deny', 'unset'] as const) {
      assert.ok(
        checkedPlain.has(`${target}:${value}`),
        `expected Android ${target}:${value} to be checked`,
      );
    }
  }
}

describe('mapMaestroSetPermissions', () => {
  test('maps single permissions to grant/deny/reset', () => {
    assert.deepEqual(
      mapMaestroSetPermissions({ camera: 'allow', notifications: 'deny' }, 'android'),
      [
        { state: 'grant', permission: 'camera' },
        { state: 'deny', permission: 'notifications' },
      ],
    );
    assert.deepEqual(mapMaestroSetPermissions({ notifications: 'unset' }, 'android'), [
      { state: 'reset', permission: 'notifications' },
    ]);
  });

  test('all travels as one backend call with specifics overriding after it', () => {
    assert.deepEqual(mapMaestroSetPermissions({ all: 'deny', notifications: 'unset' }, 'android'), [
      { state: 'deny', permission: 'all' },
      { state: 'reset', permission: 'notifications' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ all: 'allow' }, 'ios'), [
      { state: 'grant', permission: 'all' },
    ]);
    assert.throws(
      () => mapMaestroSetPermissions({ all: 'never' }, 'ios'),
      /'allow', 'deny' or 'unset'/i,
    );
    assert.throws(
      () => mapMaestroSetPermissions({ all: 'limited' }, 'ios'),
      /'allow', 'deny' or 'unset'/i,
    );
  });

  test('maps iOS granular values and the medialibrary alias', () => {
    assert.deepEqual(mapMaestroSetPermissions({ location: 'always' }, 'ios'), [
      { state: 'grant', permission: 'location-always' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ location: 'inuse' }, 'ios'), [
      { state: 'grant', permission: 'location' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ location: 'never' }, 'ios'), [
      { state: 'deny', permission: 'location' },
    ]);
    // never denies access while unset restores the prompt state.
    assert.deepEqual(mapMaestroSetPermissions({ location: 'unset' }, 'ios'), [
      { state: 'reset', permission: 'location' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ photos: 'limited' }, 'ios'), [
      { state: 'grant', permission: 'photos', mode: 'limited' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ medialibrary: 'allow' }, 'ios'), [
      { state: 'grant', permission: 'media-library' },
    ]);
  });

  test('maps the Android names to backend targets', () => {
    assert.deepEqual(mapMaestroSetPermissions({ calendar: 'allow' }, 'android'), [
      { state: 'grant', permission: 'calendar' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ location: 'deny' }, 'android'), [
      { state: 'deny', permission: 'location' },
    ]);
    assert.deepEqual(mapMaestroSetPermissions({ microphone: 'unset' }, 'android'), [
      { state: 'reset', permission: 'microphone' },
    ]);
  });

  test('rejects unservable names, empty maps, and nonsense value combos', () => {
    assert.throws(
      () => mapMaestroSetPermissions({ health: 'allow' }, 'android'),
      /health.*not supported on android/i,
    );
    // bluetooth/phone/sms/storage were dropped: advertised but unreachable —
    // the contracts parser never accepted them, so the adapter must not either.
    for (const name of ['bluetooth', 'phone', 'sms', 'storage']) {
      assert.throws(
        () => mapMaestroSetPermissions({ [name]: 'allow' }, 'android'),
        new RegExp(`${name}.*not supported on android`, 'i'),
      );
    }
    assert.throws(
      () => mapMaestroSetPermissions({ speech: 'allow' }, 'ios'),
      /speech.*not supported on ios/i,
    );
    assert.throws(
      () =>
        mapMaestroSetPermissions(
          { 'android.permission.MANAGE_EXTERNAL_STORAGE': 'deny' },
          'android',
        ),
      /not supported on android/i,
    );
    assert.throws(() => mapMaestroSetPermissions({}, 'ios'), /at least one permission/i);
    assert.throws(
      () => mapMaestroSetPermissions({ camera: 'always' }, 'ios'),
      /camera.*does not accept.*always/i,
    );
    // contacts-limited and location-always are `settings permission` target
    // names, not Maestro names: the Maestro spellings are photos: limited
    // and location: always.
    for (const name of ['contacts-limited', 'location-always']) {
      assert.throws(
        () => mapMaestroSetPermissions({ [name]: 'allow' }, 'ios'),
        new RegExp(`${name}.*not supported on ios`, 'i'),
      );
    }
  });

  test('refuses iOS granular values on Android', () => {
    for (const [name, value] of [
      ['location', 'always'],
      ['location', 'inuse'],
      ['location', 'never'],
      ['photos', 'limited'],
    ] as const) {
      assert.throws(() => mapMaestroSetPermissions({ [name]: value }, 'android'), /iOS-only/i);
    }
  });

  test('iOS unsupported hint lists the Maestro admission set', () => {
    // The admission set and the hint share one Maestro iOS list in contracts:
    // a native-only spelling must fail without appearing as supported.
    for (const name of ['contacts-limited', 'location-always', 'speech']) {
      assertIosHintListsAdmissionSet(name);
    }
  });

  test('every mutation emitted for Android is a backend-servable pair', () => {
    // Pins the adapter to mutations the backend serves: a value the adapter
    // accepts must never fail halfway through `settings permission`. The
    // backend table is typed from the same contracts list, so membership plus
    // a missing mode is the whole contract on Android (granular values are
    // refused above, never emitted).
    const names = [...MOBILE_PERMISSION_TARGETS, ...Object.keys(MAESTRO_PERMISSION_ALIASES)];
    const servable = new Set<string>(MAESTRO_ANDROID_PERMISSION_TARGETS);
    const checkedPlain = new Set<string>();
    let checked = 0;
    for (const name of names) checked += checkAndroidName(name, servable, checkedPlain);
    assert.ok(checked > 0, 'expected at least one Android mutation to be checked');
    assertAndroidPlainCoverage(checkedPlain);
  });
});
