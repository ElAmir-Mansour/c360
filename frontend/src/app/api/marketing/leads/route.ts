import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import type { LeadSubmission, LeadSubmissionReceipt } from '@/lib/marketing';

export const runtime = 'nodejs';

interface LeadRecord {
  id: string;
  createdAt: string;
  submission: LeadSubmission;
  metadata: {
    ip: string | null;
    userAgent: string | null;
  };
}

interface ValidationFailure {
  field: keyof LeadSubmission;
  message: string;
}

const MAX_TEXT = 2_000;

function defaultLeadFile(): string {
  return path.resolve(process.cwd(), '..', 'var', 'marketing-leads.jsonl');
}

function leadFilePath(): string {
  return process.env.MARKETING_LEADS_FILE || defaultLeadFile();
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown>, key: keyof LeadSubmission): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

function validateLeadSubmission(body: unknown): {
  submission?: LeadSubmission;
  errors?: ValidationFailure[];
} {
  const source = asObject(body);
  if (!source) {
    return {
      errors: [
        { field: 'message', message: 'request body must be a JSON object' },
      ],
    };
  }

  const submission: LeadSubmission = {
    fullName: readString(source, 'fullName'),
    workEmail: readString(source, 'workEmail').toLowerCase(),
    organisation: readString(source, 'organisation'),
    role: readString(source, 'role'),
    interest: readString(source, 'interest'),
    deployment: readString(source, 'deployment'),
    message: readString(source, 'message'),
    sourcePath: (readString(source, 'sourcePath') || '/contact') as `/${string}`,
  };

  const errors: ValidationFailure[] = [];
  if (!submission.fullName) errors.push({ field: 'fullName', message: 'full name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.workEmail)) {
    errors.push({ field: 'workEmail', message: 'valid work email is required' });
  }
  if (!submission.organisation) {
    errors.push({ field: 'organisation', message: 'organisation is required' });
  }
  if (!submission.interest) errors.push({ field: 'interest', message: 'interest is required' });
  if (!submission.deployment) {
    errors.push({ field: 'deployment', message: 'deployment preference is required' });
  }
  if (!submission.sourcePath.startsWith('/')) {
    errors.push({ field: 'sourcePath', message: 'source path must start with /' });
  }
  for (const [field, value] of Object.entries(submission) as [keyof LeadSubmission, string][]) {
    if (value.length > MAX_TEXT) {
      errors.push({ field, message: `must be ${MAX_TEXT} characters or less` });
    }
  }

  return errors.length ? { errors } : { submission };
}

async function persistLead(record: LeadRecord): Promise<void> {
  const file = leadFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

async function forwardLead(record: LeadRecord): Promise<boolean> {
  const webhook = process.env.MARKETING_LEADS_WEBHOOK_URL;
  if (!webhook) return false;

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    throw new Error(`lead webhook rejected request with ${res.status}`);
  }
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'request body must be valid JSON' },
      { status: 400 },
    );
  }

  const validation = validateLeadSubmission(body);
  if (!validation.submission) {
    return NextResponse.json(
      { error: 'validation_failed', errors: validation.errors ?? [] },
      { status: 400 },
    );
  }

  const record: LeadRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    submission: validation.submission,
    metadata: {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: req.headers.get('user-agent'),
    },
  };

  try {
    await persistLead(record);
    const forwarded = await forwardLead(record);
    const receipt: LeadSubmissionReceipt = {
      id: record.id,
      status: forwarded ? 'accepted' : 'queued',
    };
    return NextResponse.json(receipt, { status: forwarded ? 201 : 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to record lead';
    return NextResponse.json(
      { error: 'lead_record_failed', message },
      { status: 502 },
    );
  }
}
