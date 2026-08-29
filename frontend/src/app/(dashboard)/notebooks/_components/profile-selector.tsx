'use client';

import { Bot, Brain, CheckCircle2, Cpu, HardDrive, MemoryStick, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { NotebookProfile } from '@/lib/notebooks';
import { useNotebooksLabels } from '../_lib/notebooks-i18n';

const iconMap = {
  'soc-analyst': ShieldAlert,
  'data-scientist': Brain,
  'spark-connected': Sparkles,
  admin: Bot,
} as const;

interface ProfileSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: NotebookProfile[];
  busy: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  onSelect: (profile: NotebookProfile) => void;
}

export function ProfileSelector({
  open,
  onOpenChange,
  profiles,
  busy,
  disabled = false,
  unavailableReason,
  onSelect,
}: ProfileSelectorProps) {
  const t = useNotebooksLabels();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t.profiles.selectorTitle}</DialogTitle>
          <DialogDescription>{t.profiles.selectorDescription}</DialogDescription>
        </DialogHeader>
        {disabled ? (
          <Alert variant="warning">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              {t.profiles.selectorUnavailable}
              {unavailableReason ? ` ${unavailableReason}` : ''}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {profiles.map((profile) => {
            const Icon = iconMap[profile.slug as keyof typeof iconMap] ?? Bot;
            return (
              <Card key={profile.slug}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{profile.display_name}</CardTitle>
                        {profile.default ? <Badge variant="success">{t.profiles.defaultBadge}</Badge> : null}
                        {profile.spark_enabled ? <Badge variant="outline">{t.profiles.sparkBadge}</Badge> : null}
                      </div>
                      <CardDescription className="mt-2 leading-6">{profile.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <ProfileMetric icon={Cpu} label={t.profiles.cpu} value={profile.cpu} />
                    <ProfileMetric icon={MemoryStick} label={t.profiles.memoryLabel} value={profile.memory} />
                    <ProfileMetric icon={HardDrive} label={t.profiles.storageLabel} value={profile.storage} />
                  </div>
                  <Button className="w-full" disabled={busy || disabled} onClick={() => onSelect(profile)}>
                    <CheckCircle2 className="me-2 h-4 w-4" />
                    {t.profiles.launchProfile(profile.display_name)}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProfileMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="font-semibold uppercase tracking-caps-wide">{label}</span>
      </div>
      <p className="mt-1 font-medium text-foreground">
        {label}: {value}
      </p>
    </div>
  );
}
