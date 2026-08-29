'use client';

import { PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LaunchButtonProps {
  disabled?: boolean;
  onClick: () => void;
  /** Localized button label. Defaults to the English string for legacy callers. */
  label?: string;
}

export function LaunchButton({ disabled, onClick, label = 'Launch Notebook' }: LaunchButtonProps) {
  return (
    <Button onClick={onClick} disabled={disabled}>
      <PlayCircle className="me-2 h-4 w-4" />
      {label}
    </Button>
  );
}
