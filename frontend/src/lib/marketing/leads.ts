export interface LeadSubmission {
  fullName: string;
  workEmail: string;
  organisation: string;
  role: string;
  interest: string;
  deployment: string;
  message: string;
  sourcePath: `/${string}`;
}

export interface LeadSubmissionReceipt {
  id: string;
  status: 'accepted' | 'queued';
}

export type LeadSubmissionEndpoint = (
  submission: LeadSubmission,
) => Promise<LeadSubmissionReceipt>;

export const MARKETING_LEAD_ENDPOINT_STATUS = 'implemented' as const;

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function createLeadSubmissionFromFormData(
  formData: FormData,
  sourcePath: `/${string}` = '/contact',
): LeadSubmission {
  return {
    fullName: readFormString(formData, 'name'),
    workEmail: readFormString(formData, 'email'),
    organisation: readFormString(formData, 'organisation'),
    role: readFormString(formData, 'role'),
    interest: readFormString(formData, 'interest'),
    deployment: readFormString(formData, 'deployment'),
    message: readFormString(formData, 'message'),
    sourcePath,
  };
}
