'use client';

/**
 * SecretRefToggle (#14) — the external-secret-reference control for a write-only
 * secret config field, designed to slot into the {@link DynamicConnectorForm}.
 *
 * A secret field can be stored two ways:
 *   1. LITERAL — a real secret value (write-only; masked on read to the
 *      {@link REDACTED_SENTINEL}). This is the existing behaviour.
 *   2. EXTERNAL REFERENCE — a pointer the key provider resolves at CALL TIME:
 *        - "kms://<keyId>"           (provider = kms)
 *        - "vault://<path>#<field>"  (provider = vault)
 *      The reference string is itself NON-SECRET (the real value never leaves
 *      the provider), so it is safe to render verbatim — unlike a literal secret.
 *
 * The "use external reference" toggle swaps the password input for a reference
 * input and surfaces a clear "stored as a reference, resolved at call time" note
 * plus a rotate-every-days control (0 = off) that drives the rotation reminder /
 * auto-rotate + expiry alert. The companion non-secret config fields
 * (`secret_ref_provider`, `rotate_every_days`) are emitted via the callbacks so
 * the parent form folds them into the submitted config map.
 *
 * SECRET SAFETY. When the stored value is a literal secret (sentinel), this
 * control NEVER renders its plaintext: it shows "•••••• (set)" + Replace, exactly
 * like the legacy SecretField. Reference strings are shown because they are not
 * secret.
 */
import { useEffect, useMemo, useRef as useReactRef, useState } from 'react';
import { KeyRound, RotateCcw, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  REDACTED_SENTINEL,
  isRedacted,
  isSecretRef,
  secretRefProvider,
  type SecretRefProvider,
} from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import {
  useGovernanceLabels,
  fillGovernanceToken,
} from '../_lib/governance-labels';

export interface SecretRefValue {
  /** The secret field's value: a literal (or sentinel), or a kms://|vault:// ref. */
  value: unknown;
  /** Non-secret companion: which provider backs the value (none|kms|vault). */
  provider: SecretRefProvider;
  /** Non-secret companion: rotation cadence in days (0 = off). */
  rotateEveryDays: number;
}

interface SecretRefToggleProps {
  id: string;
  /** Current secret value (literal/sentinel or external reference). */
  value: unknown;
  /** Current rotation cadence (days) read from the companion config field. */
  rotateEveryDays: number;
  disabled: boolean;
  /** Emits the secret value + both non-secret companions on every change. */
  onChange: (next: SecretRefValue) => void;
}

/** Pick the right placeholder for the chosen reference provider. */
function refPlaceholder(provider: SecretRefProvider, t: ReturnType<typeof useGovernanceLabels>): string {
  return provider === 'vault' ? t.refVaultPlaceholder : t.refKmsPlaceholder;
}

export function SecretRefToggle({
  id,
  value,
  rotateEveryDays,
  disabled,
  onChange,
}: SecretRefToggleProps) {
  const t = useIntegrationLabels();
  const g = useGovernanceLabels();

  const storedIsRef = isSecretRef(value);
  const hasLiteralStored = isRedacted(value);

  // Mode: 'reference' (kms://|vault://) vs 'literal' (a real secret value).
  const [useRef, setUseRef] = useState<boolean>(storedIsRef);
  // For literal mode: whether the operator engaged Replace on a stored secret.
  const [replacing, setReplacing] = useState(false);
  // Reference provider (defaults to kms when switching a fresh field to ref).
  const [provider, setProvider] = useState<SecretRefProvider>(
    storedIsRef ? secretRefProvider(value) : 'kms',
  );

  // Track the value WE last emitted so the reseed effect below only reacts to
  // EXTERNAL value changes (e.g. the form reseeds config after the schema /
  // endpoint loads) — not to our own keystrokes. Reseeding on self-emitted
  // changes would, mid-typing, flip a transient empty reference back to literal
  // mode and break reference editing entirely.
  const lastEmitted = useReactRef<unknown>(value);

  // Reseed local mode when the underlying value identity changes externally.
  useEffect(() => {
    if (Object.is(value, lastEmitted.current)) return;
    lastEmitted.current = value;
    const isRef = isSecretRef(value);
    setUseRef(isRef);
    setReplacing(false);
    if (isRef) setProvider(secretRefProvider(value));
  }, [value, lastEmitted]);

  const days = useMemo(
    () => (Number.isFinite(rotateEveryDays) ? Math.max(0, Math.trunc(rotateEveryDays)) : 0),
    [rotateEveryDays],
  );

  function emit(nextValue: unknown, nextProvider: SecretRefProvider, nextDays: number) {
    // Remember what we emitted so the reseed effect treats it as our own change.
    lastEmitted.current = nextValue;
    onChange({ value: nextValue, provider: nextProvider, rotateEveryDays: nextDays });
  }

  function toggleMode(next: boolean) {
    setUseRef(next);
    if (next) {
      // Switch to reference: start empty, provider defaults to kms.
      const p: SecretRefProvider = provider === 'none' ? 'kms' : provider;
      setProvider(p);
      emit('', p, days);
    } else {
      // Switch to literal: clear any ref, provider becomes none, enter replace.
      setReplacing(true);
      emit('', 'none', days);
    }
  }

  function onRefInput(next: string) {
    // Infer the provider from the typed scheme so the companion stays accurate.
    const inferred = secretRefProvider(next);
    const p = inferred === 'none' ? provider : inferred;
    if (p !== provider) setProvider(p);
    emit(next, next ? p : provider, days);
  }

  function onDaysInput(raw: string) {
    const parsed = raw === '' ? 0 : Math.max(0, Math.trunc(Number(raw) || 0));
    emit(value, useRef ? provider : 'none', parsed);
  }

  function beginReplace() {
    setReplacing(true);
    emit('', 'none', days);
  }

  function cancelReplace() {
    setReplacing(false);
    // Restore the sentinel so the merge keeps the stored secret untouched.
    emit(REDACTED_SENTINEL, 'none', days);
  }

  const refValid = !useRef || value === '' || isSecretRef(value);

  return (
    <div className="space-y-2">
      {/* Mode toggle. */}
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <Label htmlFor={`${id}-ref-toggle`} className="flex items-center gap-2 text-xs font-medium">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {g.refToggleLabel}
        </Label>
        <Switch
          id={`${id}-ref-toggle`}
          checked={useRef}
          onCheckedChange={toggleMode}
          disabled={disabled}
        />
      </div>

      {useRef ? (
        /* ── External reference input (non-secret; safe to display). ── */
        <div className="space-y-1.5">
          <Input
            id={id}
            type="text"
            inputMode="text"
            value={typeof value === 'string' && !isRedacted(value) ? value : ''}
            onChange={(e) => onRefInput(e.target.value)}
            placeholder={refPlaceholder(provider, g)}
            disabled={disabled}
            dir="ltr"
            aria-invalid={!refValid}
            className={cn('font-mono', !refValid && 'border-destructive/70')}
          />
          {!refValid ? (
            <p className="text-xs text-destructive">{g.refInvalid}</p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span>{g.refStoredNote}</span>
            </p>
          )}
        </div>
      ) : hasLiteralStored && !replacing ? (
        /* ── Stored literal secret: masked + Replace (never shows plaintext). ── */
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
            {t.secretSet}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={beginReplace}
            disabled={disabled}
          >
            {t.secretReplace}
          </Button>
        </div>
      ) : (
        /* ── Literal secret entry (write-only password). ── */
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={isRedacted(value) ? '' : typeof value === 'string' ? value : ''}
              onChange={(e) => emit(e.target.value, 'none', days)}
              placeholder={t.secretEnterNew}
              disabled={disabled}
              dir="ltr"
              className="flex-1"
            />
            {replacing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelReplace}
                disabled={disabled}
              >
                <RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden />
                {t.secretUndoReplace}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t.secretKeepHint}</p>
        </div>
      )}

      {/* ── Rotation cadence (applies in either mode). ── */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Label htmlFor={`${id}-rotate`} className="text-xs text-muted-foreground">
          {g.rotateEveryDays}
        </Label>
        <Input
          id={`${id}-rotate`}
          type="number"
          min={0}
          value={String(days)}
          onChange={(e) => onDaysInput(e.target.value)}
          disabled={disabled}
          dir="ltr"
          className="h-8 w-24"
        />
        <span className="text-xs text-muted-foreground">
          {days > 0 ? fillGovernanceToken(g.rotateActive, 'n', days) : g.rotateOff}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{g.rotateEveryDaysHint}</p>
    </div>
  );
}
