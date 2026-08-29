'use client';

import { Badge } from '@/components/ui/badge';
import { useUebaLabels } from '../_lib/ueba-i18n';

export function SourceIPList({
  expectedIPs,
  actualIPs,
}: {
  expectedIPs: string[];
  actualIPs: string[];
}) {
  const t = useUebaLabels();
  const expected = new Set(expectedIPs.map((item) => item.toLowerCase()));

  return (
    <div className="space-y-2">
      {actualIPs.map((ip) => (
        <div key={ip} className="flex items-center justify-between rounded-lg border p-3">
          <span className="font-mono text-xs">{ip}</span>
          <Badge variant={expected.has(ip.toLowerCase()) ? 'outline' : 'warning'}>
            {expected.has(ip.toLowerCase()) ? t.ipKnown : t.ipUnknown}
          </Badge>
        </div>
      ))}
      {actualIPs.length === 0 && <p className="text-sm text-muted-foreground">{t.sourceIpEmpty}</p>}
    </div>
  );
}
