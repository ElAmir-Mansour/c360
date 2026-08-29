'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/components/providers/locale-provider';
import type { IdPConnectionInput, IdPKind } from '@/lib/admin/idp';

type Bi = { en: string; ar: string };

const T = {
  provider: { en: 'Provider slug', ar: 'معرّف المزود' },
  providerHint: {
    en: 'URL-safe identifier used in the login path (e.g. othaim-sso). Cannot be changed after creation.',
    ar: 'معرّف صالح للروابط يُستخدم في مسار تسجيل الدخول (مثل othaim-sso). لا يمكن تغييره بعد الإنشاء.',
  },
  displayName: { en: 'Display name', ar: 'الاسم الظاهر' },
  kind: { en: 'Protocol', ar: 'البروتوكول' },
  kindOidc: { en: 'OpenID Connect (OIDC)', ar: 'OpenID Connect (OIDC)' },
  kindNafath: { en: 'Nafath (national SSO)', ar: 'نفاذ (الدخول الوطني الموحّد)' },
  kindSaml: { en: 'SAML 2.0', ar: 'SAML 2.0' },
  enabled: { en: 'Enabled', ar: 'مُفعّل' },
  enabledHint: {
    en: 'Only enabled connections appear at login and can start a sign-in.',
    ar: 'تظهر الاتصالات المُفعّلة فقط عند تسجيل الدخول ويمكنها بدء الجلسة.',
  },
  issuer: { en: 'Issuer (discovery URL)', ar: 'المُصدِر (رابط الاكتشاف)' },
  issuerHint: {
    en: 'Provide the issuer to auto-discover endpoints, or fill in the endpoints below.',
    ar: 'أدخل المُصدِر لاكتشاف نقاط النهاية تلقائيًا، أو عبّئ نقاط النهاية أدناه.',
  },
  clientId: { en: 'Client ID', ar: 'معرّف العميل' },
  clientSecret: { en: 'Client secret', ar: 'سر العميل' },
  clientSecretHintNew: { en: 'Stored encrypted at rest.', ar: 'يُخزَّن مشفّرًا.' },
  clientSecretHintEdit: {
    en: 'Leave blank to keep the current secret.',
    ar: 'اتركه فارغًا للإبقاء على السر الحالي.',
  },
  authorizeUrl: { en: 'Authorization URL', ar: 'رابط التفويض' },
  tokenUrl: { en: 'Token URL', ar: 'رابط الرمز' },
  jwksUrl: { en: 'JWKS URL', ar: 'رابط JWKS' },
  userinfoUrl: { en: 'UserInfo URL', ar: 'رابط معلومات المستخدم' },
  redirectUrl: { en: 'Redirect URL (callback)', ar: 'رابط العودة (الاستدعاء)' },
  redirectHint: {
    en: 'Register this exact URL at the IdP. Leave blank to use the platform default.',
    ar: 'سجّل هذا الرابط بالضبط لدى مزود الهوية. اتركه فارغًا لاستخدام الافتراضي.',
  },
  scopes: { en: 'Scopes', ar: 'النطاقات' },
  scopesHint: { en: 'Comma-separated (e.g. openid, profile, email).', ar: 'مفصولة بفواصل (مثل openid، profile، email).' },
  metadata: { en: 'SAML metadata XML', ar: 'بيانات SAML الوصفية (XML)' },
  metadataHint: {
    en: 'Paste the IdP metadata XML document.',
    ar: 'الصق مستند بيانات مزود الهوية الوصفية (XML).',
  },
  defaultRole: { en: 'Default role for new users', ar: 'الدور الافتراضي للمستخدمين الجدد' },
  defaultRoleHint: {
    en: 'Role assigned to just-in-time provisioned users.',
    ar: 'الدور المُسنَد للمستخدمين المُنشَئين تلقائيًا.',
  },
  allowJit: { en: 'Just-in-time provisioning', ar: 'الإنشاء التلقائي للحسابات' },
  allowJitHint: {
    en: 'Auto-create a platform account for unknown users on first sign-in.',
    ar: 'إنشاء حساب تلقائيًا للمستخدمين غير المعروفين عند أول تسجيل دخول.',
  },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  save: { en: 'Save connection', ar: 'حفظ الاتصال' },
  saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  required: { en: 'Required', ar: 'مطلوب' },
} satisfies Record<string, Bi>;

interface IdPConnectionFormProps {
  initial: IdPConnectionInput;
  /** True when editing an existing connection (provider slug becomes read-only). */
  isEdit: boolean;
  submitting: boolean;
  onSubmit: (input: IdPConnectionInput) => void;
  onCancel: () => void;
}

export function IdPConnectionForm({
  initial,
  isEdit,
  submitting,
  onSubmit,
  onCancel,
}: IdPConnectionFormProps) {
  const { locale } = useLocale();
  const tr = (b: Bi) => (locale === 'ar' ? b.ar : b.en);

  const [form, setForm] = useState<IdPConnectionInput>(initial);
  const [scopesText, setScopesText] = useState(initial.scopes.join(', '));

  const isSaml = form.kind === 'saml';

  const set = <K extends keyof IdPConnectionInput>(key: K, value: IdPConnectionInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = useMemo(() => {
    if (!form.provider.trim()) return false;
    if (isSaml) return form.saml_metadata_xml.trim().length > 0;
    const hasIssuer = form.issuer.trim().length > 0;
    const hasEndpoints = form.authorize_url.trim().length > 0 && form.token_url.trim().length > 0;
    return form.client_id.trim().length > 0 && (hasIssuer || hasEndpoints);
  }, [form, isSaml]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scopes = scopesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    onSubmit({ ...form, scopes: scopes.length ? scopes : ['openid', 'profile', 'email'] });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="idp-provider">
            {tr(T.provider)} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="idp-provider"
            value={form.provider}
            onChange={(e) => set('provider', e.target.value)}
            placeholder="othaim-sso"
            disabled={isEdit}
            required
          />
          <p className="text-xs text-muted-foreground">{tr(T.providerHint)}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="idp-display-name">{tr(T.displayName)}</Label>
          <Input
            id="idp-display-name"
            value={form.display_name}
            onChange={(e) => set('display_name', e.target.value)}
            placeholder="Othaim Corporate SSO"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="idp-kind">{tr(T.kind)}</Label>
          <Select value={form.kind} onValueChange={(v) => set('kind', v as IdPKind)}>
            <SelectTrigger id="idp-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oidc">{tr(T.kindOidc)}</SelectItem>
              <SelectItem value="nafath">{tr(T.kindNafath)}</SelectItem>
              <SelectItem value="saml">{tr(T.kindSaml)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{tr(T.enabled)}</p>
            <p className="text-xs text-muted-foreground">{tr(T.enabledHint)}</p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
            aria-label={tr(T.enabled)}
          />
        </div>
      </div>

      {isSaml ? (
        <div className="space-y-1.5">
          <Label htmlFor="idp-metadata">
            {tr(T.metadata)} <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="idp-metadata"
            value={form.saml_metadata_xml}
            onChange={(e) => set('saml_metadata_xml', e.target.value)}
            rows={8}
            placeholder="<EntityDescriptor …>"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{tr(T.metadataHint)}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="idp-issuer">{tr(T.issuer)}</Label>
            <Input
              id="idp-issuer"
              value={form.issuer}
              onChange={(e) => set('issuer', e.target.value)}
              placeholder="https://sso.othaim.demo/realms/othaim"
            />
            <p className="text-xs text-muted-foreground">{tr(T.issuerHint)}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="idp-client-id">
                {tr(T.clientId)} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="idp-client-id"
                value={form.client_id}
                onChange={(e) => set('client_id', e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idp-client-secret">{tr(T.clientSecret)}</Label>
              <Input
                id="idp-client-secret"
                type="password"
                value={form.client_secret}
                onChange={(e) => set('client_secret', e.target.value)}
                autoComplete="new-password"
                placeholder={isEdit ? '••••••••' : ''}
              />
              <p className="text-xs text-muted-foreground">
                {isEdit ? tr(T.clientSecretHintEdit) : tr(T.clientSecretHintNew)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="idp-authorize">{tr(T.authorizeUrl)}</Label>
              <Input
                id="idp-authorize"
                value={form.authorize_url}
                onChange={(e) => set('authorize_url', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idp-token">{tr(T.tokenUrl)}</Label>
              <Input
                id="idp-token"
                value={form.token_url}
                onChange={(e) => set('token_url', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idp-jwks">{tr(T.jwksUrl)}</Label>
              <Input
                id="idp-jwks"
                value={form.jwks_url}
                onChange={(e) => set('jwks_url', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idp-userinfo">{tr(T.userinfoUrl)}</Label>
              <Input
                id="idp-userinfo"
                value={form.userinfo_url}
                onChange={(e) => set('userinfo_url', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="idp-scopes">{tr(T.scopes)}</Label>
            <Input
              id="idp-scopes"
              value={scopesText}
              onChange={(e) => setScopesText(e.target.value)}
              placeholder="openid, profile, email"
            />
            <p className="text-xs text-muted-foreground">{tr(T.scopesHint)}</p>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="idp-redirect">{tr(T.redirectUrl)}</Label>
        <Input
          id="idp-redirect"
          value={form.redirect_url}
          onChange={(e) => set('redirect_url', e.target.value)}
          placeholder="https://…/api/v1/auth/sso/othaim-sso/callback"
        />
        <p className="text-xs text-muted-foreground">{tr(T.redirectHint)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="idp-default-role">{tr(T.defaultRole)}</Label>
          <Input
            id="idp-default-role"
            value={form.default_role_slug}
            onChange={(e) => set('default_role_slug', e.target.value)}
            placeholder="viewer"
          />
          <p className="text-xs text-muted-foreground">{tr(T.defaultRoleHint)}</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{tr(T.allowJit)}</p>
            <p className="text-xs text-muted-foreground">{tr(T.allowJitHint)}</p>
          </div>
          <Switch
            checked={form.allow_jit_provisioning}
            onCheckedChange={(v) => set('allow_jit_provisioning', v)}
            aria-label={tr(T.allowJit)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {tr(T.cancel)}
        </Button>
        <Button type="submit" disabled={submitting || !canSubmit}>
          {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {submitting ? tr(T.saving) : tr(T.save)}
        </Button>
      </div>
    </form>
  );
}
