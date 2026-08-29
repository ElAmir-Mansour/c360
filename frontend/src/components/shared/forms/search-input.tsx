"use client";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  loading?: boolean;
  className?: string;
  /** Accessible label for the field; falls back to the placeholder. */
  "aria-label"?: string;
  /** Accessible label for the clear button. */
  clearLabel?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  debounceMs = 300,
  loading = false,
  className,
  "aria-label": ariaLabel,
  clearLabel = "Clear search",
}: SearchInputProps) {
  const [internal, setInternal] = useState(value);
  const debounced = useDebounce(internal, debounceMs);

  useEffect(() => {
    onChange(debounced);
  }, [debounced, onChange]);

  useEffect(() => {
    if (value !== internal) setInternal(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("relative", className)}>
      <div className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2" aria-hidden>
        {loading ? (
          <Spinner className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </div>
      <Input
        value={internal}
        onChange={(e) => setInternal(e.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-2xl border-border/70 bg-card/75 ps-10 pe-10 shadow-sm"
        onKeyDown={(e) => { if (e.key === "Escape") { setInternal(""); onChange(""); } }}
        aria-label={ariaLabel ?? placeholder}
      />
      {internal && (
        <button
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded-xl p-1 hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          onClick={() => { setInternal(""); onChange(""); }}
          aria-label={clearLabel}
          type="button"
        >
          <X className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      )}
    </div>
  );
}
