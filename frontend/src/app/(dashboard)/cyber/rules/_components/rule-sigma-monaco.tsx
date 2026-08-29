'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

loader.config({ paths: { vs: '/monaco/vs' } });

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface RuleSigmaMonacoProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: number;
}

const SIGMA_THEME = 'clario-sigma';
const SIGMA_THEME_DARK = 'clario-sigma-dark';
const SIGMA_LANGUAGE = 'sigma';
let sigmaLanguageRegistered = false;
let sigmaThemeRegistered = false;

function configureSigmaEditor(monaco: typeof import('monaco-editor')) {
  if (!sigmaLanguageRegistered) {
    monaco.languages.register({ id: SIGMA_LANGUAGE, aliases: ['Sigma YAML'] });
    monaco.languages.setLanguageConfiguration(SIGMA_LANGUAGE, {
      comments: { lineComment: '#' },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });
    monaco.languages.setMonarchTokensProvider(SIGMA_LANGUAGE, {
      tokenizer: {
        root: [
          [/\b(title|id|status|description|references|author|date|tags|logsource|detection|condition|timeframe|level|fields|falsepositives)\b/, 'keyword'],
          [/[A-Za-z0-9_.-]+(?=\s*:)/, 'type'],
          [/".*?"/, 'string'],
          [/'.*?'/, 'string'],
          [/\b(true|false|null)\b/, 'constant'],
          [/-?\d+(\.\d+)?/, 'number'],
          [/#.*$/, 'comment'],
        ],
      },
    });
    sigmaLanguageRegistered = true;
  }

  if (!sigmaThemeRegistered) {
    monaco.editor.defineTheme(SIGMA_THEME, {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '0f766e', fontStyle: 'bold' },
        { token: 'type', foreground: '1d4ed8' },
        { token: 'string', foreground: '9a3412' },
        { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
        { token: 'number', foreground: '7c3aed' },
      ],
      colors: {
        'editor.background': '#f8fbf8',
        'editorLineNumber.foreground': '#94a3b8',
        'editorIndentGuide.background1': '#e2e8f0',
      },
    });
    monaco.editor.defineTheme(SIGMA_THEME_DARK, {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '2dd4bf', fontStyle: 'bold' },
        { token: 'type', foreground: '93c5fd' },
        { token: 'string', foreground: 'fdba74' },
        { token: 'comment', foreground: '9ca3af', fontStyle: 'italic' },
        { token: 'number', foreground: 'c4b5fd' },
      ],
      colors: {
        'editor.background': '#0b1410',
        'editorLineNumber.foreground': '#64748b',
        'editorIndentGuide.background1': '#1e293b',
      },
    });
    sigmaThemeRegistered = true;
  }
}

export function RuleSigmaMonaco({
  value,
  onChange,
  readOnly = false,
  height = 420,
}: RuleSigmaMonacoProps) {
  const { resolvedTheme } = useTheme();
  const sigmaTheme = resolvedTheme === 'dark' ? SIGMA_THEME_DARK : SIGMA_THEME;

  return (
    <div className="overflow-hidden rounded-3xl surface-card">
      <MonacoEditor
        language={SIGMA_LANGUAGE}
        value={value}
        theme={sigmaTheme}
        beforeMount={configureSigmaEditor}
        onMount={(editorInstance: editor.IStandaloneCodeEditor, monaco) => {
          configureSigmaEditor(monaco);
          monaco.editor.setTheme(sigmaTheme);
          editorInstance.updateOptions({
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
          });
        }}
        onChange={(next) => onChange?.(next ?? '')}
        height={height}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          automaticLayout: true,
        }}
      />
    </div>
  );
}
