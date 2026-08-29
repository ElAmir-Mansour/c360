'use client';

import { Bell, CheckCircle, Shield, Workflow, Database, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNotificationsLabels, type NotificationsLabels } from './notifications-i18n';

interface NotificationEmptyProps {
  category?: string;
}

type EmptyCategory = keyof NotificationsLabels['empty'];

const EMPTY_ICONS: Record<EmptyCategory, LucideIcon> = {
  all: Bell,
  unread: CheckCircle,
  security: Shield,
  workflow: Workflow,
  data: Database,
  system: Settings,
  governance: Bell,
  legal: Bell,
};

export function NotificationEmpty({ category = 'all' }: NotificationEmptyProps) {
  const labels = useNotificationsLabels();
  const key: EmptyCategory = category in EMPTY_ICONS ? (category as EmptyCategory) : 'all';
  const Icon = EMPTY_ICONS[key];

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{labels.empty[key]}</p>
    </div>
  );
}
