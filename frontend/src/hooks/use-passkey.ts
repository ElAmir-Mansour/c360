'use client';

import { useCallback, useMemo, useState } from 'react';
import { setAccessToken } from '@/lib/auth';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { deviceTrustHeader } from '@/hooks/use-device-trust';
import type { User } from '@/types/models';

// PASSKEYS / WebAuthn (capability #5) — frontend-complete with graceful
// degradation. This hook never throws across normal failure paths: any missing
// endpoint (404/501), network error, unsupported browser, or user-cancelled
// ceremony (NotAllowedError) resolves to { unavailable: true } so the caller
// (PasskeyButton) can hide itself or surface a soft message.

// Shape returned on a successful authentication — mirrors the recon contract's
// login result (`interface LoginResult { requiresMFA: boolean; mfaToken?: string }`).
export interface PasskeyLoginResult {
  requiresMFA: boolean;
  mfaToken?: string;
}

// Returned whenever passkeys cannot be used or the ceremony fails softly.
export interface PasskeyUnavailable {
  unavailable: true;
  reason?: string;
}

export type PasskeyOutcome = PasskeyLoginResult | PasskeyUnavailable;

export function isPasskeyUnavailable(
  outcome: PasskeyOutcome,
): outcome is PasskeyUnavailable {
  return 'unavailable' in outcome && outcome.unavailable === true;
}

const WEBAUTHN_OPTIONS_ENDPOINT = '/api/auth/webauthn/options';
const WEBAUTHN_VERIFY_ENDPOINT = '/api/auth/webauthn/verify';

const UNAVAILABLE = (reason?: string): PasskeyUnavailable => ({
  unavailable: true,
  reason,
});

// ── base64url helpers (no deps) ──────────────────────────────────────────────

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PublicKeyCredentialRequestOptions JSON from the BFF (challenge / ids are
// base64url strings) → the binary shape the WebAuthn API expects.
interface RequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
}

function decodeRequestOptions(
  json: RequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToArrayBuffer(json.challenge),
    timeout: json.timeout,
    rpId: json.rpId,
    userVerification: json.userVerification,
    allowCredentials: json.allowCredentials?.map((cred) => ({
      id: base64UrlToArrayBuffer(cred.id),
      type: cred.type,
      transports: cred.transports,
    })),
  };
}

// Serialize the assertion to the base64url wire shape the verify endpoint wants.
function serializeAssertion(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    type: credential.type as 'public-key',
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

interface VerifyResponse {
  access_token?: string;
  refresh_token?: string;
  mfa_required?: boolean;
  mfa_token?: string;
  user?: User;
}

export interface UsePasskey {
  /** True when the platform exposes the WebAuthn API. */
  isSupported: boolean;
  /** In-flight ceremony indicator. */
  isAuthenticating: boolean;
  /**
   * Run the full passkey login ceremony:
   *  (a) fetch request options from the BFF,
   *  (b) call navigator.credentials.get(),
   *  (c) post the serialized assertion to the BFF verify route.
   * Resolves to a login result on success, or { unavailable: true } on any
   * 404/501/network/NotAllowedError/unsupported condition. Never rejects.
   */
  beginPasskeyLogin: (email?: string) => Promise<PasskeyOutcome>;
}

export function usePasskey(): UsePasskey {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const isSupported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.credentials !== 'undefined' &&
      typeof navigator.credentials.get === 'function',
    [],
  );

  const beginPasskeyLogin = useCallback(
    async (email?: string): Promise<PasskeyOutcome> => {
      if (!isSupported) {
        return UNAVAILABLE('unsupported');
      }

      setIsAuthenticating(true);
      try {
        // (a) Fetch request options from the BFF (relative URL + credentials).
        let optionsResp: Response;
        try {
          optionsResp = await fetch(WEBAUTHN_OPTIONS_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            // (#12) Carry the trusted-device id so the backend can scope the
            // challenge / step-up decision to this device.
            headers: { 'Content-Type': 'application/json', ...deviceTrustHeader() },
            body: JSON.stringify(email ? { email } : {}),
          });
        } catch {
          return UNAVAILABLE('network');
        }

        // 404 (route missing) / 501 (gateway not wired) → unavailable.
        if (optionsResp.status === 404 || optionsResp.status === 501) {
          return UNAVAILABLE('not-implemented');
        }
        if (!optionsResp.ok) {
          return UNAVAILABLE('options-failed');
        }

        let requestOptions: PublicKeyCredentialRequestOptions;
        try {
          const json = (await optionsResp.json()) as RequestOptionsJSON;
          requestOptions = decodeRequestOptions(json);
        } catch {
          return UNAVAILABLE('options-malformed');
        }

        // (b) Invoke the authenticator. NotAllowedError (user cancelled / timed
        // out) and any other DOMException are treated as a soft unavailable.
        let credential: PublicKeyCredential | null;
        try {
          credential = (await navigator.credentials.get({
            publicKey: requestOptions,
          })) as PublicKeyCredential | null;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            return UNAVAILABLE('cancelled');
          }
          return UNAVAILABLE('ceremony-failed');
        }

        if (!credential) {
          return UNAVAILABLE('no-credential');
        }

        // (c) Post the assertion to the BFF verify route.
        let verifyResp: Response;
        try {
          verifyResp = await fetch(WEBAUTHN_VERIFY_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            // (#12) Attach the trusted-device id to the passkey verification so
            // it rides along with the assertion, mirroring the password/MFA path.
            headers: { 'Content-Type': 'application/json', ...deviceTrustHeader() },
            body: JSON.stringify(serializeAssertion(credential)),
          });
        } catch {
          return UNAVAILABLE('network');
        }

        if (verifyResp.status === 404 || verifyResp.status === 501) {
          return UNAVAILABLE('not-implemented');
        }
        if (!verifyResp.ok) {
          return UNAVAILABLE('verify-failed');
        }

        let data: VerifyResponse;
        try {
          data = (await verifyResp.json()) as VerifyResponse;
        } catch {
          return UNAVAILABLE('verify-malformed');
        }

        // MFA-required passkey response stays symmetric with password login.
        if (data.mfa_required === true && data.mfa_token) {
          return { requiresMFA: true, mfaToken: data.mfa_token };
        }

        // Full login: the BFF verify route has already set the httpOnly session
        // cookies. Prime the in-memory access token so the rest of the app and
        // the axios instance can authenticate immediately.
        if (data.access_token) {
          setAccessToken(data.access_token);

          // Best-effort user prime — non-fatal: the auth store / session
          // hydration will fill this in regardless.
          if (!data.user) {
            try {
              await apiGet<User>(API_ENDPOINTS.USERS_ME);
            } catch {
              // ignore — session hydration handles user resolution
            }
          }

          return { requiresMFA: false };
        }

        return UNAVAILABLE('verify-incomplete');
      } finally {
        setIsAuthenticating(false);
      }
    },
    [isSupported],
  );

  return { isSupported, isAuthenticating, beginPasskeyLogin };
}
