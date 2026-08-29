import type {
  Investigation,
  InvestigationPriority,
} from "@/lib/lex/investigations";

export interface InvestigationReportFinding {
  id: string;
  title: string;
  description: string;
  severity: InvestigationPriority;
}

export interface InvestigationReportRecommendation {
  id: string;
  title: string;
  description: string;
  owner: string;
  timing: string;
}

export interface InvestigationReportDraft {
  version: number;
  executiveSummary: string;
  findings: InvestigationReportFinding[];
  recommendations: InvestigationReportRecommendation[];
  savedAt?: string;
}

const REPORT_METADATA_KEY = "investigation_report_draft";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readPriority(
  value: unknown,
  fallback: InvestigationPriority,
): InvestigationPriority {
  return value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
    ? value
    : fallback;
}

function splitNarrative(value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}|(?=\n\s*(?:[-•]|\d+[.)])\s+)/)
    .map((part) => part.replace(/^\s*(?:[-•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  return blocks.length > 0 ? blocks : [normalized];
}

function titleFromNarrative(value: string, fallback: string): string {
  const firstLine = value.split("\n")[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (!firstSentence) return fallback;
  return firstSentence.length > 88
    ? `${firstSentence.slice(0, 85).trimEnd()}…`
    : firstSentence;
}

function findingsFromNarrative(
  investigation: Investigation,
  findingFallback: string,
): InvestigationReportFinding[] {
  return splitNarrative(investigation.findings).map((description, index) => ({
    id: `finding-${index + 1}`,
    title: titleFromNarrative(description, `${findingFallback} ${index + 1}`),
    description,
    severity:
      index === 0 ? investigation.priority : index === 1 ? "high" : "medium",
  }));
}

function recommendationsFromNarrative(
  investigation: Investigation,
  recommendationFallback: string,
  ownerFallback: string,
): InvestigationReportRecommendation[] {
  return splitNarrative(investigation.recommendations).map(
    (description, index) => ({
      id: `recommendation-${index + 1}`,
      title: titleFromNarrative(
        description,
        `${recommendationFallback} ${index + 1}`,
      ),
      description,
      owner: ownerFallback,
      timing: index === 0 ? "Immediate" : "",
    }),
  );
}

export function buildInvestigationReportDraft(
  investigation: Investigation,
  fallbacks: {
    finding: string;
    recommendation: string;
    owner: string;
  },
): InvestigationReportDraft {
  const metadataDraft = investigation.metadata?.[REPORT_METADATA_KEY];

  if (isRecord(metadataDraft)) {
    const findings = Array.isArray(metadataDraft.findings)
      ? metadataDraft.findings.flatMap((item, index) => {
          if (!isRecord(item)) return [];
          return [
            {
              id: readString(item.id) || `finding-${index + 1}`,
              title: readString(item.title),
              description: readString(item.description),
              severity: readPriority(item.severity, investigation.priority),
            },
          ];
        })
      : [];
    const recommendations = Array.isArray(metadataDraft.recommendations)
      ? metadataDraft.recommendations.flatMap((item, index) => {
          if (!isRecord(item)) return [];
          return [
            {
              id: readString(item.id) || `recommendation-${index + 1}`,
              title: readString(item.title),
              description: readString(item.description),
              owner: readString(item.owner) || fallbacks.owner,
              timing: readString(item.timing),
            },
          ];
        })
      : [];

    return {
      version:
        typeof metadataDraft.version === "number" &&
        Number.isFinite(metadataDraft.version)
          ? metadataDraft.version
          : 1,
      executiveSummary:
        readString(metadataDraft.executiveSummary) ||
        investigation.findings ||
        investigation.subject,
      findings:
        findings.length > 0
          ? findings
          : findingsFromNarrative(investigation, fallbacks.finding),
      recommendations:
        recommendations.length > 0
          ? recommendations
          : recommendationsFromNarrative(
              investigation,
              fallbacks.recommendation,
              fallbacks.owner,
            ),
      savedAt: readString(metadataDraft.savedAt) || undefined,
    };
  }

  return {
    version: 1,
    executiveSummary: investigation.findings || investigation.subject,
    findings: findingsFromNarrative(investigation, fallbacks.finding),
    recommendations: recommendationsFromNarrative(
      investigation,
      fallbacks.recommendation,
      fallbacks.owner,
    ),
  };
}

export function nextReportVersion(version: number): number {
  return Math.round((Math.max(1, version) + 0.1) * 10) / 10;
}

export function investigationReportMetadata(
  investigation: Investigation,
  draft: InvestigationReportDraft,
): Record<string, unknown> {
  return {
    ...(investigation.metadata ?? {}),
    [REPORT_METADATA_KEY]: draft,
  };
}

export function serializeReportFindings(
  findings: InvestigationReportFinding[],
): string {
  return findings
    .filter((finding) => finding.title.trim() || finding.description.trim())
    .map((finding, index) => {
      const title = finding.title.trim();
      const description = finding.description.trim();
      return `${index + 1}. ${title}${description && description !== title ? `\n${description}` : ""}`;
    })
    .join("\n\n");
}

export function serializeReportRecommendations(
  recommendations: InvestigationReportRecommendation[],
): string {
  return recommendations
    .filter(
      (recommendation) =>
        recommendation.title.trim() || recommendation.description.trim(),
    )
    .map((recommendation, index) => {
      const title = recommendation.title.trim();
      const description = recommendation.description.trim();
      const owner = recommendation.owner.trim();
      const timing = recommendation.timing.trim();
      const details = [
        owner ? `Owner: ${owner}` : "",
        timing ? `Timing: ${timing}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `${index + 1}. ${title}${description && description !== title ? `\n${description}` : ""}${
        details ? `\n${details}` : ""
      }`;
    })
    .join("\n\n");
}
