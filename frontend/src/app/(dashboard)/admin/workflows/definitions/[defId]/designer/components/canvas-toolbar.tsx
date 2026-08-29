'use client';

import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  LayoutGrid,
  Save,
  Upload,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/shared/help-tip';
import { useT } from '@/components/providers/locale-provider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CanvasToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  readOnly: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  isDraft: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  onAutoLayout: () => void;
  onSave: () => void;
  onPublish: () => void;
}

export function CanvasToolbar({
  canUndo,
  canRedo,
  zoom,
  readOnly,
  isSaving,
  isPublishing,
  isDraft,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  onAutoLayout,
  onSave,
  onPublish,
}: CanvasToolbarProps) {
  const t = useT('admin');
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 border-b px-3 py-1.5 bg-background">
        {!readOnly && (
          <>
            <ToolbarButton
              icon={Undo2}
              label={t('ctb.undo')}
              onClick={onUndo}
              disabled={!canUndo}
            />
            <ToolbarButton
              icon={Redo2}
              label={t('ctb.redo')}
              onClick={onRedo}
              disabled={!canRedo}
            />
            <div className="w-px h-5 bg-border mx-1" />
          </>
        )}

        <ToolbarButton icon={ZoomOut} label={t('ctb.zoomOut')} onClick={onZoomOut} />
        <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton icon={ZoomIn} label={t('ctb.zoomIn')} onClick={onZoomIn} />
        <ToolbarButton
          icon={Maximize}
          label={t('ctb.fit')}
          onClick={onFitToScreen}
        />
        <HelpTip
          className="ms-1"
          title={{ en: 'Designing a workflow', ar: 'تصميم سير العمل' }}
          content={{
            en: 'Add steps to the canvas and connect them to define the flow. Save Draft keeps your changes without affecting running instances; Publish creates a new executable version. Undo/redo, zoom, and auto-layout live in this toolbar.',
            ar: 'أضف الخطوات إلى اللوحة واربط بينها لتحديد مسار العمل. يحفظ «حفظ المسودة» تغييراتك دون التأثير على النسخ قيد التشغيل، بينما ينشئ «نشر» إصدارًا جديدًا قابلًا للتنفيذ. تجد التراجع والإعادة والتكبير والتخطيط التلقائي في هذا الشريط.',
          }}
        />

        {!readOnly && (
          <>
            <ToolbarButton
              icon={LayoutGrid}
              label={t('ctb.autoLayout')}
              onClick={onAutoLayout}
            />
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              disabled={isSaving}
              className="h-7 text-xs"
            >
              {isSaving ? (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="me-1 h-3.5 w-3.5" />
              )}
              {t('ctb.saveDraft')}
            </Button>
            {isDraft && (
              <Button
                size="sm"
                onClick={onPublish}
                disabled={isPublishing}
                className="h-7 text-xs"
              >
                {isPublishing ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="me-1 h-3.5 w-3.5" />
                )}
                {t('ctb.publish')}
              </Button>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
