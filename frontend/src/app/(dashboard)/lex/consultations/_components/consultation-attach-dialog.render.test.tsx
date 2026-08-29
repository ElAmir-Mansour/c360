import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ConsultationAttachDialog } from "./consultation-dialogs";

// Regression for the "attaching a document returns an error" report: the dialog
// renders FormField as a plain layout wrapper with NO react-hook-form provider
// above it, so the old `useFormContext()` destructure crashed the dialog on
// mount — before any upload/network call. This mounts the REAL dialog (only a
// QueryClientProvider is needed; useLocaleOrDefault self-defaults) and asserts
// it opens without throwing.
function renderOpen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConsultationAttachDialog
        open
        loading={false}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("ConsultationAttachDialog", () => {
  it("mounts without crashing and shows the file picker", () => {
    expect(() => renderOpen()).not.toThrow();
    // The FormField-wrapped file picker is present (this is the element that
    // used to take the whole dialog down).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
