'use client';

import { Eye, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useNotificationsLabels } from './notifications-i18n';

interface NotificationActionsProps {
  isUnread: boolean;
  onMarkRead: () => void;
  onDelete: () => void;
}

export function NotificationActions({
  isUnread,
  onMarkRead,
  onDelete,
}: NotificationActionsProps) {
  const labels = useNotificationsLabels();
  return (
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {isUnread && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMarkRead();
              }}
              aria-label={labels.actions.markAsRead}
              className="rounded p-1 hover:bg-muted"
              type="button"
            >
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{labels.actions.markAsRead}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={labels.actions.deleteNotification}
            className="rounded p-1 hover:bg-muted"
            type="button"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{labels.actions.deleteNotification}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
