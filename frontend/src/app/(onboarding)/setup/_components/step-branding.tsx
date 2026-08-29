'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2, ChevronLeft, ImagePlus, Loader2, ShieldCheck, Upload, X } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { isApiError } from '@/types/api';

import { ColorPicker } from './color-picker';
import { brandingSchema, type BrandingFormValues } from './shared';
import '../../_lib/onboarding-i18n';

export function StepBranding({
  initialValues,
  savedLogoFileId,
  onBack,
  onSaved,
  onPersist,
}: {
  initialValues: BrandingFormValues;
  savedLogoFileId?: string | null;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onPersist: (values: BrandingFormValues) => void;
}) {
  const {
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BrandingFormValues>({
    resolver: zodResolver(brandingSchema),
    defaultValues: initialValues,
  });
  const [apiError, setApiError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const values = watch();
  const t = useT('onboarding');

  useEffect(() => {
    const subscription = watch((nextValues) => {
      onPersist(nextValues as BrandingFormValues);
    });
    return () => subscription.unsubscribe();
  }, [watch, onPersist]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoFile]);

  const handleLogoSelection = (fileList: FileList | File[]) => {
    const file = Array.from(fileList)[0];
    if (!file) {
      return;
    }

    const isSupportedType =
      file.type === 'image/png' ||
      file.type === 'image/svg+xml' ||
      file.name.toLowerCase().endsWith('.png') ||
      file.name.toLowerCase().endsWith('.svg');
    if (!isSupportedType) {
      setLogoError(t('branding.logoTypeError'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError(t('branding.logoSizeError'));
      return;
    }

    setLogoError(null);
    setLogoFile(file);
  };

  const handleSkip = async () => {
    setApiError(null);
    setIsSkipping(true);
    try {
      await onSaved();
    } catch {
      setApiError(t('branding.proceedError'));
    } finally {
      setIsSkipping(false);
    }
  };

  const submit = handleSubmit(async (branding) => {
    setApiError(null);
    try {
      const payload = new FormData();
      payload.append('primary_color', branding.primary_color);
      payload.append('accent_color', branding.accent_color);
      if (logoFile) {
        payload.append('logo', logoFile);
      }

      await apiPost(API_ENDPOINTS.ONBOARDING_BRANDING, payload);
      setLogoFile(null);
      await onSaved();
    } catch (error) {
      setApiError(isApiError(error) ? error.message : t('branding.saveFailed'));
    }
  });

  return (
    <form onSubmit={submit} className="space-y-6">
      {apiError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div
            className={`rounded-3xl border-2 border-dashed p-6 transition ${
              isDraggingLogo
                ? 'border-primary bg-primary/5'
                : 'border-primary/20 bg-secondary'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingLogo(true);
            }}
            onDragLeave={() => setIsDraggingLogo(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingLogo(false);
              handleLogoSelection(event.dataTransfer.files);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/svg+xml,.png,.svg"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) {
                  handleLogoSelection(event.target.files);
                }
                event.target.value = '';
              }}
            />

            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary p-3 text-white">
                <ImagePlus className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{t('branding.uploadTitle')}</p>
                <p className="mt-1 text-sm text-foreground/55">{t('branding.uploadHelp')}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                    <Upload className="mr-2 h-4 w-4" />
                    {t('branding.chooseLogo')}
                  </Button>
                  <div className="rounded-full bg-card px-3 py-2 text-xs font-medium text-foreground/55 shadow-sm">
                    {t('branding.dragDrop')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {logoError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{logoError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <div className="rounded-3xl border border-primary/15 bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold text-foreground">{t('branding.previewTitle')}</p>
          <div className="mt-4 flex min-h-40 items-center justify-center rounded-2xl border border-primary/15 bg-secondary p-4">
            {logoPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreviewUrl} alt={t('branding.previewAlt')} className="max-h-24 max-w-full object-contain" />
            ) : savedLogoFileId ? (
              <div className="flex items-center gap-2 text-sm text-foreground/70">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                {t('branding.currentStored')}
              </div>
            ) : (
              <div className="text-center text-sm text-foreground/55">
                <p>{t('branding.noLogoYet')}</p>
                <p className="mt-1">{t('branding.colorsStillApplied')}</p>
              </div>
            )}
          </div>
          {logoFile ? (
            <div className="mt-3 flex items-center justify-between rounded-2xl border border-primary/15 px-3 py-2 text-sm text-foreground/70">
              <span className="truncate pr-3">{logoFile.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLogoFile(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ColorPicker
          id="primary_color"
          label={t('branding.primaryColor')}
          value={values.primary_color}
          onChange={(value) => setValue('primary_color', value, { shouldValidate: true, shouldDirty: true })}
          error={errors.primary_color?.message}
        />
        <ColorPicker
          id="accent_color"
          label={t('branding.accentColor')}
          value={values.accent_color}
          onChange={(value) => setValue('accent_color', value, { shouldValidate: true, shouldDirty: true })}
          error={errors.accent_color?.message}
        />
      </div>

      <div className="overflow-hidden rounded-3xl border border-primary/15 bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('branding.overviewTitle')}</p>
            <p className="text-xs text-foreground/55">{t('branding.overviewSubtitle')}</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-foreground/45" />
        </div>
        <div className="grid gap-3 bg-secondary p-5 md:grid-cols-4">
          <div className="rounded-2xl p-4 text-white" style={{ backgroundColor: values.primary_color }}>
            <p className="text-xs uppercase tracking-caps-xwide text-white/70">{t('branding.riskScore')}</p>
            <p className="mt-3 text-3xl font-semibold">84</p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-card p-4">
            <p className="text-xs uppercase tracking-caps-xwide text-foreground/45">{t('branding.criticalAlerts')}</p>
            <p className="mt-3 text-3xl font-semibold text-foreground">12</p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-card p-4">
            <p className="text-xs uppercase tracking-caps-xwide text-foreground/45">{t('branding.compliance')}</p>
            <p className="mt-3 text-3xl font-semibold text-foreground">91%</p>
          </div>
          <div className="rounded-2xl p-4 text-foreground" style={{ backgroundColor: values.accent_color }}>
            <p className="text-xs uppercase tracking-caps-xwide text-foreground/60">{t('branding.actionsMetric')}</p>
            <p className="mt-3 text-3xl font-semibold">7</p>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('actions.back')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={isSubmitting || isSkipping} onClick={() => void handleSkip()}>
            {isSkipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('actions.skip')}
          </Button>
          <Button type="submit" disabled={isSubmitting || isSkipping}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('actions.continue')}
          </Button>
        </div>
      </div>
    </form>
  );
}
