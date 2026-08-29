# Watheeq organizational-structure import

The organizational registry remains the authoritative source for the Watheeq org chart,
routing, escalation and org-scoped access. Imports normalize XLSX, CSV and JSON into one
server contract and never infer structure from an image/PDF.

## Template columns

| Column | Required | Meaning |
| --- | --- | --- |
| `code` | yes | Stable, tenant-unique business code. |
| `parent_code` | no | Parent business code in the file or existing registry. |
| `entity_type` | yes | `company`, `business_unit`, `department`, `section`, or `shared_services_unit`. |
| `name_en`, `name_ar` | one | Bilingual display name. |
| `active` | no | Boolean; defaults to true. |
| `platform_org_unit_id` | no | Optional platform projection UUID. |
| `manager_user_id` | no | Manager UUID; mapped to the entity-type responsibility role. |
| `roles_json` | no | JSON array of `{role_key,user_id,label}` bindings. |
| `employees_json` | no | JSON array of employee membership records. |
| `metadata_json` | no | Free-form JSON master-data attributes. |

JSON uploads use the equivalent nested `name`, `roles`, `employees`, and `metadata` fields.

The import dialog offers each format in two variants: a complete blank template and a
simple filled sample for demonstrations. The filled sample contains the core hierarchy
columns plus `role_key` and `role_holder_user_id`, avoiding embedded JSON while creating
real responsibility assignments. Manager, multi-role, employee, platform and metadata
fields remain optional in the complete blank template for production onboarding.

## Modes and safety

- `create`: every submitted code must be new.
- `update`: every submitted code must already exist.
- `merge`: create missing codes and update existing codes.
- `replace`: merge the file and soft-deactivate omitted entities.

The server normalizes codes, detects duplicates, validates types/UUIDs/roles/parents,
checks the final graph for cycles, and topologically orders parents before children. A
dry-run writes an import-history job but no registry data. Apply acquires a tenant-scoped
advisory lock and commits entities, paths, roles, memberships, and replace deactivations in
one transaction. Any mutation error rolls the transaction back.

## HRIS and SCIM

The HR connector accepts configurable `parent_org_code`, `manager_lex_user_id`, and
`lex_user_id` mappings. SCIM uses the Clario extensions `parentOrgCode`, `entityType`,
`managerLexUserId`, `orgCode`, `roleKey`, and `lexUserId`. Org-unit records reconstruct the
tree; manager records create responsibility bindings; worker/user records upsert membership
and optional reporting-line data.
