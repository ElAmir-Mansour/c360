'use client';

import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Eraser,
  ExternalLink,
  FileImage,
  PenLine,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { enterpriseApi } from '@/lib/enterprise';
import { showBackendError, showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useSettingsT } from '../_lib/settings-i18n';

const SIGNATURE_PROFILE_QUERY_KEY = ['lex-signature-profile-me'] as const;
const MAX_SIGNATURE_IMAGE_BYTES = 512 * 1024;
const ACCEPTED_SIGNATURE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);
const SIGNATURE_IMAGE_ACCEPT = Array.from(ACCEPTED_SIGNATURE_IMAGE_TYPES).join(',');
const LEX_SIGNATURE_ACCESS_PERMISSIONS = [
  'lex:read',
  'lex:contract:view',
  'lex:document:view',
  'lex:contract:edit',
];

export function SignatureProfileSection() {
  const t = useSettingsT();
  const queryClient = useQueryClient();
  const { user, isHydrated, hasAnyPermission } = useAuth();
  const canUseSignatures = hasAnyPermission(LEX_SIGNATURE_ACCESS_PERMISSIONS);
  const [typedName, setTypedName] = useState('');
  const [initials, setInitials] = useState('');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [initialsImage, setInitialsImage] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: SIGNATURE_PROFILE_QUERY_KEY,
    queryFn: () => enterpriseApi.lex.getMySignatureProfile(),
    enabled: isHydrated && Boolean(user) && canUseSignatures,
  });

  useEffect(() => {
    const profile = profileQuery.data;
    setTypedName(profile?.typed_name ?? '');
    setInitials(profile?.initials ?? '');
    setSignatureImage(profile?.signature_image ?? null);
    setInitialsImage(profile?.initials_image ?? null);
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.upsertMySignatureProfile({
        typed_name: typedName,
        initials,
        signature_image: signatureImage,
        initials_image: initialsImage,
        consent_version: 'native-v1',
      }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(SIGNATURE_PROFILE_QUERY_KEY, profile);
      showSuccess(t.signatureSaved);
      await queryClient.invalidateQueries({ queryKey: SIGNATURE_PROFILE_QUERY_KEY });
    },
    onError: (error) => showBackendError(error, t.signatureSaveError),
  });

  const deleteMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.deleteMySignatureProfile(),
    onSuccess: async () => {
      setTypedName('');
      setInitials('');
      setSignatureImage(null);
      setInitialsImage(null);
      queryClient.setQueryData(SIGNATURE_PROFILE_QUERY_KEY, null);
      showSuccess(t.signatureDeleted);
      await queryClient.invalidateQueries({ queryKey: SIGNATURE_PROFILE_QUERY_KEY });
    },
    onError: (error) => showBackendError(error, t.signatureDeleteError),
  });

  if (!isHydrated || !user || !canUseSignatures) {
    return null;
  }

  const isBusy = saveMutation.isPending || deleteMutation.isPending;
  const hasProfile = Boolean(profileQuery.data);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typedName.trim() && !signatureImage) {
      showError(t.signatureEmptyProfile);
      return;
    }
    saveMutation.mutate();
  };

  const handleImageUpload =
    (setter: (value: string | null) => void) =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      if (!ACCEPTED_SIGNATURE_IMAGE_TYPES.has(file.type)) {
        showError(t.signatureUnsupportedFile);
        return;
      }
      if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
        showError(t.signatureUploadTooLarge);
        return;
      }
      try {
        setter(await readFileAsDataURL(file));
      } catch {
        showError(t.signatureUnsupportedFile);
      }
    };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{t.signatureProfile}</CardTitle>
            <CardDescription>{t.signatureProfileDesc}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/lex/signatures">
              <ExternalLink className="me-1.5 h-4 w-4" aria-hidden />
              {t.signatureOpenSignatures}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {profileQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            {t.loadingPreferences}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            {profileQuery.isError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertDescription>{t.signatureLoadError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signature-profile-typed-name">{t.signatureTypedName}</Label>
                <Input
                  id="signature-profile-typed-name"
                  value={typedName}
                  maxLength={160}
                  onChange={(event) => setTypedName(event.target.value)}
                  placeholder={t.signatureTypedNamePlaceholder}
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signature-profile-initials">{t.signatureInitials}</Label>
                <Input
                  id="signature-profile-initials"
                  value={initials}
                  maxLength={16}
                  onChange={(event) => setInitials(event.target.value.toUpperCase())}
                  placeholder={t.signatureInitialsPlaceholder}
                  disabled={isBusy}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SignatureAssetEditor
                title={t.signatureImage}
                previewLabel={t.signaturePreview}
                emptyLabel={t.signatureNoImage}
                uploadLabel={t.signatureUploadSignature}
                drawLabel={t.signatureDrawSignature}
                useDrawingLabel={t.signatureUseDrawing}
                clearDrawingLabel={t.signatureClearDrawing}
                removeImageLabel={t.signatureRemoveImage}
                inputId="signature-profile-signature-upload"
                image={signatureImage}
                disabled={isBusy}
                onUpload={handleImageUpload(setSignatureImage)}
                onImageChange={setSignatureImage}
              />
              <SignatureAssetEditor
                title={t.signatureInitialsImage}
                previewLabel={t.signaturePreview}
                emptyLabel={t.signatureNoImage}
                uploadLabel={t.signatureUploadInitials}
                drawLabel={t.signatureDrawInitials}
                useDrawingLabel={t.signatureUseDrawing}
                clearDrawingLabel={t.signatureClearDrawing}
                removeImageLabel={t.signatureRemoveImage}
                inputId="signature-profile-initials-upload"
                image={initialsImage}
                disabled={isBusy}
                onUpload={handleImageUpload(setInitialsImage)}
                onImageChange={setInitialsImage}
              />
            </div>

            <p className="text-xs leading-5 text-muted-foreground">{t.signatureConsent}</p>

            <div className="flex flex-wrap justify-end gap-2">
              {hasProfile ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  disabled={isBusy}
                >
                  {deleteMutation.isPending ? (
                    <Spinner className="me-2 h-4 w-4" size="sm" />
                  ) : (
                    <Trash2 className="me-2 h-4 w-4" aria-hidden />
                  )}
                  {t.signatureDelete}
                </Button>
              ) : null}
              <Button type="submit" size="sm" disabled={isBusy}>
                {saveMutation.isPending ? (
                  <Spinner className="me-2 h-4 w-4" size="sm" />
                ) : (
                  <Save className="me-2 h-4 w-4" aria-hidden />
                )}
                {saveMutation.isPending ? t.signatureSaving : t.signatureSave}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SignatureAssetEditor({
  title,
  previewLabel,
  emptyLabel,
  uploadLabel,
  drawLabel,
  useDrawingLabel,
  clearDrawingLabel,
  removeImageLabel,
  inputId,
  image,
  disabled,
  onUpload,
  onImageChange,
}: {
  title: string;
  previewLabel: string;
  emptyLabel: string;
  uploadLabel: string;
  drawLabel: string;
  useDrawingLabel: string;
  clearDrawingLabel: string;
  removeImageLabel: string;
  inputId: string;
  image: string | null;
  disabled: boolean;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onImageChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <label htmlFor={inputId} className={cn('cursor-pointer', disabled && 'pointer-events-none opacity-60')}>
              <Upload className="me-1.5 h-4 w-4" aria-hidden />
              {uploadLabel}
            </label>
          </Button>
          {image ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onImageChange(null)}
              disabled={disabled}
            >
              <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
              {removeImageLabel}
            </Button>
          ) : null}
        </div>
        <Input
          id={inputId}
          type="file"
          accept={SIGNATURE_IMAGE_ACCEPT}
          className="sr-only"
          onChange={onUpload}
          disabled={disabled}
        />
      </div>

      <div className="rounded-md border bg-background p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{previewLabel}</p>
        <div className="flex h-28 items-center justify-center overflow-hidden rounded border border-dashed bg-muted/20 p-2">
          {image ? (
            <img src={image} alt={title} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileImage className="h-4 w-4" aria-hidden />
              {emptyLabel}
            </div>
          )}
        </div>
      </div>

      <SignatureDrawingPad
        label={drawLabel}
        useDrawingLabel={useDrawingLabel}
        clearDrawingLabel={clearDrawingLabel}
        disabled={disabled}
        onUseDrawing={onImageChange}
      />
    </div>
  );
}

function SignatureDrawingPad({
  label,
  useDrawingLabel,
  clearDrawingLabel,
  disabled,
  onUseDrawing,
}: {
  label: string;
  useDrawingLabel: string;
  clearDrawingLabel: string;
  disabled: boolean;
  onUseDrawing: (value: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    clearCanvas(canvasRef.current);
  }, []);

  const pointForEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) {
      return;
    }
    drawingRef.current = true;
    lastPointRef.current = pointForEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) {
      return;
    }
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    const lastPoint = lastPointRef.current;
    const nextPoint = pointForEvent(event);
    if (!context || !lastPoint) {
      return;
    }
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    lastPointRef.current = nextPoint;
    setHasStroke(true);
  };

  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clear = () => {
    clearCanvas(canvasRef.current);
    setHasStroke(false);
    onUseDrawing(null);
  };

  const useDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) {
      return;
    }
    onUseDrawing(canvas.toDataURL('image/png'));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={useDrawing} disabled={disabled || !hasStroke}>
            <PenLine className="me-1.5 h-4 w-4" aria-hidden />
            {useDrawingLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled}>
            <Eraser className="me-1.5 h-4 w-4" aria-hidden />
            {clearDrawingLabel}
          </Button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={720}
        height={180}
        className="h-36 w-full touch-none rounded-md border bg-white"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        aria-label={label}
      />
    </div>
  );
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) {
    return;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Invalid file result'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
