'use client';

/**
 * Progressive bot challenge (capability #10).
 *
 * A lightweight, in-house, privacy-friendly bot deterrent that requires NO
 * external/paid provider and NO new npm dependencies. It is intentionally
 * "progressive": the parent only mounts the challenge AFTER risk signals
 * (repeated failed logins, or a 429 from the gateway). See `useBotChallenge`.
 *
 * It combines two cheap, complementary techniques:
 *
 *   1. A SLIDE-TO-CONFIRM control. Genuine humans drag/keyboard the handle to
 *      the end; trivial headless scripts that just submit the form never satisfy
 *      it. It is fully keyboard operable and screen-reader labelled (it is a
 *      native range input under the hood, exposed as a slider).
 *
 *   2. A hidden HONEYPOT field. It is invisible to humans (off-screen +
 *      aria-hidden + tabindex -1 + autocomplete off) but naive bots that fill
 *      every field will populate it. If it is non-empty, the challenge is
 *      considered FAILED regardless of the slider.
 *
 * Privacy note: no fingerprinting, no third-party network calls, no cookies,
 * no PII. All logic runs client-side.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PLUGGING IN A REAL PROVIDER LATER (e.g. Cloudflare Turnstile / hCaptcha):
 *
 *   This component exposes its result purely through `onPass()` (and the
 *   optional `onToken`). A real provider would replace the slide-to-confirm
 *   UI with the provider widget and, on the provider's success callback, call
 *   `onPass(providerToken)`. The parent (login form) then forwards that token
 *   to the backend for server-side verification. Search for `PROVIDER PLUG-IN`
 *   below for the exact seam. The `useBotChallenge` hook (when/whether to show
 *   a challenge) stays identical regardless of provider.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useT } from '@/components/providers/locale-provider';

/** Token emitted by the in-house challenge so the parent can pass *something*
 * to the backend in the same slot a real provider token would occupy. */
export const BOT_CHALLENGE_LOCAL_TOKEN = 'local-slide-confirm:v1';

export interface BotChallengeProps {
  /**
   * Called once the challenge is satisfied (slider completed + honeypot empty).
   * Receives a token string. For the in-house challenge this is
   * `BOT_CHALLENGE_LOCAL_TOKEN`; a real provider would supply its own token.
   * PROVIDER PLUG-IN: forward this token to the backend for verification.
   */
  onPass: (token: string) => void;
  /** Optional callback fired when the user resets / the challenge is voided. */
  onReset?: () => void;
  /** Disable interaction (e.g. while the parent form is submitting). */
  disabled?: boolean;
  /** Override the instruction label (defaults to English; parent may pass i18n). */
  label?: string;
  /** Override the success label. */
  successLabel?: string;
  className?: string;
}

// The slider runs 0..100; require near-complete travel so accidental nudges
// (or a single-tick keyboard press) do not pass.
const SLIDER_MAX = 100;
const PASS_THRESHOLD = 98;
// Minimum wall-clock time (ms) between first interaction and pass. Instant
// completion is a strong bot signal; humans take longer to drag a handle.
const MIN_INTERACTION_MS = 350;

export function BotChallenge({
  onPass,
  onReset,
  disabled = false,
  label,
  successLabel,
  className,
}: BotChallengeProps): JSX.Element {
  const t = useT();
  const resolvedLabel = label ?? t('auth.bot.slideLabel');
  const resolvedSuccessLabel = successLabel ?? t('auth.bot.slideSuccess');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const honeypotRef = useRef<HTMLInputElement>(null);
  const interactionStartedAt = useRef<number | null>(null);

  const [value, setValue] = useState(0);
  const [passed, setPassed] = useState(false);
  const [trapped, setTrapped] = useState(false);

  const sliderId = useId();
  const honeypotId = useId();
  const statusId = useId();

  const isLocked = disabled || passed;

  const markStart = useCallback(() => {
    if (interactionStartedAt.current === null) {
      interactionStartedAt.current = Date.now();
    }
  }, []);

  const commitPass = useCallback(() => {
    // Honeypot must be empty. A populated honeypot means an automated agent
    // filled a field no human can see/reach.
    const honeypotValue = honeypotRef.current?.value ?? '';
    if (honeypotValue.trim() !== '') {
      setTrapped(true);
      setPassed(false);
      setValue(0);
      return;
    }

    // Time-on-task heuristic: reject implausibly instant completion.
    const startedAt = interactionStartedAt.current;
    if (startedAt !== null && Date.now() - startedAt < MIN_INTERACTION_MS) {
      // Snap back to the start; the user (or bot) must travel again, this time
      // taking a human amount of time. We do NOT flag as trapped — a fast but
      // genuine drag is plausible, so we simply require another pass.
      setValue(0);
      interactionStartedAt.current = null;
      return;
    }

    setPassed(true);
    setValue(SLIDER_MAX);
    onPass(BOT_CHALLENGE_LOCAL_TOKEN);
  }, [onPass]);

  const handleChange = useCallback(
    (next: number) => {
      if (isLocked) return;
      markStart();
      setTrapped(false);
      if (next >= PASS_THRESHOLD) {
        commitPass();
      } else {
        setValue(next);
      }
    },
    [commitPass, isLocked, markStart],
  );

  // Pointer release before reaching the threshold snaps the handle back so the
  // affordance reads as "drag all the way" rather than "drag a little".
  const handleSettle = useCallback(() => {
    if (isLocked) return;
    if (value < PASS_THRESHOLD) {
      setValue(0);
    }
  }, [isLocked, value]);

  const reset = useCallback(() => {
    setValue(0);
    setPassed(false);
    setTrapped(false);
    interactionStartedAt.current = null;
    if (honeypotRef.current) honeypotRef.current.value = '';
    onReset?.();
  }, [onReset]);

  // If the parent disables mid-flight while not yet passed, reset travel so the
  // control is in a clean state when re-enabled.
  useEffect(() => {
    if (disabled && !passed) {
      setValue(0);
      interactionStartedAt.current = null;
    }
  }, [disabled, passed]);

  return (
    <div
      className={cn(
        'rounded-2xl border border-primary/15 bg-secondary/60 p-3.5',
        className,
      )}
    >
      {/*
        PROVIDER PLUG-IN: To swap in Cloudflare Turnstile (or similar), render
        the provider's widget container here instead of the slide control, mount
        the provider script in an effect, and call `onPass(providerToken)` from
        the provider's success callback. The honeypot below can remain as a
        zero-cost extra layer. The `useBotChallenge` hook is provider-agnostic.
      */}

      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-foreground/70">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span id={`${sliderId}-label`}>{passed ? resolvedSuccessLabel : resolvedLabel}</span>
      </div>

      <SlideToConfirm
        id={sliderId}
        labelledBy={`${sliderId}-label`}
        describedBy={statusId}
        value={value}
        max={SLIDER_MAX}
        passed={passed}
        disabled={isLocked}
        reducedMotion={reducedMotion}
        hint={t('auth.bot.slideHint')}
        confirmedText={t('auth.bot.confirmed')}
        percentHint={t('auth.bot.slidePercentHint')}
        onChange={handleChange}
        onSettle={handleSettle}
        onStart={markStart}
      />

      {/* Live region announces outcome for assistive tech. */}
      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {passed
          ? resolvedSuccessLabel
          : trapped
            ? t('auth.bot.verificationFailedRetry')
            : t('auth.bot.slideInstruction')}
      </p>

      {trapped ? (
        <p className="mt-2 text-[12px] leading-5 text-destructive">
          {t('auth.bot.verificationFailed')}{' '}
          <button
            type="button"
            onClick={reset}
            className="font-semibold underline hover:no-underline"
          >
            {t('auth.bot.tryAgain')}
          </button>
        </p>
      ) : null}

      {passed ? (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{resolvedSuccessLabel}</span>
        </div>
      ) : null}

      {/*
        HONEYPOT. Invisible to humans, present in the DOM for naive bots.
        - Visually removed (off-screen, zero-size) rather than display:none so
          some headless browsers that skip display:none fields still fill it.
        - aria-hidden + tabindex -1 keep it out of the a11y tree and tab order.
        - autoComplete off + an innocuous-but-tempting name ("nickname").
      */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        <label htmlFor={honeypotId}>{t('auth.bot.leaveEmpty')}</label>
        <input
          ref={honeypotRef}
          id={honeypotId}
          type="text"
          name="nickname"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
          onChange={() => setTrapped(true)}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// useBotChallenge — progressive gating logic
// ───────────────────────────────────────────────────────────────────────────

export interface UseBotChallengeOptions {
  /**
   * Number of failures after which the challenge becomes required.
   * Default 3 (i.e. the 4th attempt requires the challenge). A 429 forces it
   * immediately regardless of this count (see `markFailure`).
   */
  threshold?: number;
}

export interface UseBotChallengeResult {
  /** Whether the parent should render <BotChallenge /> now. */
  required: boolean;
  /** Current consecutive-failure count (exposed for telemetry/labels). */
  failureCount: number;
  /**
   * Record a failed attempt. Pass a status code (e.g. 429) to force the
   * challenge on regardless of the failure count — rate-limit responses are a
   * strong abuse signal and should gate immediately.
   */
  markFailure: (status?: number) => void;
  /** Clear all state (call on a successful login, or to manually dismiss). */
  reset: () => void;
}

/**
 * Decides WHEN a bot challenge should be shown. Provider-agnostic: this logic
 * is identical whether the visible challenge is the in-house slider or a real
 * CAPTCHA provider. Pairs with <BotChallenge />, but holds no UI itself.
 *
 *   const { required, markFailure, reset } = useBotChallenge();
 *   // on failed login:        markFailure(err.status);   // 429 forces it
 *   // on successful login:    reset();
 *   // render:                 {required && <BotChallenge onPass={...} />}
 */
export function useBotChallenge(
  options: UseBotChallengeOptions = {},
): UseBotChallengeResult {
  const threshold = options.threshold ?? 3;

  const [failureCount, setFailureCount] = useState(0);
  // A 429 (or other forced signal) latches the challenge on independently of
  // the failure count, so a single rate-limit response gates immediately.
  const [forced, setForced] = useState(false);

  const markFailure = useCallback((status?: number) => {
    if (status === 429) {
      setForced(true);
    }
    setFailureCount((c) => c + 1);
  }, []);

  const reset = useCallback(() => {
    setFailureCount(0);
    setForced(false);
  }, []);

  const required = forced || failureCount >= threshold;

  return { required, failureCount, markFailure, reset };
}

interface SlideToConfirmProps {
  id: string;
  labelledBy: string;
  describedBy: string;
  value: number;
  max: number;
  passed: boolean;
  disabled: boolean;
  reducedMotion: boolean;
  /** Localized centered hint text ("Slide to confirm"). */
  hint: string;
  /** Localized aria-valuetext for the confirmed state ("Confirmed"). */
  confirmedText: string;
  /** Localized aria-valuetext suffix ("slide to the end to confirm"). */
  percentHint: string;
  onChange: (next: number) => void;
  onSettle: () => void;
  onStart: () => void;
}

/**
 * The visible slide-to-confirm affordance. Built on a native <input range> so
 * it is keyboard operable and screen-reader exposed for free; the visual track
 * and handle are layered on top.
 */
function SlideToConfirm({
  id,
  labelledBy,
  describedBy,
  value,
  max,
  passed,
  disabled,
  reducedMotion,
  hint,
  confirmedText,
  percentHint,
  onChange,
  onSettle,
  onStart,
}: SlideToConfirmProps): JSX.Element {
  const pct = Math.min(100, Math.round((value / max) * 100));

  return (
    <div
      className={cn(
        'relative h-11 w-full select-none overflow-hidden rounded-2xl border',
        passed
          ? 'border-primary/30 bg-primary/10'
          : disabled
            ? 'border-primary/10 bg-secondary/40 opacity-60'
            : 'border-primary/20 bg-card',
      )}
    >
      {/* Filled track */}
      <div
        className={cn(
          'absolute inset-y-0 start-0 bg-primary/15',
          reducedMotion ? '' : 'transition-[width] duration-150 ease-out',
        )}
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />

      {/* Hint text centred in the track */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] font-medium text-foreground/45"
        aria-hidden="true"
      >
        {passed ? '' : hint}
      </div>

      {/* Visual handle */}
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl shadow-sm',
          passed ? 'bg-primary text-primary-foreground' : 'bg-primary text-primary-foreground',
          reducedMotion ? '' : 'transition-[inset-inline-start] duration-150 ease-out',
        )}
        style={{ insetInlineStart: `calc(${pct}% * 0.86 + 2px)` }}
        aria-hidden="true"
      >
        {passed ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <span className="inline-block text-base leading-none rtl:-scale-x-100">›</span>
        )}
      </div>

      {/*
        The real control. Transparent, layered over the visuals. Native range
        input gives us role="slider", aria-valuenow/min/max, and full keyboard
        operability (arrows/Home/End) at no cost.
      */}
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-valuetext={passed ? confirmedText : `${pct}% — ${percentHint}`}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onSettle}
        onBlur={onSettle}
        className={cn(
          'absolute inset-0 h-full w-full cursor-grab appearance-none bg-transparent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'disabled:cursor-not-allowed',
          // Hide the native thumb/track; we render our own visuals above.
          '[&::-webkit-slider-thumb]:h-9 [&::-webkit-slider-thumb]:w-9 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0',
          '[&::-moz-range-thumb]:h-9 [&::-moz-range-thumb]:w-9 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0',
        )}
      />
    </div>
  );
}
