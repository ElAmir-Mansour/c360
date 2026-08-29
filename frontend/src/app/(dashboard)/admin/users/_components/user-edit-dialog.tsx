"use client";

import { useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useBackendErrors } from "@/hooks/use-backend-errors";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { showBackendError } from "@/lib/toast";
import type { User } from "@/types/models";
import { useAdminT } from "../../_lib/admin-i18n";

// Backend UpdateUserRequest only accepts: { first_name?, last_name?, avatar_url? }
// Status changes go through PUT /api/v1/users/{id}/status (separate endpoint)
const editUserSchema = z.object({
  first_name: z.string().min(2, "First name must be at least 2 characters"),
  last_name: z.string().min(2, "Last name must be at least 2 characters"),
});

type EditUserFormData = z.infer<typeof editUserSchema>;

interface UserEditDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function UserEditDialog({ user, open, onOpenChange, onSuccess }: UserEditDialogProps) {
  const labels = useAdminT();
  const applyBackendErrors = useBackendErrors<EditUserFormData>();

  const methods = useForm<EditUserFormData>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      first_name: user.first_name,
      last_name: user.last_name,
    },
  });

  useEffect(() => {
    if (user) {
      methods.reset({
        first_name: user.first_name,
        last_name: user.last_name,
      });
    }
  }, [user, methods]);

  // Exemplar wiring for useUnsavedChanges (admin surface): while the dialog is
  // open with edits, close attempts and router navigations confirm first.
  // Gated on `open` so a stale dirty form never blocks the page once closed.
  const { isDirty } = methods.formState;
  const { guard, guardOpenChange } = useUnsavedChanges(open && isDirty);
  const handleOpenChange = guardOpenChange(onOpenChange);

  const updateMutation = useApiMutation<unknown, EditUserFormData>(
    "put",
    `/api/v1/users/${user.id}`,
    {
      successMessage: labels.users.userUpdated,
      invalidateKeys: ["users"],
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
      onError: (error) => {
        // Map 422/409 validation details onto the form fields; the inline
        // FormErrorSummary then links each message to its control.
        const { summary } = applyBackendErrors(
          error,
          methods.setError,
          methods.setFocus
        );
        if (summary) showBackendError(error);
      },
    }
  );

  const onSubmit = methods.handleSubmit(async (data) => {
    await updateMutation.mutate(data);
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.users.editTitle}</DialogTitle>
          <DialogDescription>
            {labels.users.editDescriptionFor(`${user.first_name} ${user.last_name}`)}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FormErrorSummary />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField name="first_name" label={labels.users.firstName} required showSuccess>
                <Input
                  {...methods.register("first_name")}
                  disabled={updateMutation.isPending}
                />
              </FormField>
              <FormField name="last_name" label={labels.users.lastName} required showSuccess>
                <Input
                  {...methods.register("last_name")}
                  disabled={updateMutation.isPending}
                />
              </FormField>
            </div>
            <FormField name="email" label={labels.users.emailAddress}>
              <Input value={user.email} disabled className="bg-muted" />
            </FormField>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={updateMutation.isPending}
              >
                {labels.users.cancel}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? labels.users.saving : labels.users.saveChanges}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
        {guard}
      </DialogContent>
    </Dialog>
  );
}
