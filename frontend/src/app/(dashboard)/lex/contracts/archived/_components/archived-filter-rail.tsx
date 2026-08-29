'use client';

import { RotateCcw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { userDisplayName } from '@/lib/enterprise/utils';
import type { UserDirectoryEntry } from '@/types/suites';
import type { ArchivedFiltersState } from '../_lib/use-archived-contracts';
import { useArchivedLabels } from '../_lib/archived-labels';

const CONTRACT_TYPES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
] as const;

const CONTRACT_STATUSES = [
  '',
  'draft',
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
  'suspended',
  'expired',
  'terminated',
  'renewed',
  'cancelled',
] as const;

interface ArchivedFilterRailProps {
  filters: ArchivedFiltersState;
  users: UserDirectoryEntry[];
  usersLoading?: boolean;
  activeFilterCount: number;
  onPatch: (next: Partial<ArchivedFiltersState>) => void;
  onReset: () => void;
}

export function ArchivedFilterRail({
  filters,
  users,
  usersLoading = false,
  activeFilterCount,
  onPatch,
  onReset,
}: ArchivedFilterRailProps) {
  const { filters: labels } = useArchivedLabels();

  return (
    <section
      aria-labelledby="archive-filter-title"
      className="rounded-2xl border border-clario-border bg-white p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="archive-filter-title" className="text-base font-bold text-clario-ink">
            {labels.heading}
          </h2>
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-clario-tint px-2 py-0.5 text-xs font-semibold text-clario-primary">
              {labels.activeCount(activeFilterCount)}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={activeFilterCount === 0}
        >
          <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
          {labels.reset}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_160px_160px]">
        <div className="relative">
          <Label htmlFor="archive-search" className="sr-only">
            {labels.search}
          </Label>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-clario-muted"
          />
          <Input
            id="archive-search"
            type="search"
            value={filters.search}
            onChange={(event) => onPatch({ search: event.target.value })}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchAria}
            className="h-10 border-0 bg-clario-tint ps-10 shadow-none"
          />
        </div>

        <FilterSelect
          id="archive-type"
          label={labels.originalType}
          labelHidden
          value={filters.type}
          onChange={(type) => onPatch({ type })}
        >
          <option value="">{labels.typePlaceholder}</option>
          {CONTRACT_TYPES.map((value) => (
            <option key={value} value={value}>
              {labels.typeOptions[value]}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          id="archive-status"
          label={labels.originalStatus}
          labelHidden
          value={filters.status}
          onChange={(status) => onPatch({ status })}
        >
          {CONTRACT_STATUSES.map((value) => (
            <option key={value || 'all'} value={value}>
              {labels.statusOptions[value]}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <FilterInput
          id="archive-date-from"
          type="date"
          label={labels.archiveFrom}
          value={filters.archiveFrom ?? ''}
          max={filters.archiveTo}
          onChange={(archiveFrom) => onPatch({ archiveFrom: archiveFrom || undefined })}
        />
        <FilterInput
          id="archive-date-to"
          type="date"
          label={labels.archiveTo}
          value={filters.archiveTo ?? ''}
          min={filters.archiveFrom}
          onChange={(archiveTo) => onPatch({ archiveTo: archiveTo || undefined })}
        />
        <UserFilterSelect
          id="archive-archived-by"
          label={labels.archivedBy}
          value={filters.archivedBy}
          users={users}
          loading={usersLoading}
          placeholder={labels.allUsers}
          onChange={(archivedBy) => onPatch({ archivedBy })}
        />
        <UserFilterSelect
          id="archive-owner"
          label={labels.owner}
          value={filters.ownerUserId}
          users={users}
          loading={usersLoading}
          placeholder={labels.allUsers}
          onChange={(ownerUserId) => onPatch({ ownerUserId })}
        />
        <FilterInput
          id="archive-department"
          label={labels.department}
          value={filters.department}
          placeholder={labels.departmentPlaceholder}
          onChange={(department) => onPatch({ department })}
        />
        <FilterInput
          id="archive-tag"
          label={labels.tag}
          value={filters.tag}
          placeholder={labels.tagPlaceholder}
          onChange={(tag) => onPatch({ tag })}
        />
      </div>
    </section>
  );
}

function FilterInput({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  min,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
  placeholder?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function UserFilterSelect({
  id,
  label,
  value,
  users,
  loading,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  users: UserDirectoryEntry[];
  loading: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <FilterSelect
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      disabled={loading}
    >
      <option value="">{placeholder}</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {userDisplayName(user)} — {user.email}
        </option>
      ))}
    </FilterSelect>
  );
}

/**
 * `labelHidden` is for the compact top row, where each select carries its own
 * "all …" placeholder and sits flush with the search box. Everywhere else the
 * label must stay visible — the archived-by and owner selects list the same
 * user directory, so without it they read as the same control twice and sit a
 * label-height above the fields beside them.
 */
function FilterSelect({
  id,
  label,
  labelHidden = false,
  value,
  onChange,
  children,
  disabled = false,
}: {
  id: string;
  label: string;
  labelHidden?: boolean;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={labelHidden ? 'sr-only' : undefined}>
        {label}
      </Label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-clario-border bg-white px-3 text-sm text-clario-ink outline-none transition focus:border-action focus:ring-2 focus:ring-action/20"
      >
        {children}
      </select>
    </div>
  );
}
