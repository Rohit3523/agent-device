import { AppError } from '@agent-device/kernel/errors';
import {
  MAESTRO_ANDROID_PERMISSION_TARGETS,
  MAESTRO_IOS_PERMISSION_TARGETS,
} from '@agent-device/contracts/settings';
import { MAESTRO_PERMISSION_VALUES } from '@agent-device/maestro';

export type MaestroPermissionMutation = {
  readonly state: 'grant' | 'deny' | 'reset';
  readonly permission: string;
  readonly mode?: 'full' | 'limited';
};

/**
 * Canonical Maestro names each `settings permission` backend serves
 * individually, derived from the per-platform Maestro targets in contracts so
 * the adapter, the hint text, and the backend tables cannot drift. `all` is
 * not listed: it travels as one `settings permission` call and each backend
 * resolves it (iOS `simctl privacy … all`, Android's declared-permission
 * intersection). The iOS list is an explicit Maestro allowlist, not a
 * denylist over the native vocabulary: `contacts-limited` and
 * `location-always` are `settings permission` target names, not Maestro
 * names — a Maestro flow writes `photos: limited` and `location: always`
 * instead — and a native-only target added later must not become a Maestro
 * name without a deliberate contracts change. Names outside these lists
 * (iOS speech/usertracking/homekit/health; Android custom ids) fail loudly
 * below instead of being silently skipped.
 */
const EXPANDABLE_PERMISSIONS = {
  android: MAESTRO_ANDROID_PERMISSION_TARGETS.filter((name) => name !== 'all'),
  ios: MAESTRO_IOS_PERMISSION_TARGETS.filter((name) => name !== 'all'),
} as const;

/** Per-platform hint for names the backends cannot serve yet, from the same lists. */
const UNSUPPORTED_HINTS = {
  android: `Supported: ${MAESTRO_ANDROID_PERMISSION_TARGETS.join(', ')}. Android custom permission ids are attempted through all, not individually.`,
  ios: `Supported: ${MAESTRO_IOS_PERMISSION_TARGETS.join(', ')}. Granular iOS values: location always|inuse|never, photos limited.`,
} as const;

/** Non-canonical spellings accepted alongside the lists above. */
export const MAESTRO_PERMISSION_ALIASES: Readonly<Record<string, string>> = {
  medialibrary: 'media-library',
};

function canonicalName(name: string): string {
  const normalized = name.toLowerCase();
  return MAESTRO_PERMISSION_ALIASES[normalized] ?? normalized;
}

/** Plain values map 1:1 onto settings states; granular iOS values map per permission. */
const PLAIN_VALUE_STATES = { allow: 'grant', deny: 'deny', unset: 'reset' } as const;

/**
 * iOS-only granular values. Android has no always/in-use/limited distinction at
 * grant time, and its backend rejects `location-always` and any permission mode,
 * so these are refused on Android with UNSUPPORTED_OPERATION rather than failing
 * halfway through the backend after the adapter accepted them.
 */
const GRANULAR_MUTATIONS: Record<string, Record<string, MaestroPermissionMutation>> = {
  location: {
    always: { state: 'grant', permission: 'location-always' },
    inuse: { state: 'grant', permission: 'location' },
    // never denies access; unset resets to the prompt state.
    never: { state: 'deny', permission: 'location' },
  },
  photos: {
    limited: { state: 'grant', permission: 'photos', mode: 'limited' },
  },
};

const GRANULAR_HINTS: Record<string, string> = {
  location: 'Use allow|deny|unset, or the iOS granular always|inuse|never.',
  photos: 'Use allow|deny|unset, or the iOS granular limited.',
};

/**
 * Expand a Maestro `setPermissions` map into ordered `settings permission`
 * mutations. `all` travels as one backend call first so specific entries
 * always override it regardless of authored order. Values arrive lowercased
 * from the Maestro runtime layer; anything else is refused.
 * The expansion is fully validated here, so callers must map before issuing
 * any mutation — a rejected map changes nothing.
 */
export function mapMaestroSetPermissions(
  permissions: Readonly<Record<string, string>>,
  platform: 'ios' | 'android',
): MaestroPermissionMutation[] {
  const entries = Object.entries(permissions);
  if (entries.length === 0) {
    throw new AppError('INVALID_ARGS', 'Maestro setPermissions requires at least one permission.');
  }
  const mutations: MaestroPermissionMutation[] = [];
  const specific = new Map<string, string>();
  for (const [name, value] of entries) {
    if (name.toLowerCase() === 'all') {
      mutations.push(mapMaestroAll(value));
    } else {
      specific.set(canonicalName(name), value);
    }
  }
  for (const [name, value] of specific) {
    mutations.push(mapMaestroPermission(name, value, platform));
  }
  return mutations;
}

/** `all` accepts only the plain values; granular ones name no single backend state. */
function mapMaestroAll(value: string): MaestroPermissionMutation {
  const state = PLAIN_VALUE_STATES[value as keyof typeof PLAIN_VALUE_STATES];
  if (!state) {
    throw new AppError(
      'INVALID_ARGS',
      `Permission 'all' can be set to 'allow', 'deny' or 'unset', not '${value}'.`,
    );
  }
  return { state, permission: 'all' };
}

function mapMaestroPermission(
  name: string,
  value: string,
  platform: 'ios' | 'android',
): MaestroPermissionMutation {
  if (!new Set<string>(EXPANDABLE_PERMISSIONS[platform]).has(name)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Maestro permission "${name}" is not supported on ${platform} yet.`,
      { hint: UNSUPPORTED_HINTS[platform] },
    );
  }
  // The value vocabulary is owned by `@agent-device/maestro`
  // (`MAESTRO_PERMISSION_VALUES`): per-permission validity lives here, but an
  // unknown value is always INVALID_ARGS, never UNSUPPORTED_OPERATION.
  if (!MAESTRO_PERMISSION_VALUES.has(value)) {
    throw new AppError('INVALID_ARGS', `Maestro permission "${name}" does not accept "${value}".`, {
      hint: GRANULAR_HINTS[name] ?? 'Use allow|deny|unset.',
    });
  }
  const granular = GRANULAR_MUTATIONS[name]?.[value];
  if (granular) {
    if (platform !== 'ios') {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        `Maestro permission "${name}" value "${value}" is iOS-only.`,
        { hint: 'Use allow|deny|unset on Android.' },
      );
    }
    return granular;
  }
  const state = PLAIN_VALUE_STATES[value as keyof typeof PLAIN_VALUE_STATES];
  if (state) return { state, permission: name };
  throw new AppError('INVALID_ARGS', `Maestro permission "${name}" does not accept "${value}".`, {
    hint: GRANULAR_HINTS[name] ?? 'Use allow|deny|unset.',
  });
}
