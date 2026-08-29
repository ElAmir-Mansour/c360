'use client';

import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * FaqAccordion — accessible, token-driven FAQ section for the ClarioDR marketing
 * surface.
 *
 * Built on Radix's Accordion primitive (the same one shadcn/ui derives from) for
 * complete WAI-ARIA semantics and keyboard support out of the box:
 *  - each trigger is a `button` with `aria-expanded` + `aria-controls`,
 *  - the panel is `region`-associated via `aria-labelledby`,
 *  - Arrow Up/Down move between triggers, Home/End jump to first/last, Space/Enter
 *    toggle, and Tab respects the natural reading order.
 *
 * Single (`type="single"`, accordion-style) or multiple (`type="multiple"`) panels
 * may be open. Content arrives entirely via props so the section is bilingual-ready
 * and RTL-safe (logical inset/text-start, `rtl:`-aware chevron-free +/- affordance).
 *
 * Token discipline: surfaces (`surface-card`), borders (`outline-subtle`), text
 * (`content-primary` / `content-secondary`), radius (`rounded-card`), spacing
 * (`card-padding`, `section-y`) and motion (`duration-normal`, accordion keyframes)
 * are all token-backed. No hardcoded colours, spacing, type, radii or motion.
 */
export interface FaqItem {
  /** Stable identifier; also used as the Radix item value. */
  id: string;
  /** Question text (already localized by the caller). */
  question: React.ReactNode;
  /** Answer content (string or rich nodes; already localized). */
  answer: React.ReactNode;
}

interface FaqAccordionBaseProps {
  /** Question / answer pairs. */
  items: FaqItem[];
  /** Optional eyebrow / overline above the heading. */
  eyebrow?: React.ReactNode;
  /** Optional section heading. */
  heading?: React.ReactNode;
  /** Optional supporting subcopy under the heading. */
  description?: React.ReactNode;
  /**
   * Heading level for the section title, for correct document outline.
   * @default 2
   */
  headingLevel?: 2 | 3;
  className?: string;
  /** Accessible label for the section landmark when no visible heading is shown. */
  'aria-label'?: string;
}

type FaqAccordionProps = FaqAccordionBaseProps &
  (
    | {
        /** Single-expand (classic accordion). */
        type?: 'single';
        /** Allow closing the open item by clicking it again. @default true */
        collapsible?: boolean;
        defaultValue?: string;
      }
    | {
        /** Multi-expand (independent panels). */
        type: 'multiple';
        defaultValue?: string[];
      }
  );

function SectionHeading({
  level,
  children,
  id,
}: {
  level: 2 | 3;
  children: React.ReactNode;
  id?: string;
}) {
  const Tag = (`h${level}` as unknown) as 'h2' | 'h3';
  return (
    <Tag
      id={id}
      className={cn(
        level === 2 ? 'text-h2' : 'text-h3',
        'font-display font-semibold text-content-primary',
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * FaqAccordion renders a fully accessible, token-themed FAQ list.
 */
export function FaqAccordion(props: FaqAccordionProps) {
  const {
    items,
    eyebrow,
    heading,
    description,
    headingLevel = 2,
    className,
    'aria-label': ariaLabel,
  } = props;

  const headingId = React.useId();
  const hasHeading = Boolean(heading);

  // Discriminate Radix props without leaking incompatible unions to the JSX.
  const rootProps:
    | AccordionPrimitive.AccordionSingleProps
    | AccordionPrimitive.AccordionMultipleProps =
    props.type === 'multiple'
      ? {
          type: 'multiple',
          defaultValue: props.defaultValue,
        }
      : {
          type: 'single',
          collapsible: props.collapsible ?? true,
          defaultValue: props.defaultValue,
        };

  return (
    <section
      className={cn('w-full px-section-x py-section-y', className)}
      aria-label={!hasHeading ? ariaLabel : undefined}
      aria-labelledby={hasHeading ? headingId : undefined}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {(eyebrow || heading || description) && (
          <div className="flex flex-col gap-3 text-center">
            {eyebrow && (
              <span className="text-overline font-display font-semibold uppercase tracking-[0.08em] text-brand-primary-600 dark:text-brand-primary-300">
                {eyebrow}
              </span>
            )}
            {heading && (
              <SectionHeading level={headingLevel} id={headingId}>
                {heading}
              </SectionHeading>
            )}
            {description && (
              <p className="text-body-lg text-content-secondary">{description}</p>
            )}
          </div>
        )}

        <AccordionPrimitive.Root
          {...rootProps}
          className="flex flex-col gap-3"
        >
          {items.map((item) => (
            <AccordionPrimitive.Item
              key={item.id}
              value={item.id}
              className={cn(
                'overflow-hidden rounded-card border border-outline-subtle bg-surface-card',
                'shadow-elevation-1 transition-colors duration-normal ease-standard',
                'data-[state=open]:border-outline-strong',
              )}
            >
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger
                  className={cn(
                    'group flex flex-1 items-center justify-between gap-4 p-card-padding text-start',
                    'text-h4 font-display font-medium text-content-primary',
                    'transition-colors duration-fast ease-standard',
                    'hover:text-brand-primary-700 dark:hover:text-brand-primary-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
                  )}
                >
                  <span>{item.question}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                      'border border-outline-subtle text-content-secondary',
                      'transition-colors duration-fast ease-standard',
                      'group-hover:border-brand-primary-400 group-hover:text-brand-primary-600',
                      'dark:group-hover:text-brand-primary-300',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 transition-opacity duration-fast group-data-[state=open]:opacity-0" />
                    <Minus className="absolute h-3.5 w-3.5 opacity-0 transition-opacity duration-fast group-data-[state=open]:opacity-100" />
                  </span>
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionPrimitive.Content
                className={cn(
                  'overflow-hidden text-body text-content-secondary',
                  'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down',
                )}
              >
                <div className="px-card-padding pb-card-padding pt-0 leading-relaxed">
                  {item.answer}
                </div>
              </AccordionPrimitive.Content>
            </AccordionPrimitive.Item>
          ))}
        </AccordionPrimitive.Root>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Gallery / Storybook default export                                        */
/* ------------------------------------------------------------------------- */

/** Original ClarioDR DR/runbook/RTO FAQ content — gallery + test fixture. */
export const SAMPLE_FAQ_ITEMS: FaqItem[] = [
  {
    id: 'rto-evidence',
    question: 'How does ClarioDR prove our RTO without a real outage?',
    answer:
      'Every runbook execution is timed step-by-step against your declared recovery time objective. ClarioDR records the actual recovery time (RTA) for each rehearsal, surfaces the gap to your RTO, and produces a signed, tamper-evident evidence record you can hand to auditors and regulators.',
  },
  {
    id: 'data-mover',
    question: 'Where does my recovery data live during a failover?',
    answer:
      'ClarioDR orchestrates the data mover inside your own sovereign boundary. Replication and cutover run across infrastructure you control — SaaS, on-premises, or air-gapped — so recovery data never leaves your jurisdiction.',
  },
  {
    id: 'runbook-automation',
    question: 'Can runbook steps mix automated and human approval tasks?',
    answer:
      'Yes. A runbook composes automated tasks (scripts, replication switches, health checks) with human gates (approvals, manual validations). Blocked steps pause the run and notify the owner; the timeline shows exactly which step is running, passed, failed, degraded, or blocked.',
  },
  {
    id: 'sovereign-deploy',
    question: 'Is ClarioDR available for air-gapped and regulated environments?',
    answer:
      'ClarioDR ships as a sovereign deployment with flat, predictable pricing. The orchestrator and asset registry run entirely within your environment, with no outbound dependency on a vendor cloud during a recovery event.',
  },
];

export default function FaqAccordionGallery() {
  return (
    <FaqAccordion
      type="single"
      eyebrow="Frequently asked"
      heading="ClarioDR recovery, answered"
      description="How sovereign disaster recovery, runbook automation, and RTO evidence work in practice."
      items={SAMPLE_FAQ_ITEMS}
    />
  );
}
