"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";

interface JsonViewerProps {
  data: Record<string, unknown> | null;
  label?: string;
  defaultCollapsed?: boolean;
}

function JsonValue({ value, depth }: { value: unknown; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="text-status-pending">
        {String(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return (
      <span className="text-status-info">{value}</span>
    );
  }

  if (typeof value === "string") {
    return (
      <span className="text-primary dark:text-primary">
        &quot;{value}&quot;
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="inline-flex items-center hover:opacity-70"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span className="text-muted-foreground ms-0.5">
            [{value.length}]
          </span>
        </button>
        {!collapsed && (
          <div className="ms-4 border-s border-border ps-2">
            {value.map((item, i) => (
              <div key={i} className="py-0.5">
                <span className="text-muted-foreground me-1">{i}:</span>
                <JsonValue value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">{"{}"}</span>;
    }

    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="inline-flex items-center hover:opacity-70"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span className="text-muted-foreground ms-0.5">
            {"{"}
            {entries.length}
            {"}"}
          </span>
        </button>
        {!collapsed && (
          <div className="ms-4 border-s border-border ps-2">
            {entries.map(([key, val]) => (
              <div key={key} className="py-0.5">
                <span className="text-status-error font-medium">
                  {key}
                </span>
                <span className="text-muted-foreground">: </span>
                <JsonValue value={val} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

export function JsonViewer({
  data,
  label,
  defaultCollapsed = false,
}: JsonViewerProps) {
  const t = useT("admin");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground italic">{t("jv.noData")}</p>
    );
  }

  return (
    <div className="rounded-md border bg-muted/20 overflow-hidden">
      {label && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground w-full hover:bg-muted/50 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {label}
        </button>
      )}
      <div
        className={cn(
          "px-3 py-2 text-xs font-mono overflow-auto max-h-96",
          collapsed && label && "hidden"
        )}
      >
        <JsonValue value={data} depth={0} />
      </div>
    </div>
  );
}
