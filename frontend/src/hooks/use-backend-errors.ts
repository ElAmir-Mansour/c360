'use client';

import { useCallback } from 'react';
import type {
  FieldValues,
  Path,
  UseFormSetError,
  UseFormSetFocus,
} from 'react-hook-form';
import { parseApiError } from '@/lib/format';

/**
 * Normalized result of mapping a backend error onto a form. `fieldErrors` is the
 * set of per-field messages that were applied via `setError`; `summary` is the
 * top-level message for anything that couldn't be tied to a field (or a general
 * validation/conflict message).
 */
export interface BackendErrorResult<TFieldValues extends FieldValues> {
  /** Field names (paths) that received an error. */
  fields: Array<Path<TFieldValues>>;
  /** Non-field / general message suitable for a FormErrorSummary or toast. */
  summary?: string;
  /** HTTP status if it could be determined. */
  status?: number;
  /** Whether any per-field error was applied. */
  hasFieldErrors: boolean;
}

/**
 * The validation envelope this app's backend returns. Errors arrive either flat
 * (`{ code, message, details }`) or nested under `error` (`{ error: { ... } }`),
 * always carrying `details: Record<field, string[]>` for 422/409 validation and
 * conflict responses.
 */
interface ValidationEnvelope {
  status?: number;
  code?: string;
  message?: string;
  details?: Record<string, string[] | string>;
}

function extractEnvelope(error: unknown): {
  envelope: ValidationEnvelope;
  status?: number;
} {
  // AxiosError: { response: { status, data } }
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as {
      response?: { status?: number; data?: unknown };
    }).response;
    const status = response?.status;
    const data = response?.data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const nested = record.error;
      if (nested && typeof nested === 'object') {
        return { envelope: nested as ValidationEnvelope, status };
      }
      return { envelope: record as ValidationEnvelope, status };
    }
    return { envelope: {}, status };
  }
  // Already-unwrapped ApiError-shaped object.
  if (error && typeof error === 'object') {
    const record = error as ValidationEnvelope;
    return { envelope: record, status: record.status };
  }
  return { envelope: {} };
}

function firstMessage(value: string[] | string | undefined): string | undefined {
  if (Array.isArray(value)) return value.find((v) => v && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

/**
 * Maps a backend error payload onto a react-hook-form instance. Returns a
 * callback that, given the error and the form's `setError` (and optionally
 * `setFocus`), applies per-field messages from `details` and returns a summary
 * for any non-field error.
 *
 * @example
 * const applyBackendErrors = useBackendErrors<FormValues>();
 * const onError = (err: unknown) => {
 *   const { summary } = applyBackendErrors(err, setError, setFocus);
 *   if (summary) setFormSummary(summary);
 * };
 */
export function useBackendErrors<TFieldValues extends FieldValues>() {
  return useCallback(
    (
      error: unknown,
      setError: UseFormSetError<TFieldValues>,
      setFocus?: UseFormSetFocus<TFieldValues>,
    ): BackendErrorResult<TFieldValues> => {
      const { envelope, status } = extractEnvelope(error);
      const details = envelope.details ?? {};
      const fields: Array<Path<TFieldValues>> = [];

      for (const [rawKey, rawValue] of Object.entries(details)) {
        const message = firstMessage(rawValue);
        if (!message) continue;
        // Backend may emit snake_case; RHF paths are usually the same as the
        // backend field names, so we pass them through unchanged.
        const path = rawKey as Path<TFieldValues>;
        setError(path, { type: 'server', message }, { shouldFocus: false });
        fields.push(path);
      }

      const hasFieldErrors = fields.length > 0;

      // Focus the first errored field so keyboard users land on it.
      if (hasFieldErrors && setFocus) {
        try {
          setFocus(fields[0]);
        } catch {
          // Field may not be registered as a focusable input; ignore.
        }
      }

      // Summary: when nothing mapped to a field, surface the general message.
      // When fields did map, only surface a summary if the backend also sent a
      // distinct top-level message (avoids duplicating a single field error).
      const generalMessage = envelope.message ?? parseApiError(error);
      const summary = hasFieldErrors ? undefined : generalMessage;

      return {
        fields,
        summary,
        status: status ?? envelope.status,
        hasFieldErrors,
      };
    },
    [],
  );
}
