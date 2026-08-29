# Security Policy

## Reporting Vulnerabilities

Report suspected vulnerabilities through the project maintainers' private security channel. Do not open public issues for exploitable findings, credentials, customer data exposure, or infrastructure access concerns.

Include the affected component, reproduction steps, impact, affected deployment mode, and any relevant logs or request IDs. The security owner should acknowledge the report, triage severity, and coordinate a remediation plan before public disclosure.

## Shared Responsibility

Clario360 application services implement authentication, authorization, audit logging, encryption controls, secure headers, file scanning, and tenant isolation. Infrastructure controls such as datacenter physical access, hardware custody, managed network perimeter controls, and cloud-provider personnel access remain the responsibility of the hosting provider or customer-operated environment.

For self-hosted, on-prem, and air-gapped deployments, customers are responsible for Kubernetes cluster hardening, node access, backup custody, network segmentation, secrets custody, and physical facility controls. Clario360 deployment assets provide policy templates and secure defaults, but operators must validate them against their local compliance obligations.
