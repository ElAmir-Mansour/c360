'use client';

import dynamic from 'next/dynamic';
import { loader } from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Point the Monaco loader at the self-hosted asset route (no CDN — this app
// must work offline). Configured exactly once, guarded against re-config
// across modules and HMR reloads.
const globalScope = globalThis as typeof globalThis & {
  __clario360MonacoLoaderConfigured?: boolean;
};
if (!globalScope.__clario360MonacoLoaderConfigured) {
  loader.config({ paths: { vs: '/monaco/vs' } });
  globalScope.__clario360MonacoLoaderConfigured = true;
}

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  height?: number;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = 'plaintext',
  height = 160,
  readOnly = false,
  ariaLabel,
  className,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <div
      className={cn('rounded-md border overflow-hidden', className)}
      style={{ height }}
    >
      <MonacoEditor
        value={value}
        language={language}
        theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
        height={height}
        onChange={(next) => onChange(next ?? '')}
        loading={<Skeleton className="h-full w-full rounded-none" />}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'off',
          folding: false,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          readOnly,
          padding: { top: 8 },
          tabSize: 2,
          ariaLabel,
        }}
      />
    </div>
  );
}
