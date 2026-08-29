import { render, screen } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";

function InForm({ error }: { error?: string }) {
  const form = useForm({ defaultValues: { title: "" } });
  if (error) {
    form.formState.errors.title = { type: "manual", message: error };
  }
  return (
    <FormProvider {...form}>
      <FormField name="title" label="Title">
        <input id="title" />
      </FormField>
    </FormProvider>
  );
}

describe("FormField", () => {
  // Regression: `useFormContext()` returns null (it does not throw) when there
  // is no FormProvider above, so destructuring `formState` off it crashed the
  // whole route — this is what took down the Lex consultation Classify and
  // Attach-document dialogs, which use FormField as a plain layout wrapper.
  it("renders standalone with no FormProvider above it", () => {
    expect(() =>
      render(
        <FormField name="title" label="Title" required description="Some help">
          <input id="title" />
        </FormField>,
      ),
    ).not.toThrow();

    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Some help")).toBeInTheDocument();
    // No form context means no validation state to surface.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still surfaces validation errors when inside a form", () => {
    render(<InForm error="Title is required" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Title is required");
  });

  it("shows no error inside a form when the field is valid", () => {
    render(<InForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
