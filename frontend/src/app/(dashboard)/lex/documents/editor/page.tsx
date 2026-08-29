import { Suspense } from 'react';
import {
  EditorRouteSkeleton,
  LexDocumentEditorRoute,
} from '../_components/lex-editor-workspace';

export default function LexDocumentEditorPage() {
  return (
    <Suspense fallback={<EditorRouteSkeleton />}>
      <LexDocumentEditorRoute />
    </Suspense>
  );
}
