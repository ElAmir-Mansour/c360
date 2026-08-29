'use client';

import type { DetectionRule, SigmaRuleContent } from '@/types/cyber';
import { serializeRuleContent, stringifySigmaContent } from '@/lib/cyber-rules';

import { RuleSigmaMonaco } from '../../_components/rule-sigma-monaco';
import { useRulesLabels } from '../../_lib/rules-i18n';

function LogicField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4">
      <p className="text-[11px] font-semibold uppercase tracking-caps-xwide text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </div>
  );
}

export function RuleLogic({ rule }: { rule: DetectionRule }) {
  const t = useRulesLabels();
  const serialized = serializeRuleContent(rule.rule_type, rule.rule_content as SigmaRuleContent);

  if (rule.rule_type === 'sigma') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{t.logic.sigmaYaml}</p>
          <p className="text-sm text-muted-foreground">{t.logic.sigmaReadonly}</p>
        </div>
        <RuleSigmaMonaco value={stringifySigmaContent(serialized)} readOnly height={520} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(serialized).map(([key, value]) => (
          <LogicField key={key} label={key.replace(/_/g, ' ')} value={typeof value === 'string' ? value : JSON.stringify(value)} />
        ))}
      </div>

      <div className="rounded-softer surface-card p-5">
        <p className="text-sm font-medium">{t.logic.rawPayload}</p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-auth-dark/95 p-4 text-xs text-emerald-100">
          {JSON.stringify(serialized, null, 2)}
        </pre>
      </div>
    </div>
  );
}
