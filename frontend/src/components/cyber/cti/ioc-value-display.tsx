'use client';

import { useMemo, useState } from 'react';
import { Copy, Expand, Globe, Mail, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { countryCodeToFlag } from '@/lib/cti-utils';
import { cn } from '@/lib/utils';

interface IOCValueDisplayProps {
  type?: string | null;
  value?: string | null;
  originCountryCode?: string | null;
  className?: string;
  showCopy?: boolean;
  copyable?: boolean;
}

function isHash(type?: string | null): boolean {
  return type === 'hash_sha256' || type === 'hash_md5';
}

function trunc(value: string, expanded: boolean): string {
  if (expanded || value.length <= 28) {
    return value;
  }
  return `${value.slice(0, 12)}…${value.slice(-12)}`;
}

export function IOCValueDisplay({
  type,
  value,
  originCountryCode,
  className,
  showCopy,
  copyable,
}: IOCValueDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const allowCopy = showCopy ?? copyable ?? true;

  const tone = useMemo(() => {
    switch (type) {
      case 'domain':
      case 'url':
      case 'email':
        return {
          icon: Globe,
          chip: 'text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40',
          body: 'text-rose-900 dark:text-rose-200',
          iconBg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400',
        };
      case 'ip':
        return {
          icon: Globe,
          chip: 'text-primary border-brand-teal-light/30 bg-brand-teal-light/10',
          body: 'text-foreground',
          iconBg: 'bg-brand-teal-light/15 text-brand-teal-light',
        };
      case 'cve':
        return {
          icon: ShieldAlert,
          chip: 'text-brand-gold-dark dark:text-brand-gold border-brand-gold/45 bg-brand-gold/15',
          body: 'text-foreground',
          iconBg: 'bg-brand-gold/20 text-brand-gold-dark dark:text-brand-gold',
        };
      default:
        return {
          icon: ShieldAlert,
          chip: 'text-primary border-primary/30 bg-primary/10',
          body: 'text-foreground',
          iconBg: 'bg-primary/15 text-primary',
        };
    }
  }, [type]);

  if (!value) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('IOC copied to clipboard');
    } catch {
      toast.error('Unable to copy IOC');
    }
  };

  const Icon = tone.icon;
  const renderedValue = isHash(type) ? trunc(value, expanded) : value;
  const emailDomain = type === 'email' && value.includes('@') ? value.split('@')[1] : null;

  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-primary/12 bg-card p-3', className)}>
      <div className={cn('mt-0.5 rounded-lg p-1.5', tone.iconBg)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {type && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('w-fit text-overline uppercase tracking-caps-xwide', tone.chip)}>
              {type.replaceAll('_', ' ')}
            </Badge>
            {type === 'ip' && originCountryCode && (
              <span className="text-xs text-muted-foreground">
                {countryCodeToFlag(originCountryCode)} {originCountryCode.toUpperCase()}
              </span>
            )}
          </div>
        )}
        {type === 'cve' ? (
          <a
            href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(value)}`}
            target="_blank"
            rel="noreferrer"
            className={cn('inline-flex items-center gap-1 break-all font-mono text-xs hover:underline', tone.body)}
          >
            {value}
          </a>
        ) : type === 'email' && emailDomain ? (
          <p className={cn('break-all font-mono text-xs', tone.body)}>
            {value.replace(emailDomain, '')}
            <span className="text-brand-gold-dark dark:text-brand-gold">@{emailDomain}</span>
          </p>
        ) : (
          <p className={cn('break-all font-mono text-xs', tone.body)}>{renderedValue}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isHash(type) && value.length > 28 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setExpanded((current) => !current)}
            aria-label={expanded ? 'Collapse IOC value' : 'Expand IOC value'}
          >
            <Expand className="h-4 w-4" />
          </Button>
        )}
        {allowCopy && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => void handleCopy()}
            aria-label="Copy IOC value"
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
