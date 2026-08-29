'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useLocale } from '@/components/providers/locale-provider';
import { parseApiError } from '@/lib/format';
import {
  connectionToInput,
  createIdPConnection,
  deleteIdPConnection,
  emptyIdPConnectionInput,
  listIdPConnections,
  updateIdPConnection,
  type IdPConnection,
  type IdPConnectionInput,
} from '@/lib/admin/idp';
import { IdPConnectionForm } from '@/components/admin/sso/idp-connection-form';
import { IdPConnectionList } from '@/components/admin/sso/idp-connection-list';

// Backend gates writes on the tenant-admin verb; the frontend nav + this route
// gate on the same permission as the sibling Tenants admin surface.
const SSO_ADMIN_PERMISSION = 'admin:tenants';

type Bi = { en: string; ar: string };

const T = {
  eyebrow: { en: 'Identity & access', ar: 'الهوية والوصول' },
  title: { en: 'Single Sign-On (SSO)', ar: 'الدخول الموحّد (SSO)' },
  description: {
    en: 'Register and manage the external identity providers your organization signs in with. Users whose email matches a connection domain get a "Continue with SSO" option at login.',
    ar: 'سجّل وأدر مزوّدي الهوية الخارجيين الذين تسجّل مؤسستك الدخول عبرهم. يحصل المستخدمون الذين يطابق نطاق بريدهم اتصالًا على خيار "المتابعة عبر الدخول الموحّد" عند تسجيل الدخول.',
  },
  add: { en: 'Add connection', ar: 'إضافة اتصال' },
  emptyTitle: { en: 'No identity providers yet', ar: 'لا يوجد مزوّدو هوية بعد' },
  emptyDesc: {
    en: 'Add your first SSO connection (OIDC, Nafath or SAML) to let users sign in with your identity provider.',
    ar: 'أضف أول اتصال دخول موحّد (OIDC أو نفاذ أو SAML) للسماح للمستخدمين بتسجيل الدخول عبر مزوّد الهوية لديك.',
  },
  createTitle: { en: 'Add SSO connection', ar: 'إضافة اتصال دخول موحّد' },
  editTitle: { en: 'Edit SSO connection', ar: 'تعديل اتصال الدخول الموحّد' },
  dialogDesc: {
    en: 'Configure the external identity provider. The client secret is stored encrypted and never displayed.',
    ar: 'اضبط مزوّد الهوية الخارجي. يُخزَّن سر العميل مشفّرًا ولا يُعرض أبدًا.',
  },
  deleteTitle: { en: 'Delete SSO connection', ar: 'حذف اتصال الدخول الموحّد' },
  deleteDesc: {
    en: 'This removes the connection. Users linked through it will no longer be able to sign in via SSO. This cannot be undone.',
    ar: 'سيؤدي هذا إلى إزالة الاتصال. لن يتمكن المستخدمون المرتبطون عبره من تسجيل الدخول بالدخول الموحّد. لا يمكن التراجع.',
  },
  deleteConfirm: { en: 'Delete', ar: 'حذف' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  loadError: { en: 'Failed to load SSO connections', ar: 'تعذّر تحميل اتصالات الدخول الموحّد' },
  created: { en: 'Connection saved', ar: 'تم حفظ الاتصال' },
  deleted: { en: 'Connection deleted', ar: 'تم حذف الاتصال' },
  enabledMsg: { en: 'Connection enabled', ar: 'تم تفعيل الاتصال' },
  disabledMsg: { en: 'Connection disabled', ar: 'تم تعطيل الاتصال' },
  demoNoteTitle: { en: 'Demo endpoints', ar: 'نقاط نهاية تجريبية' },
  demoNote: {
    en: 'A demo connection may point at placeholder endpoints — the SSO button appears and initiates, but completing sign-in requires a reachable identity provider.',
    ar: 'قد يشير الاتصال التجريبي إلى نقاط نهاية مؤقتة — يظهر زر الدخول الموحّد ويبدأ، لكن إتمام تسجيل الدخول يتطلب مزوّد هوية يمكن الوصول إليه.',
  },
} satisfies Record<string, Bi>;

function SSOAdminContent() {
  const { locale } = useLocale();
  const tr = (b: Bi) => (locale === 'ar' ? b.ar : b.en);
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IdPConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IdPConnection | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['idp-connections'],
    queryFn: listIdPConnections,
  });

  const connections = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.provider.localeCompare(b.provider)),
    [data],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['idp-connections'] });

  const saveMutation = useMutation({
    mutationFn: (input: IdPConnectionInput) =>
      editing ? updateIdPConnection(editing.provider, input) : createIdPConnection(input),
    onSuccess: () => {
      toast.success(tr(T.created));
      setDialogOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: (c: IdPConnection) =>
      updateIdPConnection(c.provider, { ...connectionToInput(c), enabled: !c.enabled }),
    onMutate: (c: IdPConnection) => setBusyProvider(c.provider),
    onSuccess: (_res, c) => {
      toast.success(c.enabled ? tr(T.disabledMsg) : tr(T.enabledMsg));
      invalidate();
    },
    onError: (err) => toast.error(parseApiError(err)),
    onSettled: () => setBusyProvider(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (c: IdPConnection) => deleteIdPConnection(c.provider),
    onSuccess: () => {
      toast.success(tr(T.deleted));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(parseApiError(err)),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (c: IdPConnection) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const formInitial: IdPConnectionInput = editing
    ? connectionToInput(editing)
    : emptyIdPConnectionInput();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr(T.eyebrow)}
        title={tr(T.title)}
        description={tr(T.description)}
        actions={
          <Button onClick={openCreate}>
            <Plus className="me-2 h-4 w-4" />
            {tr(T.add)}
          </Button>
        }
      />

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{tr(T.demoNoteTitle)}</AlertTitle>
        <AlertDescription>{tr(T.demoNote)}</AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>{tr(T.loadError)}</AlertTitle>
          <AlertDescription>{parseApiError(error)}</AlertDescription>
        </Alert>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={tr(T.emptyTitle)}
          description={tr(T.emptyDesc)}
          action={{ label: tr(T.add), onClick: openCreate, icon: Plus }}
        />
      ) : (
        <IdPConnectionList
          connections={connections}
          busyProvider={busyProvider}
          onEdit={openEdit}
          onToggle={(c) => toggleMutation.mutate(c)}
          onDelete={(c) => setDeleteTarget(c)}
        />
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!saveMutation.isPending) {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? tr(T.editTitle) : tr(T.createTitle)}</DialogTitle>
            <DialogDescription>{tr(T.dialogDesc)}</DialogDescription>
          </DialogHeader>
          <IdPConnectionForm
            key={editing?.id ?? 'new'}
            initial={formInitial}
            isEdit={!!editing}
            submitting={saveMutation.isPending}
            onSubmit={(input) => saveMutation.mutate(input)}
            onCancel={() => {
              setDialogOpen(false);
              setEditing(null);
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={tr(T.deleteTitle)}
        description={tr(T.deleteDesc)}
        confirmLabel={tr(T.deleteConfirm)}
        cancelLabel={tr(T.cancel)}
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}

export default function SSOAdminPage() {
  return (
    <PermissionRedirect permission={SSO_ADMIN_PERMISSION}>
      <SSOAdminContent />
    </PermissionRedirect>
  );
}
