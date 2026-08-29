'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/components/providers/locale-provider';
import type { DeliveryStats } from '@/types/models';
import { format, parseISO } from 'date-fns';
import { CHART_COLORS, STATUS_COLORS } from '@/lib/design-tokens';

// Categorical palette for the "by type" donut — single source of truth so the
// series colours stay in lock-step with the rest of the platform's charts.
const TYPE_COLORS = CHART_COLORS;

// Delivery-outcome series map onto the semantic status ramp: sent = info,
// delivered = success, failed = error. Recharts writes these as SVG
// fill/stroke attrs (which cannot resolve `var(--x)`), so we consume the
// resolved token hex from design-tokens.ts.
const SERIES_COLORS: Record<'sent' | 'delivered' | 'failed', string> = {
  sent: STATUS_COLORS.info,
  delivered: STATUS_COLORS.success,
  failed: STATUS_COLORS.error,
};

interface DeliveryChartsProps {
  stats: DeliveryStats;
}

export function DeliveryCharts({ stats }: DeliveryChartsProps) {
  const t = useT('admin');
  const trendData = useMemo(() =>
    (stats.by_day ?? []).map((d) => ({
      ...d,
      date: format(parseISO(d.date), 'MMM d'),
    })),
    [stats.by_day],
  );

  const channelData = useMemo(() =>
    Object.entries(stats.by_channel ?? {}).map(([channel, data]) => ({
      channel: channel.replace('_', '-'),
      sent: data.sent,
      delivered: data.delivered,
      failed: data.failed,
    })),
    [stats.by_channel],
  );

  const typeData = useMemo(() =>
    Object.entries(stats.by_type ?? {}).map(([type, count]) => ({
      name: type,
      value: count,
    })),
    [stats.by_type],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Delivery Trend - Area Chart */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t('dch.trend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 12 }} />
                <YAxis className="text-xs" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stackId="1"
                  stroke={SERIES_COLORS.sent}
                  fill={SERIES_COLORS.sent}
                  fillOpacity={0.1}
                  name={t('dch.sent')}
                />
                <Area
                  type="monotone"
                  dataKey="delivered"
                  stackId="2"
                  stroke={SERIES_COLORS.delivered}
                  fill={SERIES_COLORS.delivered}
                  fillOpacity={0.2}
                  name={t('dch.delivered')}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stackId="3"
                  stroke={SERIES_COLORS.failed}
                  fill={SERIES_COLORS.failed}
                  fillOpacity={0.2}
                  name={t('dch.failed')}
                />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* By Channel - Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dch.byChannel')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="channel" type="category" tick={{ fontSize: 12 }} width={80} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="delivered" name={t('dch.delivered')} fill={SERIES_COLORS.delivered} radius={[0, 4, 4, 0]} />
                <Bar dataKey="failed" name={t('dch.failed')} fill={SERIES_COLORS.failed} radius={[0, 4, 4, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* By Type - Donut Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('dch.byType')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px] sm:h-[250px]">
            {typeData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('dch.noData')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={typeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {typeData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={TYPE_COLORS[index % TYPE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
