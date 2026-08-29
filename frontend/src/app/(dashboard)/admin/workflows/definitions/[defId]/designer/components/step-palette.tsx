'use client';

import {
  CheckCircle2,
  Eye,
  ClipboardList,
  Bell,
  GitBranch,
  GitMerge,
  Timer,
  Globe,
  Code2,
  Workflow,
  CircleDot,
  UserCheck,
} from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { WorkflowStepType } from '@/types/models';

interface PaletteItem {
  type: WorkflowStepType;
  /** English label. */
  label: string;
  /** Arabic label (shown when the active locale is `ar`). */
  labelAr: string;
  icon: React.ElementType;
}

interface PaletteGroup {
  label: string;
  labelAr: string;
  items: PaletteItem[];
}

const groups: PaletteGroup[] = [
  {
    label: 'Human Tasks',
    labelAr: 'المهام البشرية',
    items: [
      { type: 'approval', label: 'Approval', labelAr: 'موافقة', icon: CheckCircle2 },
      {
        type: 'approval_chain',
        label: 'Approval Chain',
        labelAr: 'سلسلة الموافقات',
        icon: UserCheck,
      },
      { type: 'review', label: 'Review', labelAr: 'مراجعة', icon: Eye },
      { type: 'task', label: 'Task', labelAr: 'مهمة', icon: ClipboardList },
    ],
  },
  {
    label: 'Automation',
    labelAr: 'الأتمتة',
    items: [
      { type: 'notification', label: 'Notification', labelAr: 'إشعار', icon: Bell },
      { type: 'webhook', label: 'Webhook', labelAr: 'ويب هوك', icon: Globe },
      { type: 'script', label: 'Script', labelAr: 'برنامج نصي', icon: Code2 },
      { type: 'sub_workflow', label: 'Sub-workflow', labelAr: 'سير عمل فرعي', icon: Workflow },
    ],
  },
  {
    label: 'Flow Control',
    labelAr: 'التحكم في المسار',
    items: [
      { type: 'condition', label: 'Condition', labelAr: 'شرط', icon: GitBranch },
      { type: 'parallel_gateway', label: 'Parallel Fork', labelAr: 'تفرع متوازٍ', icon: GitMerge },
      { type: 'join_gateway', label: 'Parallel Join', labelAr: 'دمج متوازٍ', icon: GitMerge },
      { type: 'delay', label: 'Delay', labelAr: 'تأخير', icon: Timer },
      { type: 'end', label: 'End', labelAr: 'نهاية', icon: CircleDot },
    ],
  },
];

interface StepPaletteProps {
  onAddStep: (type: WorkflowStepType) => void;
}

export function StepPalette({ onAddStep }: StepPaletteProps) {
  const { locale, direction } = useLocaleOrDefault();
  const isAr = locale === 'ar';

  return (
    <div className="w-56 border-e bg-muted/30 overflow-y-auto" dir={direction}>
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">
          {isAr ? 'لوحة الخطوات' : 'Step Palette'}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isAr ? 'اسحب أو انقر لإضافة خطوات' : 'Drag or click to add steps'}
        </p>
      </div>
      <div className="p-2 space-y-3">
        {groups.map((group) => (
          <div key={group.label}>
            <h4 className="text-overline font-semibold uppercase text-muted-foreground px-2 mb-1">
              {isAr ? group.labelAr : group.label}
            </h4>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-start"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('step-type', item.type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddStep(item.type)}
                  type="button"
                  title={isAr ? item.labelAr : item.label}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{isAr ? item.labelAr : item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
