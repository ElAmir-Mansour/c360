'use client';

import Link from 'next/link';
import { Building2, Check, ChevronDown, Settings2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTenants } from '@/hooks/use-tenants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function tenantLabel(name: string, companyName?: string): string {
  return companyName || name;
}

/**
 * Header tenant context. Regular users see a static chip with their workspace
 * name; platform super-admins (permission `*`) get a dropdown to jump between
 * tenants and reach tenant management.
 */
export function TenantSwitcher() {
  const { tenant, hasPermission } = useAuth();
  if (!tenant) return null;

  const displayName = tenantLabel(tenant.name, tenant.settings?.branding?.company_name);
  const isPlatformAdmin = hasPermission('*');

  if (!isPlatformAdmin) {
    return (
      <div
        className="hidden h-9 items-center gap-2 rounded-lg border border-primary/15 bg-card px-2.5 shadow-sm sm:flex"
        title={displayName}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="max-w-[140px] truncate text-[13px] font-medium text-foreground">{displayName}</span>
      </div>
    );
  }

  return <TenantSwitcherMenu currentId={tenant.id} displayName={displayName} />;
}

function TenantSwitcherMenu({ currentId, displayName }: { currentId: string; displayName: string }) {
  const { data } = useTenants({ page: 1, per_page: 8, order: 'desc' });
  const tenants = data?.data ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Switch tenant"
          className="hidden h-9 items-center gap-2 rounded-lg border border-primary/15 bg-card px-2.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-secondary sm:flex"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="max-w-[140px] truncate text-[13px] font-medium text-foreground">{displayName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Tenants</DropdownMenuLabel>
        {tenants.map((t) => (
          <DropdownMenuItem key={t.id} asChild>
            <Link href={`/admin/tenants/${t.id}`} className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span className="flex-1 truncate">{tenantLabel(t.name, t.settings?.branding?.company_name)}</span>
              {t.id === currentId ? <Check className="h-4 w-4 text-primary" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/admin/tenants" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Manage tenants
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
