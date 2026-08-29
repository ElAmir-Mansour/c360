import { NextRequest, NextResponse } from 'next/server';

import { isBFFOriginAllowed, bffCSRFRejection } from '@/lib/bff-csrf';
import { buildForwardHeaders, gatewayFetch, safeJson } from '@/lib/bff-proxy';

const LOCAL_SLIDE_TOKEN = 'local-slide-confirm:v1';

type BotChallengeProvider = 'local-slide-confirm' | 'gateway' | 'turnstile' | 'hcaptcha';

interface VerifyBody {
  token?: string;
  provider?: BotChallengeProvider;
}

interface ProviderResult {
  verified: boolean;
  available: boolean;
  provider: BotChallengeProvider;
  server_verified: boolean;
  reason?: string;
  errors?: string[];
}

interface ProviderJSON {
  success?: boolean;
  verified?: boolean;
  reason?: string;
  'error-codes'?: string[];
  errors?: string[];
}

function clientIP(req: NextRequest): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || undefined;
  return req.headers.get('x-real-ip')?.trim() || undefined;
}

function configuredProviders(): BotChallengeProvider[] {
  const providers: BotChallengeProvider[] = ['local-slide-confirm'];
  if (process.env.BOT_CHALLENGE_VERIFY_PATH) providers.push('gateway');
  if (process.env.TURNSTILE_SECRET_KEY) providers.push('turnstile');
  if (process.env.HCAPTCHA_SECRET_KEY) providers.push('hcaptcha');
  return providers;
}

function isProvider(value: unknown): value is BotChallengeProvider {
  return (
    value === 'local-slide-confirm' ||
    value === 'gateway' ||
    value === 'turnstile' ||
    value === 'hcaptcha'
  );
}

function inferProvider(body: VerifyBody): BotChallengeProvider {
  if (isProvider(body.provider)) return body.provider;
  if (body.token === LOCAL_SLIDE_TOKEN) return 'local-slide-confirm';
  if (process.env.BOT_CHALLENGE_VERIFY_PATH) return 'gateway';
  if (process.env.TURNSTILE_SECRET_KEY) return 'turnstile';
  if (process.env.HCAPTCHA_SECRET_KEY) return 'hcaptcha';
  return 'local-slide-confirm';
}

async function verifyWithGateway(
  req: NextRequest,
  token: string,
): Promise<ProviderResult> {
  const path = process.env.BOT_CHALLENGE_VERIFY_PATH;
  if (!path) {
    return {
      verified: false,
      available: false,
      provider: 'gateway',
      server_verified: false,
      reason: 'gateway verifier is not configured',
    };
  }

  const result = await gatewayFetch(path, {
    method: 'POST',
    headers: buildForwardHeaders(req, { json: true, device: true }),
    body: JSON.stringify({ token }),
  });
  if (!result.ok) {
    return {
      verified: false,
      available: false,
      provider: 'gateway',
      server_verified: true,
      reason: result.networkError
        ? 'gateway verifier is unreachable'
        : `gateway verifier returned ${result.status}`,
    };
  }

  const data = await safeJson<ProviderJSON>(result.response);
  return {
    verified: data?.verified === true || data?.success === true,
    available: true,
    provider: 'gateway',
    server_verified: true,
    reason: data?.reason,
    errors: data?.errors ?? data?.['error-codes'],
  };
}

async function verifyProviderToken(
  provider: 'turnstile' | 'hcaptcha',
  token: string,
  remoteip?: string,
): Promise<ProviderResult> {
  const secret =
    provider === 'turnstile'
      ? process.env.TURNSTILE_SECRET_KEY
      : process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) {
    return {
      verified: false,
      available: false,
      provider,
      server_verified: false,
      reason: `${provider} secret is not configured`,
    };
  }

  const endpoint =
    provider === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
      : 'https://hcaptcha.com/siteverify';
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set('remoteip', remoteip);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    return {
      verified: false,
      available: false,
      provider,
      server_verified: true,
      reason: `${provider} verifier returned ${response.status}`,
    };
  }

  const data = (await response.json().catch(() => null)) as ProviderJSON | null;
  return {
    verified: data?.success === true,
    available: true,
    provider,
    server_verified: true,
    reason: data?.reason,
    errors: data?.['error-codes'] ?? data?.errors,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isBFFOriginAllowed(req)) return bffCSRFRejection();

  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const provider = inferProvider(body);
  if (provider === 'local-slide-confirm') {
    return NextResponse.json({
      verified: token === LOCAL_SLIDE_TOKEN,
      available: true,
      provider,
      server_verified: false,
      reason: 'local challenge result is client-side by design',
    } satisfies ProviderResult);
  }
  if (provider === 'gateway') {
    const result = await verifyWithGateway(req, token);
    return NextResponse.json(result, { status: result.available ? 200 : 503 });
  }

  const result = await verifyProviderToken(provider, token, clientIP(req));
  return NextResponse.json(result, { status: result.available ? 200 : 503 });
}

export async function GET(): Promise<NextResponse> {
  const providers = configuredProviders();
  return NextResponse.json({
    available: providers.length > 0,
    providers,
    server_verified: providers.some((p) => p !== 'local-slide-confirm'),
  });
}
