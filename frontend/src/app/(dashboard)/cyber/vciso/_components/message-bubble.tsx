'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LayoutDashboard,
  ShieldAlert,
  User2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { KpiCard } from '@/components/shared/kpi-card';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { LineChart } from '@/components/shared/charts/line-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { cn, formatDateTime } from '@/lib/utils';
import type { VCISOConversationMessage, VCISOSuggestedAction } from '@/types/cyber';
import { MessageDiagnostics } from './message-diagnostics';
import { useVcisoChatLabels, type VcisoChatLabels } from '../_lib/vciso-i18n';

// ── Props ────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: VCISOConversationMessage;
  onAction: (action: VCISOSuggestedAction) => void;
}

// ── Main component ───────────────────────────────────────────────────────────

export function MessageBubble({ message, onAction }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-auth-dark-raised text-white">
          {message.role === 'system' ? <ShieldAlert className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      )}
      <div className={cn('max-w-[90%] space-y-2', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-3xl border px-4 py-3 shadow-sm',
            isUser ? 'border-primary/20 bg-primary text-primary-foreground' : 'border-border bg-card',
          )}
        >
          <div className="text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {isUser ? (
              <span className="whitespace-pre-wrap">{message.content}</span>
            ) : (
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  ul: ({ children }) => <ul className="mb-2 ms-4 list-disc space-y-1 last:mb-0">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 ms-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  code: ({ children }) => (
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono">{children}</code>
                  ),
                  pre: ({ children }) => (
                    <pre className="mb-2 overflow-x-auto rounded-lg bg-secondary p-3 text-xs last:mb-0">{children}</pre>
                  ),
                  h1: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
                  h2: ({ children }) => <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children}</h3>,
                  h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>,
                  a: ({ href, children }) => (
                    <a href={href} className="text-primary underline hover:no-underline" target="_blank" rel="noopener noreferrer">{children}</a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="mb-2 border-s-2 border-primary/20 ps-3 text-muted-foreground last:mb-0">{children}</blockquote>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            )}
          </div>
          {!isUser && renderStructuredContent(message)}
          {!isUser && <MessageDiagnostics message={message} />}
        </div>
        {!isUser && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <Button
                key={`${message.id}-${action.label}`}
                type="button"
                size="sm"
                variant={action.type === 'navigate' ? 'default' : 'outline'}
                className="rounded-full"
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
        <div className={cn('flex items-center gap-2 px-1 text-[11px] text-muted-foreground', isUser && 'justify-end')}>
          {isUser && <User2 className="h-3 w-3" />}
          <span>{formatDateTime(message.created_at)}</span>
          {message.intent && <Badge variant="outline" className="rounded-full text-overline">{message.intent}</Badge>}
        </div>
      </div>
    </div>
  );
}

// ── Structured content router ────────────────────────────────────────────────

function renderStructuredContent(message: VCISOConversationMessage) {
  const result = message.tool_result;
  if (!result || typeof result !== 'object') return null;
  const data = result as Record<string, unknown>;

  switch (message.response_type) {
    case 'kpi':
      return <KPIResponse data={data} />;
    case 'list':
      return <ListResponse data={data} />;
    case 'table':
      return <TableResponse data={data} />;
    case 'chart':
      return <ChartResponse data={data} />;
    case 'dashboard':
      return <DashboardLinkResponse data={data} />;
    case 'investigation':
      return <InvestigationResponse data={data} />;
    default:
      return null;
  }
}

// ── KPI Response (uses shared KpiCard) ───────────────────────────────────────

function KPIResponse({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const score = getNumber(data.score);
  const grade = getString(data.grade);
  const trend = getNumber(data.trend_delta);
  const components = Array.isArray(data.components) ? data.components : [];

  return (
    <div className="mt-4 space-y-3">
      <KpiCard
        title={t.currentScore}
        value={score !== null ? `${score}/100` : '—'}
        change={trend ?? undefined}
        changeLabel={t.vsLastPeriod}
        description={grade ? t.gradePrefix(grade) : undefined}
        className="border-0 bg-secondary shadow-none"
      />
      {components.length > 0 && (
        <div className="rounded-xl border bg-secondary/50 p-3">
          <p className="mb-2 text-xs uppercase tracking-caps-wide text-muted-foreground">{t.riskContributors}</p>
          <div className="space-y-1.5">
            {components.slice(0, 5).map((item, index) => {
              if (!item || typeof item !== 'object') return null;
              const rec = item as Record<string, unknown>;
              const name = getString(rec.name) ?? t.componentN(index + 1);
              const value = getNumber(rec.score) ?? getNumber(rec.impact);
              return (
                <div key={`${name}-${index}`} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{name}</span>
                  <span className="font-medium">{value !== null ? value : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── List Response ────────────────────────────────────────────────────────────

function ListResponse({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const items = extractListItems(data).slice(0, 8);
  if (items.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border bg-secondary p-4">
      <p className="mb-3 text-xs uppercase tracking-caps-wide text-muted-foreground">{t.highlights}</p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${item.text}-${index}`} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 text-muted-foreground">{index + 1}.</span>
            {item.severity && (
              <Badge
                variant="outline"
                className={cn('shrink-0 rounded-full text-overline', severityColor(item.severity))}
              >
                {item.severity}
              </Badge>
            )}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Table Response ───────────────────────────────────────────────────────────

function TableResponse({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const sections: React.ReactNode[] = [];

  // Primary entity (key-value)
  const primaryObj = findPrimaryObject(data);
  if (primaryObj) {
    const entries = Object.entries(primaryObj).filter(
      ([, v]) => v !== null && v !== undefined && typeof v !== 'object',
    );
    if (entries.length > 0) {
      sections.push(
        <div key="primary" className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <tbody>
              {entries.slice(0, 12).map(([key, value]) => (
                <tr key={key} className="border-b last:border-0">
                  <td className="bg-secondary px-3 py-1.5 font-medium text-muted-foreground capitalize whitespace-nowrap">
                    {formatKey(key)}
                  </td>
                  <td className="px-3 py-1.5 break-all">{renderCellValue(value, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
  }

  // Array tables (vulnerabilities, alerts, etc.)
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0];
    if (!first || typeof first !== 'object') continue;
    const records = value as Array<Record<string, unknown>>;
    const columns = Object.keys(first)
      .filter((k) => typeof first[k] !== 'object' || first[k] === null)
      .slice(0, 6);
    if (columns.length === 0) continue;

    sections.push(
      <div key={key}>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-caps text-muted-foreground">
          {formatKey(key)} ({records.length})
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="border-b bg-secondary">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-1.5 text-start font-medium text-muted-foreground capitalize whitespace-nowrap">
                    {formatKey(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 10).map((row, idx) => (
                <tr key={idx} className="border-b last:border-0 hover:bg-secondary/50">
                  {columns.map((col) => (
                    <td key={col} className="px-3 py-1.5 whitespace-nowrap max-w-[120px] sm:max-w-[200px] truncate">
                      {renderCellValue(row[col], t)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {records.length > 10 && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground border-t">
              {t.moreRows(records.length - 10)}
            </p>
          )}
        </div>
      </div>,
    );
  }

  if (sections.length === 0) return null;

  return (
    <div className="mt-4 space-y-3 rounded-2xl border bg-secondary p-4">
      <p className="text-xs uppercase tracking-caps-wide text-muted-foreground">{t.details}</p>
      {sections}
    </div>
  );
}

// ── Dashboard Link Response ──────────────────────────────────────────────────

function DashboardLinkResponse({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const dashboardId = getString(data.dashboard_id);
  const dashboardName = getString(data.name) ?? getString(data.title) ?? t.customDashboard;
  const widgets = Array.isArray(data.widgets) ? (data.widgets as Array<Record<string, unknown>>) : [];
  const dashboardUrl = dashboardId ? `/visus?dashboard=${dashboardId}` : null;

  return (
    <div className="mt-4 rounded-2xl border bg-secondary p-4">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-4 w-4 text-primary" />
        <p className="text-xs uppercase tracking-caps-wide text-muted-foreground">{t.dashboardCreated}</p>
      </div>
      <p className="mt-2 text-sm font-semibold">{dashboardName}</p>

      {/* Widget preview grid */}
      {widgets.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {widgets.slice(0, 6).map((widget, i) => {
            const title = getString(widget.title) ?? getString(widget.name) ?? t.widgetN(i + 1);
            const type = getString(widget.type) ?? 'chart';
            return (
              <div
                key={`widget-${i}`}
                className="flex flex-col items-center justify-center rounded-lg border bg-card p-2 text-center"
              >
                <WidgetTypeIcon type={type} />
                <span className="mt-1 text-overline leading-tight text-muted-foreground line-clamp-2">{title}</span>
              </div>
            );
          })}
          {widgets.length > 6 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed bg-card p-2 text-xs text-muted-foreground">
              {t.moreCount(widgets.length - 6)}
            </div>
          )}
        </div>
      )}

      {/* Open Dashboard link */}
      {dashboardUrl && (
        <Link href={dashboardUrl} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          {t.openDashboard}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
      {!dashboardUrl && dashboardId && (
        <p className="mt-2 text-xs text-muted-foreground">{t.idPrefix(dashboardId)}</p>
      )}
    </div>
  );
}

function WidgetTypeIcon({ type }: { type: string }) {
  const cls = 'h-5 w-5 text-muted-foreground';
  switch (type.toLowerCase()) {
    case 'gauge':
      return <div className={cn(cls, 'rounded-full border-2 border-primary/40 h-5 w-5')} />;
    case 'piechart':
    case 'pie':
      return <div className={cn(cls, 'rounded-full border-2 border-t-primary border-e-primary/30 h-5 w-5')} />;
    case 'table':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="2" y="3" width="16" height="14" rx="2" />
          <line x1="2" y1="7" x2="18" y2="7" />
          <line x1="2" y1="11" x2="18" y2="11" />
          <line x1="8" y1="7" x2="8" y2="17" />
        </svg>
      );
    default:
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <polyline points="3,15 7,10 11,12 17,5" />
        </svg>
      );
  }
}

// ── Investigation Response (full multi-section) ──────────────────────────────

function InvestigationResponse({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const alert = data.alert as Record<string, unknown> | null;
  const assets = Array.isArray(data.assets) ? (data.assets as Array<Record<string, unknown>>) : [];
  const relatedAlerts = Array.isArray(data.related_alerts) ? (data.related_alerts as Array<Record<string, unknown>>) : [];
  const mitreData = data.mitre as Record<string, unknown> | null;
  const uebaData = data.ueba as Record<string, unknown> | null;
  const ruleName = getString(data.rule_name);

  if (!alert || typeof alert !== 'object') return null;

  const title = getString(alert.title) ?? t.alertInvestigation;
  const severity = getString(alert.severity);
  const status = getString(alert.status);
  const confidence = getNumber(alert.confidence_score);
  const createdAt = getString(alert.created_at);
  const explanation = alert.explanation as Record<string, unknown> | null;

  return (
    <div className="mt-4 space-y-3">
      {/* Header card */}
      <Card className="border-0 bg-secondary shadow-none">
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-caps-wide text-muted-foreground">{t.investigation}</p>
          <p className="mt-1 text-sm font-semibold">{title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {severity && (
              <Badge variant="secondary" className={cn('rounded-full', severityBadgeColor(severity))}>
                {severity}
              </Badge>
            )}
            {status && <Badge variant="outline" className="rounded-full">{status}</Badge>}
            {confidence !== null && (
              <Badge variant="outline" className="rounded-full">
                {t.confidencePrefix} {confidence <= 1 ? `${Math.round(confidence * 100)}%` : `${Math.round(confidence)}%`}
              </Badge>
            )}
            {ruleName && <Badge variant="outline" className="rounded-full text-overline">{t.rulePrefix} {ruleName}</Badge>}
          </div>
          {createdAt && (
            <p className="mt-2 text-xs text-muted-foreground">{t.detectedPrefix} {formatDateTime(createdAt)}</p>
          )}
        </CardContent>
      </Card>

      {/* What happened */}
      {explanation && typeof explanation === 'object' && (
        <>
          {getString(explanation.summary) && (
            <CollapsibleSection title={t.whatHappened} defaultOpen>
              <p className="text-sm leading-6">{getString(explanation.summary)}</p>
            </CollapsibleSection>
          )}

          {/* Confidence factors */}
          {Array.isArray(explanation.confidence_factors) && explanation.confidence_factors.length > 0 && (
            <CollapsibleSection title={t.confidenceAnalysis}>
              <div className="space-y-1.5">
                {(explanation.confidence_factors as Array<Record<string, unknown>>).map((factor, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={cn(
                      'mt-0.5 shrink-0 text-xs font-medium',
                      getNumber(factor.impact) !== null && (getNumber(factor.impact) ?? 0) > 0
                        ? 'text-primary'
                        : 'text-warning-700 dark:text-warning-300',
                    )}>
                      {getNumber(factor.impact) !== null ? `${getNumber(factor.impact) ?? 0 > 0 ? '+' : ''}${getNumber(factor.impact)?.toFixed(1)}` : ''}
                    </span>
                    <div>
                      <span className="font-medium">{getString(factor.factor)}</span>
                      {getString(factor.description) && (
                        <span className="text-muted-foreground"> &mdash; {getString(factor.description)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Matched conditions */}
          {Array.isArray(explanation.matched_conditions) && explanation.matched_conditions.length > 0 && (
            <CollapsibleSection title={t.matchedConditions}>
              <ul className="ms-4 list-disc space-y-1 text-sm">
                {(explanation.matched_conditions as string[]).map((condition, i) => (
                  <li key={i}>{condition}</li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

          {/* Recommended actions */}
          {Array.isArray(explanation.recommended_actions) && explanation.recommended_actions.length > 0 && (
            <CollapsibleSection title={t.recommendedActions}>
              <ol className="ms-4 list-decimal space-y-1 text-sm">
                {(explanation.recommended_actions as string[]).map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ol>
            </CollapsibleSection>
          )}

          {/* False positive indicators */}
          {Array.isArray(explanation.false_positive_indicators) && explanation.false_positive_indicators.length > 0 && (
            <CollapsibleSection title={t.falsePositiveIndicators}>
              <ul className="ms-4 list-disc space-y-1 text-sm text-warning-700 dark:text-warning-300">
                {(explanation.false_positive_indicators as string[]).map((indicator, i) => (
                  <li key={i}>{indicator}</li>
                ))}
              </ul>
            </CollapsibleSection>
          )}
        </>
      )}

      {/* Affected assets */}
      {assets.length > 0 && (
        <CollapsibleSection title={t.affectedAssets(assets.length)}>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="border-b bg-secondary">
                <tr>
                  <th className="px-3 py-1.5 text-start font-medium">{t.colName}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t.colType}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t.colCriticality}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-medium">{getString(asset.name) ?? '—'}</td>
                    <td className="px-3 py-1.5">{getString(asset.type) ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      {getString(asset.criticality) && (
                        <Badge variant="outline" className={cn('rounded-full text-overline', severityColor(getString(asset.criticality) ?? ''))}>
                          {getString(asset.criticality)}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{getString(asset.status) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}

      {/* Related alerts */}
      {relatedAlerts.length > 0 && (
        <CollapsibleSection title={t.relatedAlerts(relatedAlerts.length)}>
          <div className="space-y-1.5">
            {relatedAlerts.slice(0, 8).map((ra, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {getString(ra.severity) && (
                  <Badge variant="outline" className={cn('shrink-0 rounded-full text-overline', severityColor(getString(ra.severity) ?? ''))}>
                    {getString(ra.severity)}
                  </Badge>
                )}
                <span className="truncate">{getString(ra.title) ?? t.alertN(i + 1)}</span>
                {getString(ra.status) && (
                  <span className="ms-auto shrink-0 text-xs text-muted-foreground">{getString(ra.status)}</span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* MITRE ATT&CK */}
      {mitreData && typeof mitreData === 'object' && (
        <CollapsibleSection title="MITRE ATT&CK">
          <div className="space-y-1 text-sm">
            {getString(mitreData.technique_name) && (
              <p>
                <span className="text-muted-foreground">{t.techniquePrefix}</span>{' '}
                <span className="font-medium">{getString(mitreData.technique_name)}</span>
                {getString(mitreData.technique_id) && (
                  <span className="ms-1 text-xs text-muted-foreground">({getString(mitreData.technique_id)})</span>
                )}
              </p>
            )}
            {Array.isArray(mitreData.tactic_ids) && (mitreData.tactic_ids as string[]).length > 0 && (
              <p>
                <span className="text-muted-foreground">{t.tacticsPrefix}</span>{' '}
                {(mitreData.tactic_ids as string[]).map((tactic, i) => (
                  <Badge key={i} variant="outline" className="me-1 rounded-full text-overline">{tactic}</Badge>
                ))}
              </p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* UEBA / Behavioral context */}
      {uebaData && typeof uebaData === 'object' && (
        <CollapsibleSection title={t.behavioralContext}>
          <div className="space-y-1 text-sm">
            {getString((uebaData as Record<string, unknown>).entity_name) && (
              <p>
                <span className="text-muted-foreground">{t.entityPrefix}</span>{' '}
                <span className="font-medium">{getString((uebaData as Record<string, unknown>).entity_name)}</span>
              </p>
            )}
            {getNumber((uebaData as Record<string, unknown>).risk_score) !== null && (
              <p>
                <span className="text-muted-foreground">{t.riskScorePrefix}</span>{' '}
                <span className="font-medium">{getNumber((uebaData as Record<string, unknown>).risk_score)}/100</span>
              </p>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ── Collapsible section helper ───────────────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border bg-secondary/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-start text-xs font-medium uppercase tracking-caps text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

// ── Chart Response ───────────────────────────────────────────────────────────

const CHART_COLORS = [
  'hsl(142, 71%, 45%)',
  'hsl(217, 91%, 60%)',
  'hsl(24, 95%, 53%)',
  'hsl(262, 83%, 58%)',
  'hsl(350, 89%, 60%)',
  'hsl(186, 72%, 43%)',
];

function ChartResponse({ data }: { data: Record<string, unknown> }) {
  // Time-series
  const riskTrend = data.risk_trend;
  if (Array.isArray(riskTrend) && riskTrend.length > 0) {
    return <TimeSeriesChart data={riskTrend as Array<Record<string, unknown>>} />;
  }

  // Coverage
  if (typeof data.coverage_percent === 'number') {
    return <CoverageChart data={data} />;
  }

  // Distribution
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0] as Record<string, unknown> | null;
    if (!first || typeof first !== 'object') continue;
    if ('name' in first && ('count' in first || 'value' in first)) {
      return <DistributionChart title={key} data={value as Array<Record<string, unknown>>} />;
    }
  }

  return null;
}

function TimeSeriesChart({ data }: { data: Array<Record<string, unknown>> }) {
  const t = useVcisoChatLabels().bubble;
  const first = data[0];
  const timeKey =
    Object.keys(first).find((k) => k === 'time' || k === 'date' || k === 'timestamp' || k.endsWith('_at')) ?? 'time';
  const numericKeys = Object.keys(first).filter((k) => k !== timeKey && typeof first[k] === 'number');
  if (numericKeys.length === 0) return null;

  const formatted = data.map((point) => {
    const raw = point[timeKey];
    let label = String(raw);
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      try {
        label = new Date(raw).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      } catch {
        /* keep raw */
      }
    }
    return { ...point, [timeKey]: label };
  });

  const yKeys = numericKeys.slice(0, 4).map((key, i) => ({
    key,
    label: formatKey(key),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="mt-4 rounded-2xl border bg-secondary p-4">
      <p className="mb-2 text-xs uppercase tracking-caps-wide text-muted-foreground">{t.trend}</p>
      <LineChart data={formatted} xKey={timeKey} yKeys={yKeys} height={200} showGrid={false} showLegend={yKeys.length > 1} />
    </div>
  );
}

function CoverageChart({ data }: { data: Record<string, unknown> }) {
  const t = useVcisoChatLabels().bubble;
  const covered = getNumber(data.covered) ?? 0;
  const total = getNumber(data.total) ?? 0;
  const pct = getNumber(data.coverage_percent) ?? 0;
  const gaps = Array.isArray(data.gaps) ? (data.gaps as Array<Record<string, unknown>>) : [];

  const pieData = [
    { name: t.covered, value: covered, color: 'hsl(142, 71%, 45%)' },
    { name: t.gaps, value: Math.max(0, total - covered), color: 'hsl(0, 84%, 60%)' },
  ];

  return (
    <div className="mt-4 rounded-2xl border bg-secondary p-4">
      <p className="mb-2 text-xs uppercase tracking-caps-wide text-muted-foreground">{t.coverage}</p>
      <PieChart
        data={pieData}
        height={180}
        innerRadius={45}
        outerRadius={70}
        centerValue={`${Math.round(pct)}%`}
        centerLabel={t.coverageCenter}
        showLegend
      />
      {gaps.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t.topGaps}</p>
          <div className="space-y-1">
            {gaps.slice(0, 5).map((gap, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="rounded-full text-overline shrink-0">
                  {getString(gap.id) ?? `#${i + 1}`}
                </Badge>
                <span className="truncate">{getString(gap.name) ?? t.unknown}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DistributionChart({ title, data }: { title: string; data: Array<Record<string, unknown>> }) {
  const t = useVcisoChatLabels().bubble;
  const items = data.slice(0, 8).map((item, i) => ({
    name: getString(item.name) ?? t.itemN(i + 1),
    value: getNumber(item.count) ?? getNumber(item.value) ?? 0,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  if (items.every((d) => d.value === 0)) return null;

  return (
    <div className="mt-4 rounded-2xl border bg-secondary p-4">
      <p className="mb-2 text-xs uppercase tracking-caps-wide text-muted-foreground">{formatKey(title)}</p>
      <BarChart
        data={items}
        xKey="name"
        yKeys={[{ key: 'value', label: t.count, color: CHART_COLORS[1] }]}
        height={180}
        showGrid={false}
        showLegend={false}
        barRadius={4}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractListItems(result: Record<string, unknown>): Array<{ text: string; severity?: string }> {
  const collections = [result.alerts, result.items, result.pipelines, result.priorities, result.recommendations];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const mapped: Array<{ text: string; severity?: string }> = [];
    for (const item of collection) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const text = getString(rec.title) ?? getString(rec.name) ?? getString(rec.detail);
      if (!text) continue;
      const sev = getString(rec.severity);
      mapped.push(sev ? { text, severity: sev } : { text });
    }
    return mapped;
  }
  return [];
}

function findPrimaryObject(result: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['asset', 'entity', 'item', 'profile', 'source', 'rule']) {
    const val = result[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
  }
  return null;
}

function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function renderCellValue(value: unknown, t: VcisoChatLabels['bubble']): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? t.yes : t.no;
  if (typeof value === 'number') return value.toLocaleString();
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    try {
      return new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return str;
    }
  }
  return str;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'border-error-300 text-error-600 dark:border-error-700 dark:text-error-300';
    case 'high':
      return 'border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-300';
    case 'medium':
      return 'border-warning-300 text-warning-700 dark:border-warning-800 dark:text-warning-300';
    case 'low':
      return 'border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-300';
    default:
      return '';
  }
}

function severityBadgeColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'bg-error-100 text-error-700 border-error-100 dark:bg-error-700/40 dark:text-error-300 dark:border-error-700';
    case 'high':
      return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900';
    case 'medium':
      return 'bg-warning-100 text-warning-700 border-warning-300 dark:bg-warning-800/40 dark:text-warning-300 dark:border-warning-800';
    case 'low':
      return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900';
    default:
      return '';
  }
}
