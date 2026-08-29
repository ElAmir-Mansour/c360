"use client";
import { useSyncExternalStore, memo } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { ar as arLocale, enUS } from "date-fns/locale";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface RelativeTimeProps {
  date: string | Date;
  className?: string;
}

const listeners = new Set<() => void>();
let nowTs = typeof window === "undefined" ? 0 : Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (typeof window === "undefined" || intervalId !== null) return;
  intervalId = setInterval(() => {
    if (document.hidden) return;
    nowTs = Date.now();
    listeners.forEach((cb) => cb());
  }, 60_000);
}

function subscribe(cb: () => void) {
  ensureTicker();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot() {
  return nowTs;
}

function getServerSnapshot() {
  return 0;
}

function useNowTick() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function RelativeTimeImpl({ date, className }: RelativeTimeProps) {
  useNowTick();
  const { locale } = useLocaleOrDefault();
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const isValid = dateObj instanceof Date && !isNaN(dateObj.getTime());

  if (!isValid) {
    return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  }

  const dateLocale = locale === "ar" ? arLocale : enUS;
  const relative = formatDistanceToNow(dateObj, { addSuffix: true, locale: dateLocale });
  const fullDate = format(
    dateObj,
    locale === "ar" ? "d MMM yyyy، HH:mm:ss 'UTC'" : "MMM d, yyyy 'at' HH:mm:ss 'UTC'",
    { locale: dateLocale },
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time dateTime={dateObj.toISOString()} className={cn("cursor-default text-sm", className)}>
            {relative}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          <p>{fullDate}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const RelativeTime = memo(RelativeTimeImpl);
