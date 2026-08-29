import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'WatheeqTech How-to — Clario360 Documentation',
  description:
    'Complete operating guidance for every WatheeqTech legal workflow and application page.',
};

export default function WatheeqDocumentationPage() {
  redirect('/docs/watheeq/overview');
}
