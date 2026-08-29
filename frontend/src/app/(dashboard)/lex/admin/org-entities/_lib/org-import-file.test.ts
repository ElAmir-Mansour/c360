import { describe, expect, it } from 'vitest';
import { parseOrgStructureFile } from './org-import-file';

describe('parseOrgStructureFile', () => {
  it('parses quoted CSV, parent codes, roles, employees, and metadata', async () => {
    const csv = [
      'code,parent_code,entity_type,name_en,name_ar,active,roles_json,metadata_json,employees_json',
      'LEGAL,ROOT,department,"Legal, Risk & Compliance",الإدارة القانونية,true,"[{""role_key"":""legal_director"",""user_id"":""11111111-1111-4111-8111-111111111111"",""label"":{""en"":""Director"",""ar"":""مدير""}}]","{""cost_center"":""CC-10""}","[{""user_id"":""22222222-2222-4222-8222-222222222222""}]"',
    ].join('\n');
    const file = new File([csv], 'org.csv', { type: 'text/csv' });

    const rows = await parseOrgStructureFile(file);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'LEGAL', parent_code: 'ROOT', name: { en: 'Legal, Risk & Compliance' } });
    expect(rows[0].roles?.[0].role_key).toBe('legal_director');
    expect(rows[0].metadata).toEqual({ cost_center: 'CC-10' });
    expect(rows[0].employees?.[0].user_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('accepts the canonical JSON contract', async () => {
    const file = new File([JSON.stringify([{ code: 'legal', entity_type: 'department', name: { en: 'Legal', ar: 'قانوني' }, active: false }])], 'org.json');
    const rows = await parseOrgStructureFile(file);
    expect(rows[0]).toMatchObject({ code: 'LEGAL', active: false, name: { en: 'Legal', ar: 'قانوني' } });
  });

  it('parses the XLSX template shape', async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c><c r="B1" t="inlineStr"><is><t>parent_code</t></is></c><c r="C1" t="inlineStr"><is><t>entity_type</t></is></c><c r="D1" t="inlineStr"><is><t>name_en</t></is></c><c r="E1" t="inlineStr"><is><t>name_ar</t></is></c><c r="F1" t="inlineStr"><is><t>active</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>ROOT</t></is></c><c r="C2" t="inlineStr"><is><t>company</t></is></c><c r="D2" t="inlineStr"><is><t>Example Company</t></is></c><c r="E2" t="inlineStr"><is><t>شركة مثال</t></is></c><c r="F2" t="inlineStr"><is><t>true</t></is></c></row></sheetData></worksheet>`);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buffer], 'org.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const rows = await parseOrgStructureFile(file);

    expect(rows[0]).toMatchObject({ code: 'ROOT', entity_type: 'company', name: { en: 'Example Company', ar: 'شركة مثال' } });
  });
});
