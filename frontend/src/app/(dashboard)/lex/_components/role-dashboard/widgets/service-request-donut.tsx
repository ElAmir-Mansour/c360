'use client';

import Link from 'next/link';

import { useLegalDirectorDashboardLabels } from '@/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelShell } from './panel-shell';
import { PanelActionLink } from './panel-action-link';
import styles from './service-request-donut.module.css';

export interface ServiceRequestDonutProps {
  total: number;
  segments: {
    key: 'contracts' | 'consultations' | 'litigations' | 'investigation' | 'other';
    label: string;
    value: number;
    href: string;
  }[];
}

type ServiceRequestSegment = ServiceRequestDonutProps['segments'][number];
type ServiceRequestKey = ServiceRequestSegment['key'];

export type ServiceRequestDonutStateProps =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'error'; onRetry: () => void };

interface ServiceColor {
  dot: string;
  halo: string;
}

const SERVICE_COLORS: Record<ServiceRequestKey, ServiceColor> = {
  contracts: {
    dot: 'var(--wt-service-contracts-dot)',
    halo: 'var(--wt-service-contracts-halo)',
  },
  consultations: {
    dot: 'var(--wt-service-consultations-dot)',
    halo: 'var(--wt-service-consultations-halo)',
  },
  litigations: {
    dot: 'var(--wt-service-litigations-dot)',
    halo: 'var(--wt-service-litigations-halo)',
  },
  investigation: {
    dot: 'var(--wt-service-investigation-dot)',
    halo: 'var(--wt-service-investigation-halo)',
  },
  other: {
    dot: 'var(--wt-service-other-dot)',
    halo: 'var(--wt-service-other-halo)',
  },
};

const SERVICE_ORDER: Record<ServiceRequestKey, number> = {
  contracts: 0,
  consultations: 1,
  litigations: 2,
  investigation: 3,
  other: 4,
};

const VIEWBOX_SIZE = 200;
const STROKE_WIDTH = 30;
const RADIUS = (VIEWBOX_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_GAP = 2;

interface DonutArc extends ServiceRequestSegment {
  color: ServiceColor;
  length: number;
  offset: number;
  fraction: number;
}

function buildArcs(segments: ServiceRequestSegment[]): DonutArc[] {
  const orderedSegments = [...segments].sort(
    (left, right) => SERVICE_ORDER[left.key] - SERVICE_ORDER[right.key],
  );
  const segmentTotal = orderedSegments.reduce(
    (sum, segment) => sum + Math.max(segment.value, 0),
    0,
  );
  let offset = 0;

  return orderedSegments.map((segment) => {
    const fraction = segmentTotal > 0 ? Math.max(segment.value, 0) / segmentTotal : 0;
    const shareLength = fraction * CIRCUMFERENCE;
    const arc = {
      ...segment,
      color: SERVICE_COLORS[segment.key],
      length: Math.max(shareLength - ARC_GAP, 0),
      offset,
      fraction,
    };
    offset += shareLength;
    return arc;
  });
}

function ServiceRequestDataTable({
  segments,
  total,
  title,
}: {
  segments: ServiceRequestDonutProps['segments'];
  total: number;
  title: string;
}) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const rows = [
    ...segments.map((segment) => ({ label: segment.label, value: segment.value })),
    { label: labels.values.total, value: total },
  ];

  return (
    <div
      className="sr-only"
      role="table"
      aria-label={labels.accessibility.chartTable(title)}
      aria-colcount={2}
      aria-rowcount={rows.length + 1}
    >
      <div role="rowgroup">
        <div role="row">
          <span role="columnheader">{labels.accessibility.columns.category}</span>
          <span role="columnheader">{labels.accessibility.columns.count}</span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row, index) => (
          <div role="row" key={`${row.label}-${index}`}>
            <span role="cell">{row.label}</span>
            <span role="cell">{formatter.formatNumber(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServiceRequestDonut({ total, segments }: ServiceRequestDonutProps) {
  const labels = useLegalDirectorDashboardLabels();
  const formatter = useLexFormat();
  const title = labels.panels.serviceRequests;

  if (segments.length === 0) {
    return (
      <PanelShell title={title}>
        <DashboardPrimitiveState
          state="empty"
          title={labels.states.serviceRequests.empty}
        />
      </PanelShell>
    );
  }

  const arcs = buildArcs(segments);
  const formattedTotal = formatter.formatNumber(total);

  return (
    <PanelShell
      title={title}
      className={styles.panel}
      action={<PanelActionLink href="/lex/reports/analytics" label={labels.actions.viewAll} />}
    >
      <div
        className={styles.content}
        dir={formatter.direction}
        data-service-request-donut=""
      >
        <div className={styles.chart} data-direction={formatter.direction}>
          <svg
            className={cn(styles.svg, formatter.direction === 'rtl' && styles.svgRtl)}
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            role="img"
            aria-label={labels.accessibility.chart(title)}
          >
            <circle
              cx={VIEWBOX_SIZE / 2}
              cy={VIEWBOX_SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--wt-track)"
              strokeWidth={STROKE_WIDTH}
            />
            {arcs.map((arc, index) => (
              <a
                key={`${arc.key}-${index}`}
                href={arc.href}
                aria-label={labels.accessibility.kpiLink(
                  `${arc.label}: ${formatter.formatNumber(arc.value)}`,
                )}
              >
                <circle
                  className={styles.arc}
                  cx={VIEWBOX_SIZE / 2}
                  cy={VIEWBOX_SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color.dot}
                  strokeWidth={STROKE_WIDTH}
                  strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                  strokeDashoffset={-arc.offset}
                  data-segment={arc.key}
                  data-segment-value={arc.value}
                  data-segment-fraction={arc.fraction}
                />
              </a>
            ))}
          </svg>
          <div className={styles.center} aria-hidden="true">
            <span className={styles.totalValue}>{formattedTotal}</span>
            <span className={styles.totalLabel}>{labels.values.total}</span>
          </div>
        </div>

        <ul className={styles.legend}>
          {arcs.map((arc, index) => (
            <li key={`${arc.key}-${index}`}>
              <Link
                href={arc.href}
                className={styles.legendRow}
                aria-label={labels.accessibility.kpiLink(
                  `${arc.label}: ${formatter.formatNumber(arc.value)}`,
                )}
              >
                <span
                  className={styles.halo}
                  style={{ backgroundColor: arc.color.halo }}
                  aria-hidden="true"
                >
                  <span
                    className={styles.dot}
                    style={{ backgroundColor: arc.color.dot }}
                  />
                </span>
                <span className={styles.legendLabel}>{arc.label}</span>
                <span className={styles.legendValue}>{formatter.formatNumber(arc.value)}</span>
              </Link>
            </li>
          ))}
        </ul>

        <ServiceRequestDataTable segments={arcs} total={total} title={title} />
      </div>
    </PanelShell>
  );
}

export function ServiceRequestDonutState(props: ServiceRequestDonutStateProps) {
  const labels = useLegalDirectorDashboardLabels();
  const title = labels.panels.serviceRequests;

  return (
    <PanelShell title={title}>
      {props.state === 'loading' ? (
        <DashboardPrimitiveState
          state="loading"
          label={labels.states.serviceRequests.loading}
        />
      ) : props.state === 'empty' ? (
        <DashboardPrimitiveState
          state="empty"
          title={labels.states.serviceRequests.empty}
        />
      ) : (
        <DashboardPrimitiveState
          state="error"
          title={labels.states.serviceRequests.error}
          retryLabel={labels.actions.retry}
          onRetry={props.onRetry}
        />
      )}
    </PanelShell>
  );
}
