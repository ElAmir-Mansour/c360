'use client';

import { useState } from 'react';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { RelativeTime } from '@/components/shared/relative-time';
import { apiGet, apiDelete } from '@/lib/api';
import { isApiError } from '@/types/api';
import { useSettingsT } from '../_lib/settings-i18n';

interface Session {
  id: string;
  user_agent: string;
  ip_address: string;
  last_active_at: string;
  created_at: string;
  is_current: boolean;
}

type DeviceKind = 'mobile' | 'tablet' | 'desktop';

function parseDevice(userAgent: string): { icon: typeof Monitor; kind: DeviceKind } {
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return { icon: Smartphone, kind: 'mobile' };
  }
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return { icon: Tablet, kind: 'tablet' };
  }
  return { icon: Monitor, kind: 'desktop' };
}

/**
 * Browser names are product/brand identifiers and are intentionally left
 * untranslated; only the generic fallback ("Browser") is localized.
 */
function parseBrowser(userAgent: string, genericLabel: string): string {
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Edg')) return 'Edge';
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Safari')) return 'Safari';
  return genericLabel;
}

export function SessionsSection() {
  const t = useSettingsT();
  const queryClient = useQueryClient();
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  const deviceLabel = (kind: DeviceKind) =>
    kind === 'mobile' ? t.deviceMobile : kind === 'tablet' ? t.deviceTablet : t.deviceDesktop;

  const { data: sessions, isLoading } = useQuery<Session[]>({
    queryKey: ['my-sessions'],
    queryFn: () => apiGet<Session[]>('/api/v1/users/me/sessions'),
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['my-sessions'] });

  const handleRevoke = async (sessionId: string) => {
    try {
      await apiDelete(`/api/v1/users/me/sessions/${sessionId}`);
      toast.success(t.sessionRevoked);
      refetch();
    } catch (err) {
      const msg = isApiError(err) ? err.message : t.failedRevokeSession;
      toast.error(msg);
    }
  };

  const handleRevokeAll = async () => {
    try {
      await apiDelete('/api/v1/users/me/sessions?exclude_current=true');
      toast.success(t.allOtherSessionsRevoked);
      refetch();
    } catch (err) {
      const msg = isApiError(err) ? err.message : t.failedRevokeSessions;
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.activeSessions}</CardTitle>
        <CardDescription>
          {t.activeSessionsDesc}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t.sessionsBeingSetUp}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {sessions.map((session) => {
                const device = parseDevice(session.user_agent);
                const DeviceIcon = device.icon;
                const browser = parseBrowser(session.user_agent, t.browserGeneric);
                return (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                  >
                    <DeviceIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{browser} / {deviceLabel(device.kind)}</p>
                        {session.is_current && (
                          <Badge variant="outline" className="text-xs">{t.current}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {session.ip_address} ·{' '}
                        <RelativeTime date={session.last_active_at} />
                      </p>
                    </div>
                    {!session.is_current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => handleRevoke(session.id)}
                      >
                        {t.revoke}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {sessions.filter((s) => !s.is_current).length > 0 && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeAllOpen(true)}
                >
                  {t.revokeAllOtherSessions}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={revokeAllOpen}
        onOpenChange={setRevokeAllOpen}
        title={t.revokeAllOtherSessionsTitle}
        description={t.revokeAllOtherSessionsDesc}
        confirmLabel={t.revokeAll}
        variant="destructive"
        onConfirm={handleRevokeAll}
      />
    </Card>
  );
}
