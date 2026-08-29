import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";

interface TimelineItem {
  id: string;
  icon?: LucideIcon;
  title: string;
  description?: string;
  timestamp?: string;
  variant?: "default" | "success" | "warning" | "error";
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const variantClasses = {
  default: "bg-muted text-muted-foreground",
  success: "bg-primary/15 text-primary dark:bg-primary/30 dark:text-primary",
  warning: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  error: "bg-error-100 text-error-500 dark:bg-error-700/30 dark:text-error-300",
};

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {items.map((item, idx) => {
        const Icon = item.icon;
        const isLast = idx === items.length - 1;
        return (
          <div key={item.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", variantClasses[item.variant ?? "default"])}>
                {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : <div className="h-2 w-2 rounded-full bg-current" />}
              </div>
              {!isLast && <div className="mt-1 w-px flex-1 bg-border" aria-hidden />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{item.title}</p>
              {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
              {item.timestamp && <p className="text-xs text-muted-foreground mt-1">{item.timestamp}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
