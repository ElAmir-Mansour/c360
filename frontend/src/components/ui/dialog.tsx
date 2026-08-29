'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OVERLAY_BACKDROP,
  OVERLAY_CLOSE,
  OVERLAY_SURFACE,
} from '@/components/ui/ui-system';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

// Bypasses Radix's DialogPortal (Presence + PortalPrimitive asChild → SlotClone).
// @radix-ui/react-slot <=1.2.4: SlotClone calls composeRefs() without useMemo, so it
// produces a new ref callback every render. This flows into Presence.getElementRef(),
// making useComposedRefs deps unstable → setNode fires setState every render → infinite loop.
// React's createPortal sidesteps the PortalPrimitive(asChild) → SlotClone path entirely.
function NativePortal({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  React.useLayoutEffect(() => { setContainer(document.body); }, []);
  if (!container) return null;
  return createPortal(children, container);
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(OVERLAY_BACKDROP, className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <NativePortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Shared overlay chrome (bg/border/radius/shadow + fade+zoom motion,
        // motion-safe gated) comes from OVERLAY_SURFACE; only the dialog-specific
        // centering, sizing, longer duration/per-state easing and slide motion
        // are added here.
        OVERLAY_SURFACE,
        'fixed left-[50%] top-[50%] grid max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto p-6 duration-normal data-[state=open]:ease-decelerate data-[state=closed]:ease-accelerate motion-safe:data-[state=closed]:slide-out-to-left-1/2 motion-safe:data-[state=closed]:slide-out-to-top-[48%] motion-safe:data-[state=open]:slide-in-from-left-1/2 motion-safe:data-[state=open]:slide-in-from-top-[48%] sm:w-full',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          OVERLAY_CLOSE,
          'data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
        )}
      >
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </NativePortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
