'use client';

import { getDocumentLocaleAttributes } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { useEffect } from 'react';

/**
 * Local palette for the global error shell. This boundary replaces the root
 * layout, so Tailwind/theme tokens are not guaranteed to be available; the
 * colours are inlined here as a single typed source of truth.
 */
const GLOBAL_ERROR_COLORS = {
  background: '#06352F',
  foreground: '#FDFFF6',
  buttonBackground: '#005E5E',
  buttonForeground: '#FDFFF6',
} as const satisfies Record<string, string>;

/**
 * Top-level error boundary. Replaces the root layout when an error is thrown
 * in the root layout/template itself, so it must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const localeAttributes = getDocumentLocaleAttributes();
  const shellMessages = getMessages(localeAttributes.lang).shell;

  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang={localeAttributes.lang} dir={localeAttributes.dir} data-locale={localeAttributes.lang}>
      <body
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: 'var(--font-sans), Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
          padding: '1rem',
          background: GLOBAL_ERROR_COLORS.background,
          color: GLOBAL_ERROR_COLORS.foreground,
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
          {shellMessages.globalErrorTitle}
        </h1>
        <p style={{ maxWidth: '28rem', marginTop: '0.75rem', opacity: 0.8 }}>
          {shellMessages.globalErrorDescription}
        </p>
        {error?.digest && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.6 }}>
            {shellMessages.globalErrorReference}: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '1.5rem',
            padding: '0.5rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: GLOBAL_ERROR_COLORS.buttonBackground,
            color: GLOBAL_ERROR_COLORS.buttonForeground,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {shellMessages.tryAgain}
        </button>
      </body>
    </html>
  );
}
