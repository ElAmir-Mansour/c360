import type { MarketingPrinciple } from './types';

/** Canonical Clario360 public platform principles. */
export const MARKETING_PRINCIPLES = [
  {
    title: "Platform-First",
    description: "Shared services built once — every app consumes, none re-implements.",
    icon: "cube"
  },
  {
    title: "Config Over Code",
    description: "Workflows, forms, integrations and automation are admin-configured, not redeployed.",
    icon: "workflow"
  },
  {
    title: "Contract-First APIs",
    description: "OpenAPI / protobuf contracts precede code; versioned, generated, enforced at the gateway.",
    icon: "doc"
  },
  {
    title: "Event-Driven Core",
    description: "Suites integrate through the event bus — no direct cross-suite coupling.",
    icon: "network"
  },
  {
    title: "Sovereign by Design",
    description: "Every component deploys SaaS, on-prem and air-gapped — no cloud-only dependencies.",
    icon: "globe"
  },
  {
    title: "Arabic-First UX",
    description: "RTL/LTR and bilingual content are platform concerns, solved once in the shared shell.",
    icon: "scale"
  }
] as const satisfies readonly MarketingPrinciple[];
