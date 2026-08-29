'use client';

import type { CSSProperties, ReactNode } from 'react';
import { MoreVertical, Pencil, Code2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { VisusWidget } from '@/types/suites';
import { pickEnumLabel, useVisusEnumLabels, useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

interface WidgetShellProps {
  widget: VisusWidget;
  style?: CSSProperties;
  className?: string;
  onEdit: (widget: VisusWidget) => void;
  onDelete: (widget: VisusWidget) => void;
  onPreviewRaw: (widget: VisusWidget) => void;
  children: ReactNode;
}

/**
 * The framed card every rendered widget lives in: title/subtitle, a type badge,
 * and a hover-revealed actions menu (raw payload, edit, delete). Grid placement
 * comes in via `style`/`className` from the dashboard grid. The body (`children`)
 * owns its own loading / empty / error states.
 */
export function WidgetShell({
  widget,
  style,
  className,
  onEdit,
  onDelete,
  onPreviewRaw,
  children,
}: WidgetShellProps) {
  const t = useVisusWidgetChromeLabels();
  const enums = useVisusEnumLabels();
  return (
    <Card style={style} className={cn('group relative flex flex-col overflow-hidden', className)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-semibold">{widget.title}</CardTitle>
          {widget.subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{widget.subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="hidden text-overline sm:inline-flex">
            {pickEnumLabel(enums.widgetType, widget.type)}
          </Badge>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              aria-label={t.actionsAria(widget.title)}
            >
              <MoreVertical className="h-4 w-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onPreviewRaw(widget)}>
                <Code2 className="me-2 h-4 w-4" aria-hidden />
                {t.viewRawData}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(widget)}>
                <Pencil className="me-2 h-4 w-4" aria-hidden />
                {t.editWidget}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(widget)}
              >
                <Trash2 className="me-2 h-4 w-4" aria-hidden />
                {t.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0 text-sm">{children}</CardContent>
    </Card>
  );
}
