"use client";

/**
 * Quick-view chips for the Legal Service Desk list page (feature #3).
 *
 * Each chip toggles a single query-param filter via `useDataTable.setFilter`:
 *   - "My requests"       → requester_user_id = currentUserId
 *   - "Urgent"            → priority = 'urgent'
 *   - "Awaiting approval" → status = 'pending_provider_approval'
 *
 * A chip is "active" when its filter param currently holds its value; clicking an
 * active chip clears that param (passes `undefined`). The "My requests" chip is
 * hidden when there is no authenticated user id.
 */

import {
  AlertTriangle,
  Clock3,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useListExtraLabels } from "./list-extra-labels";

interface QuickView {
  id: string;
  label: string;
  key: string;
  value: string;
  icon: LucideIcon;
}

interface ListQuickFiltersProps {
  activeFilters: Record<string, string | string[]>;
  setFilter: (key: string, value: string | string[] | undefined) => void;
  currentUserId?: string;
}

function isActive(
  activeFilters: Record<string, string | string[]>,
  key: string,
  value: string,
): boolean {
  const current = activeFilters[key];
  if (Array.isArray(current)) return current.includes(value);
  return current === value;
}

export function ListQuickFilters({
  activeFilters,
  setFilter,
  currentUserId,
}: ListQuickFiltersProps) {
  const labels = useListExtraLabels();
  const t = labels.quickViews;

  const views: QuickView[] = [
    ...(currentUserId
      ? [
          {
            id: "mine",
            label: t.myRequests,
            key: "requester_user_id",
            value: currentUserId,
            icon: UserRound,
          },
        ]
      : []),
    {
      id: "urgent",
      label: t.urgent,
      key: "priority",
      value: "urgent",
      icon: AlertTriangle,
    },
    {
      id: "awaiting",
      label: t.awaitingApproval,
      key: "status",
      value: "pending_provider_approval",
      icon: Clock3,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {t.label}
      </span>
      {views.map((view) => {
        const active = isActive(activeFilters, view.key, view.value);
        const Icon = view.icon;
        return (
          <Button
            key={view.id}
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setFilter(view.key, active ? undefined : view.value)}
            aria-pressed={active}
            className={cn(
              "h-8 min-h-8 gap-1.5 rounded-full px-3 text-xs shadow-sm",
              active
                ? "border-primary/30 bg-primary/10 text-primary shadow-elevation-1"
                : "border-border/80 bg-background text-foreground hover:border-primary/25 hover:bg-primary/5 hover:shadow-elevation-1",
            )}
          >
            <Icon
              className={cn("h-3.5 w-3.5 shrink-0", !active && "opacity-65")}
              aria-hidden
            />
            {view.label}
          </Button>
        );
      })}
    </div>
  );
}
