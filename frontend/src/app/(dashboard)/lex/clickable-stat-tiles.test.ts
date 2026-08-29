import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const lexRoot = resolve(process.cwd(), 'src/app/(dashboard)/lex');

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('Lex KPI drill-down contract', () => {
  it('keeps every KPI tile navigable or actionable', () => {
    const deadTiles: string[] = [];
    const components = new Set([
      'StatTile',
      'KpiCard',
      'DetailStatCard',
      'StatBlock',
      'AnalyticsMetricCard',
      'AnalyticsHeadlineTile',
      'ContractKpiTile',
      'MoneyBucketTile',
      'DashboardKpiCard',
      'MaturityTile',
      'PostureTile',
      'RiskStat',
      'SlaTile',
      'StatusTile',
      'CommandMetric',
      'SyncMetric',
      'HealthMetric',
      'CollaborationMetric',
      'ApprovalMetric',
      'AnalyticsSummary',
      'ClassificationUsageStat',
      'DeviationStat',
      'ImpactMetric',
      'LineageCard',
      'EvidenceSummaryRow',
      'ClassificationMetric',
      'EvidenceStatCard',
      'TaskKpiCard',
      'QualificationMetric',
      'EntityExposureMetric',
      'MetricCard',
    ]);

    for (const file of tsxFiles(lexRoot)) {
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const component = node.tagName.getText(sourceFile);
          if (components.has(component)) {
            const attributes = node.attributes.properties;
            const names = new Set(
              attributes.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(sourceFile)),
            );
            const spreadBacked = attributes.some(ts.isJsxSpreadAttribute);
            if (!spreadBacked && !names.has('href') && !names.has('onAction') && !names.has('onClick')) {
              const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
              deadTiles.push(`${relative(process.cwd(), file)}:${line} ${component}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(deadTiles, `KPI tiles without a drill-down:\n${deadTiles.join('\n')}`).toEqual([]);
  });

  it('keeps every mounted shared analytics chart drillable', () => {
    const deadCharts: string[] = [];
    const chartComponents = new Set(['AreaChart', 'BarChart', 'LineChart', 'PieChart']);

    for (const file of tsxFiles(lexRoot)) {
      // This folder is an unmounted prototype chart library. Its eventual host
      // must supply drill-down callbacks when those components are mounted.
      if (file.includes('/reports/analytics/_components/charts/')) continue;

      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const component = node.tagName.getText(sourceFile);
          if (chartComponents.has(component)) {
            const attributes = node.attributes.properties;
            const names = new Set(
              attributes.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(sourceFile)),
            );
            if (!names.has('onItemSelect')) {
              const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
              deadCharts.push(`${relative(process.cwd(), file)}:${line} ${component}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    expect(deadCharts, `Analytics charts without a drill-down:\n${deadCharts.join('\n')}`).toEqual([]);
  });

  it('keeps bespoke statistics outside StatTile contextually explained', () => {
    const bespokeStatisticFiles = [
      '_components/command-ui.tsx',
      '_components/role-dashboard/dashboard-kpi-card.tsx',
      'admin/classifications/_components/classification-usage.tsx',
      'admin/service-catalog/_components/service-catalog-admin-panels.tsx',
      'cases/_components/detail-workspace/case-command-header.tsx',
      'cases/_components/detail-workspace/collaboration-panel.tsx',
      'cases/_components/tabs/defendant-tab.tsx',
      'cases/_components/tabs/documents-tab.tsx',
      'clause-library/page.tsx',
      'documents/_components/lex-editor-workspace.tsx',
      'entities/[id]/page.tsx',
      'investigations/_components/investigation-approval-operations-panel.tsx',
      'investigations/_components/investigation-command-header.tsx',
      'playbooks/_components/deviation-review.tsx',
      'reports/analytics/_components/analytics-metric-card.tsx',
      'signatures/_components/signature-risk-center.tsx',
      'workflow-policies/page.tsx',
    ];
    const missing = bespokeStatisticFiles.filter((path) => {
      const source = readFileSync(resolve(lexRoot, path), 'utf8');
      return !source.includes('title={statisticHint(') && !source.includes('title={helper ?? statisticHint(');
    });

    expect(missing, `Bespoke statistics without hints:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps self-contained custom data surfaces keyboard-actionable', () => {
    const surfaces = [
      ['tasks/page.tsx', 'TaskKpiCard'],
      ['investigations/[id]/evidence/_components/investigation-evidence-workspace.tsx', 'EvidenceStatCard'],
      ['cases/[id]/_components/qualification/qualification-tab.tsx', 'QualificationMetric'],
      ['entities/[id]/page.tsx', 'EntityExposureMetric'],
      ['contracts/[id]/_components/contract-risk-panel.tsx', 'ContractRiskPanel'],
      ['signatures/_components/signature-detail-sheet.tsx', 'OperationalCard'],
      ['admin/integrations/[id]/logs/_components/sync-preview-dialog.tsx', 'SyncPreviewStat'],
      ['settlements/_components/delay-breakdown.tsx', 'DelayBreakdown'],
      ['drafting/_components/drafting-risk-dashboard.tsx', 'DraftingRiskDashboard'],
      ['drafting/_components/drafting-workspace-panels.tsx', 'DraftingRiskDashboard'],
      ['investigations/_components/deep/investigation-deep-dashboard.tsx', 'KpiGrid'],
      ['investigations/_components/deep/investigation-deep-dashboard.tsx', 'FraudHeatmap'],
      ['investigations/_components/deep/investigation-deep-dashboard.tsx', 'ForensicsDashboard'],
      ['admin/integrations/_components/health-history-chart.tsx', 'HealthHistoryChart'],
    ] as const;
    const missing: string[] = [];

    for (const [path, component] of surfaces) {
      const file = resolve(lexRoot, path);
      const source = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let implementation = '';

      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === component) {
          implementation = node.getText(sourceFile);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);

      // A native `<button>` and the design-system `<Button>` are both accepted:
      // `components/ui/button.tsx` resolves to the intrinsic `"button"` element
      // unless `asChild` is set, in which case it delegates to a Slot child that
      // is not guaranteed to be focusable — so `asChild` still fails the check.
      const rendersNativeButton =
        implementation.includes('<button') ||
        (implementation.includes('<Button') && !implementation.includes('asChild'));

      if (!rendersNativeButton || !implementation.includes('onClick=')) {
        missing.push(`${path} ${component}`);
      }
    }

    expect(missing, `Custom data surfaces without a keyboard action:\n${missing.join('\n')}`).toEqual([]);
  });
});
