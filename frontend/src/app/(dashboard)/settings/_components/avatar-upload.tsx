'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { UserAvatar } from '@/components/shared/user-avatar';
import { useAuth } from '@/hooks/use-auth';
import { showSuccess, showError, showBackendError } from '@/lib/toast';
import {
  fileToAvatarDataUrl,
  AvatarProcessingError,
  AVATAR_ACCEPT_ATTR,
  type AvatarErrorCode,
} from '../_lib/avatar-image';
import { useSettingsT } from '../_lib/settings-i18n';

/**
 * Profile-picture control for the Account Settings profile card. Picks an image,
 * downscales it in the browser, and persists it via `updateAvatar` — which stores
 * the full updated user, so the header chip, sidebar footer, and comment threads
 * all refresh at once. Falls back to initials when no picture is set.
 */
export function AvatarUpload() {
  const t = useSettingsT();
  const { user, updateAvatar, removeAvatar } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'idle' | 'uploading' | 'removing'>('idle');

  if (!user) return null;

  const errorMessage = (code: AvatarErrorCode): string => {
    switch (code) {
      case 'not-image':
        return t.photoErrorNotImage;
      case 'too-large':
        return t.photoErrorTooLarge;
      default:
        return t.photoErrorDecode;
    }
  };

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-choosing the same file still fires onChange.
    event.target.value = '';
    if (!file) return;

    setBusy('uploading');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await updateAvatar(dataUrl);
      showSuccess(t.photoUpdated);
    } catch (err) {
      if (err instanceof AvatarProcessingError) {
        showError(errorMessage(err.code));
      } else {
        showBackendError(err, t.photoUpdateFailed);
      }
    } finally {
      setBusy('idle');
    }
  };

  const onRemove = async () => {
    setBusy('removing');
    try {
      await removeAvatar();
      showSuccess(t.photoRemoved);
    } catch (err) {
      showBackendError(err, t.photoUpdateFailed);
    } finally {
      setBusy('idle');
    }
  };

  const isBusy = busy !== 'idle';

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <UserAvatar user={user} size="lg" className="h-16 w-16 text-xl" />
        {busy === 'uploading' ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Spinner className="h-5 w-5" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 space-y-2">
        <div>
          <p className="truncate text-sm font-medium">
            {user.first_name} {user.last_name}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => void onPick(e)}
            aria-label={user.avatar_url ? t.changePhoto : t.uploadPhoto}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {busy === 'uploading' ? (
              <Spinner className="me-2 h-4 w-4" />
            ) : (
              <Camera className="me-2 h-4 w-4" aria-hidden />
            )}
            {busy === 'uploading'
              ? t.uploadingPhoto
              : user.avatar_url
                ? t.changePhoto
                : t.uploadPhoto}
          </Button>

          {user.avatar_url ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => void onRemove()}
            >
              {busy === 'removing' ? (
                <Spinner className="me-2 h-4 w-4" />
              ) : (
                <Trash2 className="me-2 h-4 w-4" aria-hidden />
              )}
              {t.removePhoto}
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">{t.photoHint}</p>
      </div>
    </div>
  );
}
