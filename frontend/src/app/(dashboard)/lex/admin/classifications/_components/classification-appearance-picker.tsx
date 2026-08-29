'use client';

import { Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CLASSIFICATION_COLORS,
  CLASSIFICATION_ICONS,
  getClassificationIcon,
} from '../../_lib/classification-helpers';
import { useClassificationLabels } from '../../_lib/admin-labels';

interface Props {
  value: { color?: string; icon?: string };
  onChange: (next: { color?: string; icon?: string }) => void;
  disabled?: boolean;
}

export function ClassificationAppearancePicker({ value, onChange, disabled }: Props) {
  const ap = useClassificationLabels().appearancePicker;
  const selectedColor = value.color;
  const selectedIcon = value.icon;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={ap.color} className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{ap.color}</p>
        <div className="flex flex-wrap items-center gap-2">
          {CLASSIFICATION_COLORS.map((color) => {
            const active = selectedColor === color.key;
            return (
              <button
                key={color.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={ap.colorLabel(color.label)}
                title={color.label}
                disabled={disabled}
                onClick={() => onChange({ ...value, color: color.key })}
                className={cn(
                  'h-7 w-7 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  color.className,
                  active ? 'border-foreground ring-2 ring-ring ring-offset-2' : 'border-border/60',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              />
            );
          })}
          <button
            type="button"
            aria-label={ap.clearColor}
            disabled={disabled || !selectedColor}
            onClick={() => onChange({ ...value, color: undefined })}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border/60 text-muted-foreground transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              (disabled || !selectedColor) && 'cursor-not-allowed opacity-50',
            )}
          >
            <Ban className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div role="radiogroup" aria-label={ap.icon} className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{ap.icon}</p>
        <div className="flex flex-wrap items-center gap-2">
          {CLASSIFICATION_ICONS.map((iconToken) => {
            const Icon = getClassificationIcon(iconToken.key);
            const active = selectedIcon === iconToken.key;
            return (
              <button
                key={iconToken.key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={ap.iconLabel(iconToken.label)}
                title={iconToken.label}
                disabled={disabled}
                onClick={() => onChange({ ...value, icon: iconToken.key })}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:text-foreground',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            );
          })}
          <button
            type="button"
            aria-label={ap.clearIcon}
            disabled={disabled || !selectedIcon}
            onClick={() => onChange({ ...value, icon: undefined })}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              (disabled || !selectedIcon) && 'cursor-not-allowed opacity-50',
            )}
          >
            <Ban className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
