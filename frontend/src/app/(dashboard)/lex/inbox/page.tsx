'use client';

import { LexRouteGuard } from '../_guards/lex-route-guard';
import { LexInboxContent } from './_components/lex-inbox-content';

export default function LexInboxPage() {
  return (
    <LexRouteGuard route="/lex/inbox">
      <LexInboxContent />
    </LexRouteGuard>
  );
}
