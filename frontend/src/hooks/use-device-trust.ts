'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Device Trust + new-device step-up signal (capability #12) — graceful.
 *
 * This hook supplies a stable, client-generated device identifier so the
 * parent/auth layer can pass it through to the backend on auth requests
 * (as the `X-Device-Id` header and/or a `device_id` body field).
 *
 * The "step-up" itself is decided by the backend: a login response with
 * `requiresMFA: true` signals that the device/context warrants additional
 * verification. This hook does NOT gate or decide step-up — it only ensures a
 * durable device id exists and exposes a best-effort `registerDevice()` call.
 *
 * SSR-safe: all `window`/`localStorage` access is guarded; on the server the
 * device id resolves to `null` until the first client-side effect runs.
 */

/** localStorage key holding the stable per-browser device identifier. */
export const DEVICE_ID_STORAGE_KEY = 'clario360_device_id';

/** localStorage key holding the "this device is trusted" flag. */
export const DEVICE_TRUSTED_STORAGE_KEY = 'clario360_device_trusted';

/** Header name the auth layer should attach when sending the device id. */
export const DEVICE_ID_HEADER = 'X-Device-Id';

/** BFF route this hook posts device registrations to. */
const DEVICE_REGISTER_ENDPOINT = '/api/auth/devices';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function generateDeviceId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes lacking crypto.randomUUID.
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads the persisted device id, generating + storing a new one on first use.
 * Returns `null` on the server (no localStorage). Safe to call repeatedly.
 */
export function getDeviceId(): string | null {
  if (!isBrowser()) return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private mode / quota). Return an ephemeral id so callers
    // still get a usable value, without persisting.
    return generateDeviceId();
  }
}

/** True if this browser has been explicitly marked as a trusted device. */
export function isTrustedDevice(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(DEVICE_TRUSTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Marks this browser as trusted (persists the flag). Returns the device id. */
export function trustThisDevice(): string | null {
  const id = getDeviceId();
  if (!isBrowser()) return id;
  try {
    window.localStorage.setItem(DEVICE_TRUSTED_STORAGE_KEY, 'true');
  } catch {
    // Non-fatal: trust simply won't persist.
  }
  return id;
}

/** Clears the trusted flag for this browser (keeps the device id). */
export function untrustThisDevice(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(DEVICE_TRUSTED_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Builds the header object the auth layer can spread onto an auth request,
 * e.g. `fetch(url, { headers: { ...deviceTrustHeader() } })`. Returns an empty
 * object when no device id is available (SSR / storage blocked) so callers can
 * always spread it safely.
 */
export function deviceTrustHeader(): Record<string, string> {
  const id = getDeviceId();
  return id ? { [DEVICE_ID_HEADER]: id } : {};
}

/** Outcome of a best-effort device registration. */
export interface RegisterDeviceResult {
  /** True only when the backend acknowledged the registration. */
  registered: boolean;
  /** The device id that was (attempted to be) registered. */
  deviceId: string | null;
  /** True when the backend registry endpoint was unavailable (degraded). */
  unavailable: boolean;
}

/**
 * Best-effort POST of the current device id to the BFF device registry.
 *
 * Graceful degradation: a missing/erroring backend (501/4xx/5xx/network) is
 * reported as `{ registered: false, unavailable: true }` and never throws.
 * Callers can ignore the result entirely — registration is non-blocking.
 *
 * @param trusted - whether to announce this device as trusted (defaults to the
 *                  persisted trusted flag).
 */
export async function registerDevice(
  trusted?: boolean,
): Promise<RegisterDeviceResult> {
  const deviceId = getDeviceId();
  if (!isBrowser() || !deviceId) {
    return { registered: false, deviceId, unavailable: true };
  }

  const announceTrusted = trusted ?? isTrustedDevice();

  try {
    const resp = await fetch(DEVICE_REGISTER_ENDPOINT, {
      method: 'POST',
      // BFF route — relative URL + include credentials (cookies), never axios.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        [DEVICE_ID_HEADER]: deviceId,
      },
      body: JSON.stringify({
        device_id: deviceId,
        trusted: announceTrusted,
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    });

    if (!resp.ok) {
      // 501 (stub) or any other non-2xx → feature unavailable, non-fatal.
      return { registered: false, deviceId, unavailable: true };
    }

    let registered = true;
    try {
      const data = (await resp.json()) as { registered?: boolean };
      if (typeof data.registered === 'boolean') registered = data.registered;
    } catch {
      // Body parse failure is non-fatal; a 2xx already means accepted.
    }

    return { registered, deviceId, unavailable: !registered };
  } catch {
    return { registered: false, deviceId, unavailable: true };
  }
}

/** Public surface returned by {@link useDeviceTrust}. */
export interface UseDeviceTrust {
  /** Stable device id for this browser; `null` until hydrated on the client. */
  deviceId: string | null;
  /** Whether this browser is currently marked as a trusted device. */
  isTrusted: boolean;
  /** True once the hook has read storage on the client (post-hydration). */
  isHydrated: boolean;
  /** Reads (and lazily generates) the persisted device id. */
  getDeviceId: () => string | null;
  /** Reads the trusted-device flag from storage. */
  isTrustedDevice: () => boolean;
  /** Marks this browser as trusted and syncs hook state. */
  trustThisDevice: () => void;
  /** Clears the trusted flag and syncs hook state. */
  untrustThisDevice: () => void;
  /** Header object to spread onto auth requests, e.g. `{ 'X-Device-Id': id }`. */
  deviceTrustHeader: () => Record<string, string>;
  /** Best-effort registration with the BFF device registry (never throws). */
  registerDevice: (trusted?: boolean) => Promise<RegisterDeviceResult>;
}

/**
 * React hook wrapping the device-trust helpers with reactive state.
 *
 * On mount it ensures a stable device id exists (SSR-safe — generation happens
 * client-side) and reflects the trusted flag. The returned helpers keep the
 * hook's `deviceId`/`isTrusted`/`isHydrated` state in sync.
 */
export function useDeviceTrust(): UseDeviceTrust {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isTrusted, setIsTrusted] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Runs only on the client — safe to touch localStorage here.
    setDeviceId(getDeviceId());
    setIsTrusted(isTrustedDevice());
    setIsHydrated(true);
  }, []);

  const trust = useCallback(() => {
    const id = trustThisDevice();
    setDeviceId(id);
    setIsTrusted(true);
  }, []);

  const untrust = useCallback(() => {
    untrustThisDevice();
    setIsTrusted(false);
  }, []);

  const getId = useCallback(() => {
    const id = getDeviceId();
    setDeviceId(id);
    return id;
  }, []);

  const checkTrusted = useCallback(() => {
    const trusted = isTrustedDevice();
    setIsTrusted(trusted);
    return trusted;
  }, []);

  return {
    deviceId,
    isTrusted,
    isHydrated,
    getDeviceId: getId,
    isTrustedDevice: checkTrusted,
    trustThisDevice: trust,
    untrustThisDevice: untrust,
    deviceTrustHeader,
    registerDevice,
  };
}
