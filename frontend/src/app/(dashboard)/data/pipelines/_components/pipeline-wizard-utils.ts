'use client';

import type {
  DiscoveredColumn,
  DiscoveredSchema,
  DiscoveredTable,
  JsonObject,
  JsonValue,
  QualityGate,
  Transformation,
} from '@/lib/data-suite';
import { humanizeCronOrFrequency } from '@/lib/data-suite/utils';
import type {
  AggregateDefinitionDraft,
  FilterConditionDraft,
  PipelineCreatePayload,
  PipelineQualityGateDraft,
  PipelineTransformDraft,
  PipelineWizardState,
} from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createInitialPipelineWizardState(): PipelineWizardState {
  return {
    step: 1,
    basic: {
      name: '',
      description: '',
      type: 'etl',
      tags: [],
    },
    source: {
      source_id: '',
      read_mode: 'table',
      source_table: '',
      source_query: '',
      incremental_enabled: false,
      incremental_field: '',
      incremental_value: '',
    },
    sourceSchema: null,
    selectedSource: null,
    selectedModel: null,
    transforms: [],
    target: {
      target_id: null,
      target_table: '',
      target_model_id: null,
      load_strategy: 'append',
      merge_keys: [],
    },
    quality: {
      quality_gates: [],
      fail_on_quality_gate: true,
    },
    schedule: {
      schedule_mode: 'manual',
      schedule_preset: null,
      custom_cron: '',
      max_retries: 3,
      retry_backoff_sec: 60,
    },
    previewBeforeRows: [],
    previewAfterRows: [],
    previewError: null,
  };
}

export function createEmptyFilterCondition(): FilterConditionDraft {
  return {
    id: createId('filter'),
    column: '',
    operator: '==',
    value: '',
    secondaryValue: '',
  };
}

export function createEmptyAggregation(): AggregateDefinitionDraft {
  return {
    id: createId('agg'),
    column: '',
    function: 'count',
    alias: '',
  };
}

export function createEmptyQualityGate(): PipelineQualityGateDraft {
  return {
    id: createId('gate'),
    name: '',
    metric: 'null_percentage',
    column: '',
    operator: '<=',
    threshold: 0,
    min_value: undefined,
    max_value: undefined,
    expression: '',
    severity: 'medium',
    description: '',
  };
}

export function createEmptyTransform(type: PipelineTransformDraft['type']): PipelineTransformDraft {
  switch (type) {
    case 'rename':
      return {
        id: createId('transform'),
        type,
        config: { from: '', to: '' },
      };
    case 'cast':
      return {
        id: createId('transform'),
        type,
        config: { column: '', to_type: 'string' },
      };
    case 'filter':
      return {
        id: createId('transform'),
        type,
        config: { combinator: 'AND', conditions: [createEmptyFilterCondition()] },
      };
    case 'map_values':
      return {
        id: createId('transform'),
        type,
        config: {
          column: '',
          mappings: [{ id: createId('mapping'), key: '', value: '' }],
          default_value: '',
        },
      };
    case 'derive':
      return {
        id: createId('transform'),
        type,
        config: { name: '', expression: '' },
      };
    case 'deduplicate':
      return {
        id: createId('transform'),
        type,
        config: { key_columns: [], keep: 'latest', order_by: '' },
      };
    case 'aggregate':
      return {
        id: createId('transform'),
        type,
        config: { group_by: [], aggregations: [createEmptyAggregation()] },
      };
  }
}

export function findTable(schema: DiscoveredSchema | null, tableName?: string): DiscoveredTable | null {
  if (!schema || !tableName) {
    return null;
  }
  return schema.tables.find((table) => qualifiedTableName(table) === tableName) ?? null;
}

export function qualifiedTableName(table: DiscoveredTable): string {
  return table.schema_name ? `${table.schema_name}.${table.name}` : table.name;
}

export function tableColumnNames(table: DiscoveredTable | null): string[] {
  return table?.columns.map((column) => column.name) ?? [];
}

export function buildSampleRows(table: DiscoveredTable | null, limit = 5): Array<Record<string, JsonValue>> {
  if (!table) {
    return [];
  }
  const rowCount = Math.min(
    limit,
    Math.max(
      1,
      ...table.columns.map((column) => column.sample_values?.length ?? 0),
    ),
  );

  return Array.from({ length: rowCount }, (_, index) => {
    const row: Record<string, JsonValue> = {};
    table.columns.forEach((column) => {
      row[column.name] = column.sample_values?.[index] ?? column.sample_values?.[0] ?? null;
    });
    return row;
  });
}

export function serializePipelinePayload(state: PipelineWizardState): PipelineCreatePayload {
  const schedule = resolveScheduleValue(
    state.schedule.schedule_mode,
    state.schedule.schedule_preset,
    state.schedule.custom_cron,
  );
  return {
    name: state.basic.name,
    description: state.basic.description,
    type: state.basic.type,
    source_id: state.source.source_id,
    target_id: state.target.target_id,
    schedule,
    tags: state.basic.tags,
    config: {
      source_table: state.source.read_mode === 'table' ? state.source.source_table : undefined,
      source_query: state.source.read_mode === 'query' ? state.source.source_query : undefined,
      target_table: state.target.target_table || undefined,
      target_model_id: state.target.target_model_id,
      incremental_field: state.source.incremental_enabled ? state.source.incremental_field || undefined : undefined,
      incremental_value: state.source.incremental_enabled ? state.source.incremental_value || null : undefined,
      transformations: state.transforms.map(serializeTransform),
      quality_gates: state.quality.quality_gates.map(serializeQualityGate),
      fail_on_quality_gate: state.quality.fail_on_quality_gate,
      load_strategy: state.target.load_strategy,
      merge_keys: state.target.load_strategy === 'merge' ? state.target.merge_keys : [],
      max_retries: state.schedule.max_retries,
      retry_backoff_sec: state.schedule.retry_backoff_sec,
    },
  };
}

export function describeSchedule(mode: PipelineWizardState['schedule']['schedule_mode'], preset: string | null, customCron: string): string {
  const value = resolveScheduleValue(mode, preset, customCron);
  return humanizeCronOrFrequency(value);
}

export function serializeQualityGate(gate: PipelineQualityGateDraft): QualityGate {
  return {
    name: gate.name,
    metric: gate.metric,
    column: gate.column || undefined,
    operator: gate.operator || undefined,
    threshold: gate.metric === 'min_row_count' ? gate.min_value ?? gate.threshold : gate.threshold,
    min_value: gate.min_value,
    max_value: gate.max_value,
    expression: gate.expression || undefined,
    severity: gate.severity,
    description: gate.description || undefined,
  };
}

export function serializeTransform(transform: PipelineTransformDraft): Transformation {
  switch (transform.type) {
    case 'rename':
      return {
        type: transform.type,
        config: {
          from: transform.config.from,
          to: transform.config.to,
        },
      };
    case 'cast':
      return {
        type: transform.type,
        config: {
          column: transform.config.column,
          to_type: transform.config.to_type,
        },
      };
    case 'filter':
      return {
        type: transform.type,
        config: {
          expression: buildFilterExpression(transform.config.conditions, transform.config.combinator),
        },
      };
    case 'map_values': {
      const mapping: JsonObject = {};
      transform.config.mappings.forEach((item) => {
        if (item.key.trim()) {
          mapping[item.key] = item.value;
        }
      });
      return {
        type: transform.type,
        config: {
          column: transform.config.column,
          mapping,
          default: transform.config.default_value || null,
        },
      };
    }
    case 'derive':
      return {
        type: transform.type,
        config: {
          name: transform.config.name,
          expression: transform.config.expression,
        },
      };
    case 'deduplicate':
      return {
        type: transform.type,
        config: {
          key_columns: transform.config.key_columns,
          keep: transform.config.keep,
          order_by: transform.config.order_by,
        },
      };
    case 'aggregate':
      return {
        type: transform.type,
        config: {
          group_by: transform.config.group_by,
          aggregations: transform.config.aggregations.map((aggregation) => ({
            column: aggregation.column,
            function: aggregation.function,
            alias: aggregation.alias,
          })),
        },
      };
  }
}

export function summarizeTransform(transform: PipelineTransformDraft): string {
  switch (transform.type) {
    case 'rename':
      return transform.config.from && transform.config.to
        ? `Rename '${transform.config.from}' → '${transform.config.to}'`
        : 'Rename column';
    case 'cast':
      return transform.config.column
        ? `Cast '${transform.config.column}' to ${transform.config.to_type}`
        : 'Cast column type';
    case 'filter':
      return transform.config.conditions.length > 0
        ? `Filter: ${buildFilterExpression(transform.config.conditions, transform.config.combinator)}`
        : 'Filter rows';
    case 'map_values':
      return transform.config.column
        ? `Map '${transform.config.column}': ${transform.config.mappings.filter((item) => item.key || item.value).length} value mappings`
        : 'Map values';
    case 'derive':
      return transform.config.name && transform.config.expression
        ? `Derive '${transform.config.name}' = ${transform.config.expression}`
        : 'Derived column';
    case 'deduplicate':
      return transform.config.key_columns.length > 0
        ? `Deduplicate by [${transform.config.key_columns.join(', ')}]`
        : 'Deduplicate rows';
    case 'aggregate':
      return transform.config.aggregations.length > 0
        ? `Group by [${transform.config.group_by.join(', ')}]`
        : 'Aggregate rows';
  }
}

export function validateTransform(transform: PipelineTransformDraft): string | null {
  switch (transform.type) {
    case 'rename':
      return transform.config.from && transform.config.to ? null : 'Rename requires both source and target columns.';
    case 'cast':
      return transform.config.column ? null : 'Cast requires a column.';
    case 'filter':
      return transform.config.conditions.every((condition) => validateFilterCondition(condition))
        ? null
        : 'Every filter condition must include a column and any required values.';
    case 'map_values':
      return transform.config.column ? null : 'Map values requires a target column.';
    case 'derive':
      return transform.config.name && transform.config.expression ? null : 'Derived column requires a name and expression.';
    case 'deduplicate':
      return transform.config.key_columns.length > 0 ? null : 'Deduplicate requires at least one key column.';
    case 'aggregate':
      return transform.config.aggregations.every((aggregation) => aggregation.function && (aggregation.column || aggregation.function === 'count'))
        ? null
        : 'Aggregate requires at least one valid aggregation definition.';
  }
}

export function runPreview(rows: Array<Record<string, JsonValue>>, transforms: PipelineTransformDraft[]): {
  rows: Array<Record<string, JsonValue>>;
  error: string | null;
} {
  try {
    const output = transforms.reduce<Array<Record<string, JsonValue>>>((currentRows, transform) => {
      const validationError = validateTransform(transform);
      if (validationError) {
        throw new Error(validationError);
      }
      return applyTransform(currentRows, transform);
    }, cloneRows(rows));

    return { rows: output.slice(0, 5), error: null };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'Failed to preview transformations.',
    };
  }
}

function resolveScheduleValue(
  mode: PipelineWizardState['schedule']['schedule_mode'],
  preset: string | null,
  customCron?: string,
): string | null {
  if (mode === 'preset') {
    return preset;
  }
  if (mode === 'custom') {
    return customCron?.trim() || null;
  }
  return null;
}

function buildFilterExpression(conditions: FilterConditionDraft[], combinator: 'AND' | 'OR'): string {
  return conditions
    .filter((condition) => condition.column.trim())
    .map((condition) => conditionToExpression(condition))
    .filter((value) => value.length > 0)
    .join(` ${combinator} `);
}

function conditionToExpression(condition: FilterConditionDraft): string {
  const column = condition.column.trim();
  if (!column) {
    return '';
  }
  switch (condition.operator) {
    case 'is_null':
      return `${column} == null`;
    case 'is_not_null':
      return `${column} != null`;
    case 'in':
    case 'not_in': {
      const values = condition.value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `'${escapeExpressionString(item)}'`)
        .join(', ');
      return `${column} ${condition.operator.toUpperCase()} (${values})`;
    }
    case 'like':
      return `${column} LIKE '${escapeExpressionString(condition.value)}'`;
    default:
      return `${column} ${condition.operator} ${formatExpressionValue(condition.value)}`;
  }
}

function formatExpressionValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "''";
  }
  if (!Number.isNaN(Number(trimmed))) {
    return trimmed;
  }
  if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null') {
    return trimmed;
  }
  return `'${escapeExpressionString(trimmed)}'`;
}

function escapeExpressionString(value: string): string {
  return value.replace(/'/g, "\\'");
}

function validateFilterCondition(condition: FilterConditionDraft): boolean {
  if (!condition.column.trim()) {
    return false;
  }
  if (condition.operator === 'is_null' || condition.operator === 'is_not_null') {
    return true;
  }
  if (condition.operator === 'in' || condition.operator === 'not_in') {
    return condition.value.trim().length > 0;
  }
  return condition.value.trim().length > 0;
}

function applyTransform(rows: Array<Record<string, JsonValue>>, transform: PipelineTransformDraft): Array<Record<string, JsonValue>> {
  switch (transform.type) {
    case 'rename':
      return rows.map((row) => {
        const next = { ...row };
        next[transform.config.to] = row[transform.config.from] ?? null;
        delete next[transform.config.from];
        return next;
      });
    case 'cast':
      return rows.map((row) => ({
        ...row,
        [transform.config.column]: castPreviewValue(row[transform.config.column], transform.config.to_type),
      }));
    case 'filter':
      return rows.filter((row) => evaluateFilterRow(row, transform.config.conditions, transform.config.combinator));
    case 'map_values': {
      const mapping = new Map(
        transform.config.mappings
          .filter((item) => item.key.trim())
          .map((item) => [item.key, item.value] as const),
      );
      return rows.map((row) => {
        const current = `${row[transform.config.column] ?? ''}`;
        const mapped = mapping.get(current);
        return {
          ...row,
          [transform.config.column]: mapped ?? (transform.config.default_value || row[transform.config.column]),
        };
      });
    }
    case 'derive':
      return rows.map((row) => ({
        ...row,
        [transform.config.name]: evaluateDeriveExpression(row, transform.config.expression),
      }));
    case 'deduplicate':
      return deduplicateRows(rows, transform.config.key_columns, transform.config.keep, transform.config.order_by);
    case 'aggregate':
      return aggregateRows(rows, transform.config.group_by, transform.config.aggregations);
  }
}

function castPreviewValue(value: JsonValue, toType: string): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  switch (toType) {
    case 'string':
      return `${value}`;
    case 'integer': {
      const parsed = Number.parseInt(`${value}`, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'float': {
      const parsed = Number.parseFloat(`${value}`);
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'boolean': {
      const normalized = `${value}`.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'n'].includes(normalized)) {
        return false;
      }
      return null;
    }
    case 'datetime': {
      const parsed = new Date(`${value}`);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    default:
      return value;
  }
}

function evaluateFilterRow(
  row: Record<string, JsonValue>,
  conditions: FilterConditionDraft[],
  combinator: 'AND' | 'OR',
): boolean {
  const evaluations = conditions
    .filter((condition) => condition.column.trim())
    .map((condition) => evaluateCondition(row, condition));
  if (evaluations.length === 0) {
    return true;
  }
  return combinator === 'AND' ? evaluations.every(Boolean) : evaluations.some(Boolean);
}

function evaluateCondition(row: Record<string, JsonValue>, condition: FilterConditionDraft): boolean {
  const left = row[condition.column];
  switch (condition.operator) {
    case '==':
      return `${left ?? ''}` === condition.value;
    case '!=':
      return `${left ?? ''}` !== condition.value;
    case '>':
      return compareValues(left, condition.value) > 0;
    case '<':
      return compareValues(left, condition.value) < 0;
    case '>=':
      return compareValues(left, condition.value) >= 0;
    case '<=':
      return compareValues(left, condition.value) <= 0;
    case 'in':
      return condition.value.split(',').map((item) => item.trim()).includes(`${left ?? ''}`);
    case 'not_in':
      return !condition.value.split(',').map((item) => item.trim()).includes(`${left ?? ''}`);
    case 'like':
      return likeValue(`${left ?? ''}`, condition.value);
    case 'is_null':
      return left === null || left === undefined || `${left}`.trim() === '';
    case 'is_not_null':
      return left !== null && left !== undefined && `${left}`.trim() !== '';
  }
}

function compareValues(left: JsonValue, right: string): number {
  const leftNumber = Number(`${left}`);
  const rightNumber = Number(right);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  const leftDate = Date.parse(`${left ?? ''}`);
  const rightDate = Date.parse(right);
  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }
  return `${left ?? ''}`.localeCompare(right);
}

function likeValue(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

/**
 * Safe evaluator for derive expressions. Replaces a previous `new Function()`
 * implementation that was effectively client-side `eval` of user-supplied
 * input. The grammar supports:
 *   - literals: numbers (`42`, `1.5`), strings (`'foo'` or `"foo"`),
 *     booleans (`true`/`false`), `null`
 *   - identifiers: column references resolved against `row`
 *   - function calls: TRIM, UPPER, LOWER, CONCAT, COALESCE (allowlist)
 *   - operators: + - * / %, comparison (== != > < >= <=), logical (&& ||),
 *     unary (- +, !), parentheses, ternary (?:)
 * Anything else (member access `.`, indexing `[]`, statements, assignments,
 * `globalThis`, `window`, `eval`, etc.) is rejected at parse time.
 */
function evaluateDeriveExpression(row: Record<string, JsonValue>, expression: string): JsonValue {
  if (!expression || !expression.trim()) {
    return null;
  }
  try {
    const tokens = tokenizeExpression(expression);
    const parser = new ExpressionParser(tokens);
    const ast = parser.parseExpression();
    parser.expectEnd();
    return evaluateAst(ast, row);
  } catch {
    // Match prior behaviour: parse/eval errors yield null rather than throwing
    // (the wizard preview surface tolerates per-row failures).
    return null;
  }
}

type AstNode =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'identifier'; name: string }
  | { kind: 'unary'; op: '-' | '+' | '!'; operand: AstNode }
  | { kind: 'binary'; op: BinaryOp; left: AstNode; right: AstNode }
  | { kind: 'logical'; op: '&&' | '||'; left: AstNode; right: AstNode }
  | { kind: 'ternary'; test: AstNode; consequent: AstNode; alternate: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] };

type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '>' | '<' | '>=' | '<=';

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'punct'; value: string };

const ALLOWED_FUNCTIONS = new Set(['TRIM', 'UPPER', 'LOWER', 'CONCAT', 'COALESCE']);
const RESERVED_LITERALS: Record<string, JsonValue> = {
  true: true,
  false: false,
  null: null,
};

function tokenizeExpression(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    // whitespace
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    // numbers (including decimals)
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(input[i + 1] ?? ''))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      const raw = input.slice(i, j);
      const num = Number(raw);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid number literal: ${raw}`);
      }
      tokens.push({ type: 'number', value: num });
      i = j;
      continue;
    }
    // string literals (single or double quoted, with \\ and \' \" escapes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) {
          const next = input[j + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 2;
        } else {
          value += input[j];
          j += 1;
        }
      }
      if (j >= input.length) {
        throw new Error('Unterminated string literal');
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    // identifiers
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j += 1;
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }
    // multi-char punctuation: == != >= <= && ||
    const two = input.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'punct', value: two });
      i += 2;
      continue;
    }
    // single-char punctuation
    if ('+-*/%(),?:!<>'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character in expression: ${ch}`);
  }
  return tokens;
}

class ExpressionParser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  expectEnd(): void {
    if (this.pos !== this.tokens.length) {
      throw new Error('Unexpected trailing tokens');
    }
  }

  // expr := ternary
  parseExpression(): AstNode {
    return this.parseTernary();
  }

  private parseTernary(): AstNode {
    const test = this.parseLogicalOr();
    if (this.matchPunct('?')) {
      const consequent = this.parseTernary();
      if (!this.matchPunct(':')) throw new Error('Expected ":" in ternary');
      const alternate = this.parseTernary();
      return { kind: 'ternary', test, consequent, alternate };
    }
    return test;
  }

  private parseLogicalOr(): AstNode {
    let left = this.parseLogicalAnd();
    while (this.matchPunct('||')) {
      const right = this.parseLogicalAnd();
      left = { kind: 'logical', op: '||', left, right };
    }
    return left;
  }

  private parseLogicalAnd(): AstNode {
    let left = this.parseEquality();
    while (this.matchPunct('&&')) {
      const right = this.parseEquality();
      left = { kind: 'logical', op: '&&', left, right };
    }
    return left;
  }

  private parseEquality(): AstNode {
    let left = this.parseRelational();
    while (true) {
      const op = this.peekPunctOneOf(['==', '!=']);
      if (!op) break;
      this.pos += 1;
      const right = this.parseRelational();
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
    return left;
  }

  private parseRelational(): AstNode {
    let left = this.parseAdditive();
    while (true) {
      const op = this.peekPunctOneOf(['>=', '<=', '>', '<']);
      if (!op) break;
      this.pos += 1;
      const right = this.parseAdditive();
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (true) {
      const op = this.peekPunctOneOf(['+', '-']);
      if (!op) break;
      this.pos += 1;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    while (true) {
      const op = this.peekPunctOneOf(['*', '/', '%']);
      if (!op) break;
      this.pos += 1;
      const right = this.parseUnary();
      left = { kind: 'binary', op: op as BinaryOp, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    const op = this.peekPunctOneOf(['-', '+', '!']);
    if (op) {
      this.pos += 1;
      const operand = this.parseUnary();
      return { kind: 'unary', op: op as '-' | '+' | '!', operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('Unexpected end of expression');
    if (tok.type === 'number') {
      this.pos += 1;
      return { kind: 'literal', value: tok.value };
    }
    if (tok.type === 'string') {
      this.pos += 1;
      return { kind: 'literal', value: tok.value };
    }
    if (tok.type === 'punct' && tok.value === '(') {
      this.pos += 1;
      const inner = this.parseExpression();
      if (!this.matchPunct(')')) throw new Error('Expected ")"');
      return inner;
    }
    if (tok.type === 'ident') {
      this.pos += 1;
      // function call?
      if (this.tokens[this.pos]?.type === 'punct' && (this.tokens[this.pos] as { value: string }).value === '(') {
        if (!ALLOWED_FUNCTIONS.has(tok.value)) {
          throw new Error(`Disallowed function: ${tok.value}`);
        }
        this.pos += 1; // consume '('
        const args: AstNode[] = [];
        if (!(this.tokens[this.pos]?.type === 'punct' && (this.tokens[this.pos] as { value: string }).value === ')')) {
          args.push(this.parseExpression());
          while (this.matchPunct(',')) {
            args.push(this.parseExpression());
          }
        }
        if (!this.matchPunct(')')) throw new Error('Expected ")" after arguments');
        return { kind: 'call', name: tok.value, args };
      }
      // reserved literal?
      if (Object.prototype.hasOwnProperty.call(RESERVED_LITERALS, tok.value)) {
        return { kind: 'literal', value: RESERVED_LITERALS[tok.value] };
      }
      return { kind: 'identifier', name: tok.value };
    }
    throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
  }

  private matchPunct(value: string): boolean {
    const tok = this.tokens[this.pos];
    if (tok && tok.type === 'punct' && tok.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private peekPunctOneOf(values: string[]): string | null {
    const tok = this.tokens[this.pos];
    if (tok && tok.type === 'punct' && values.includes(tok.value)) {
      return tok.value;
    }
    return null;
  }
}

function evaluateAst(node: AstNode, row: Record<string, JsonValue>): JsonValue {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'identifier':
      return Object.prototype.hasOwnProperty.call(row, node.name) ? row[node.name] : null;
    case 'unary': {
      const v = evaluateAst(node.operand, row);
      if (node.op === '-') return -toNumber(v);
      if (node.op === '+') return toNumber(v);
      return !toBoolean(v);
    }
    case 'binary': {
      const l = evaluateAst(node.left, row);
      const r = evaluateAst(node.right, row);
      return applyBinary(node.op, l, r);
    }
    case 'logical': {
      const l = evaluateAst(node.left, row);
      if (node.op === '&&') return toBoolean(l) ? evaluateAst(node.right, row) : l;
      return toBoolean(l) ? l : evaluateAst(node.right, row);
    }
    case 'ternary': {
      const t = evaluateAst(node.test, row);
      return toBoolean(t) ? evaluateAst(node.consequent, row) : evaluateAst(node.alternate, row);
    }
    case 'call': {
      const args = node.args.map((arg) => evaluateAst(arg, row));
      return callHelper(node.name, args);
    }
  }
}

function applyBinary(op: BinaryOp, l: JsonValue, r: JsonValue): JsonValue {
  switch (op) {
    case '+':
      // Mirror JS semantics: if either side is a string, concatenate; else add.
      if (typeof l === 'string' || typeof r === 'string') {
        return `${l ?? ''}${r ?? ''}`;
      }
      return toNumber(l) + toNumber(r);
    case '-':
      return toNumber(l) - toNumber(r);
    case '*':
      return toNumber(l) * toNumber(r);
    case '/': {
      const denom = toNumber(r);
      return denom === 0 ? null : toNumber(l) / denom;
    }
    case '%': {
      const denom = toNumber(r);
      return denom === 0 ? null : toNumber(l) % denom;
    }
    case '==':
      return looseEquals(l, r);
    case '!=':
      return !looseEquals(l, r);
    case '>':
      return compareScalar(l, r) > 0;
    case '<':
      return compareScalar(l, r) < 0;
    case '>=':
      return compareScalar(l, r) >= 0;
    case '<=':
      return compareScalar(l, r) <= 0;
  }
}

function callHelper(name: string, args: JsonValue[]): JsonValue {
  switch (name) {
    case 'TRIM':
      return args[0] === null || args[0] === undefined ? null : `${args[0]}`.trim();
    case 'UPPER':
      return args[0] === null || args[0] === undefined ? null : `${args[0]}`.toUpperCase();
    case 'LOWER':
      return args[0] === null || args[0] === undefined ? null : `${args[0]}`.toLowerCase();
    case 'CONCAT':
      return args.filter((v) => v !== null && v !== undefined).join('');
    case 'COALESCE':
      return args.find((v) => v !== null && v !== undefined && `${v}` !== '') ?? null;
    default:
      // Should be unreachable thanks to ALLOWED_FUNCTIONS check.
      throw new Error(`Disallowed function: ${name}`);
  }
}

function toNumber(v: JsonValue): number {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v as string);
  return Number.isNaN(n) ? 0 : n;
}

function toBoolean(v: JsonValue): boolean {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return Boolean(v);
}

function looseEquals(l: JsonValue, r: JsonValue): boolean {
  if (l === r) return true;
  if (l === null || l === undefined) return r === null || r === undefined;
  if (r === null || r === undefined) return false;
  if (typeof l === typeof r) return false;
  // Cross-type compare via string representation.
  return `${l}` === `${r}`;
}

function compareScalar(l: JsonValue, r: JsonValue): number {
  if (typeof l === 'number' && typeof r === 'number') return l - r;
  const ln = Number(l as string);
  const rn = Number(r as string);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
  return `${l ?? ''}`.localeCompare(`${r ?? ''}`);
}

function deduplicateRows(
  rows: Array<Record<string, JsonValue>>,
  keyColumns: string[],
  keep: 'latest' | 'first',
  orderBy: string,
): Array<Record<string, JsonValue>> {
  const groups = new Map<string, Array<Record<string, JsonValue>>>();
  rows.forEach((row) => {
    const key = keyColumns.map((column) => `${row[column] ?? ''}`).join('|');
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  return Array.from(groups.values()).map((group) => {
    if (!orderBy) {
      return group[0];
    }
    const sorted = [...group].sort((left, right) => compareValues(left[orderBy], `${right[orderBy] ?? ''}`));
    return keep === 'first' ? sorted[0] : sorted[sorted.length - 1];
  });
}

function aggregateRows(
  rows: Array<Record<string, JsonValue>>,
  groupBy: string[],
  aggregations: AggregateDefinitionDraft[],
): Array<Record<string, JsonValue>> {
  const groups = new Map<string, Array<Record<string, JsonValue>>>();
  rows.forEach((row) => {
    const key = groupBy.map((column) => `${row[column] ?? ''}`).join('|');
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  return Array.from(groups.values()).map((group) => {
    const result: Record<string, JsonValue> = {};
    groupBy.forEach((column) => {
      result[column] = group[0]?.[column] ?? null;
    });
    aggregations.forEach((aggregation) => {
      const alias = aggregation.alias || `${aggregation.function}_${aggregation.column || 'rows'}`;
      result[alias] = computeAggregation(group, aggregation);
    });
    return result;
  });
}

function computeAggregation(
  rows: Array<Record<string, JsonValue>>,
  aggregation: AggregateDefinitionDraft,
): JsonValue {
  switch (aggregation.function) {
    case 'count':
      return rows.length;
    case 'count_distinct':
      return new Set(rows.map((row) => `${row[aggregation.column] ?? ''}`)).size;
    case 'sum':
    case 'avg': {
      const numbers = rows.map((row) => Number(`${row[aggregation.column] ?? ''}`)).filter((value) => !Number.isNaN(value));
      const total = numbers.reduce((sum, value) => sum + value, 0);
      return aggregation.function === 'sum' ? total : numbers.length > 0 ? total / numbers.length : null;
    }
    case 'min':
      return [...rows]
        .map((row) => row[aggregation.column])
        .sort((left, right) => compareValues(left, `${right ?? ''}`))[0] ?? null;
    case 'max':
      return [...rows]
        .map((row) => row[aggregation.column])
        .sort((left, right) => compareValues(left, `${right ?? ''}`))
        .at(-1) ?? null;
  }
}

function cloneRows(rows: Array<Record<string, JsonValue>>): Array<Record<string, JsonValue>> {
  return rows.map((row) => ({ ...row }));
}

export function columnSamplePreview(column: DiscoveredColumn): string {
  return column.sample_values?.slice(0, 3).join(', ') ?? 'No sample values';
}
