"""Models for the Watheeq/Lex AI drafting (AID-*) endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import Field

from clario360.models.base import BaseModel


class GeneratedClause(BaseModel):
    title: Optional[str] = None
    clause_type: Optional[str] = None
    text: Optional[str] = None
    rationale: Optional[str] = None
    risk_level: Optional[str] = None
    assumptions: List[str] = Field(default_factory=list)
    language: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class DraftSection(BaseModel):
    heading: Optional[str] = None
    body: Optional[str] = None


class ContractDraft(BaseModel):
    title: Optional[str] = None
    sections: List[DraftSection] = Field(default_factory=list)
    summary: Optional[str] = None
    open_items: List[str] = Field(default_factory=list)
    language: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class RewriteChange(BaseModel):
    summary: Optional[str] = None
    reason: Optional[str] = None


class ClauseRewrite(BaseModel):
    rewritten_text: Optional[str] = None
    changes: List[RewriteChange] = Field(default_factory=list)
    risk_shift: Optional[str] = None
    residual_risks: List[str] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class FallbackOption(BaseModel):
    label: Optional[str] = None
    text: Optional[str] = None
    concession_level: Optional[str] = None
    when_to_use: Optional[str] = None


class FallbackSet(BaseModel):
    fallbacks: List[FallbackOption] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class TranslationResult(BaseModel):
    translation: Optional[str] = None
    equivalence: Optional[str] = None
    notes: List[str] = Field(default_factory=list)
    caveats: List[str] = Field(default_factory=list)
    source_lang: Optional[str] = None
    target_lang: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class KeyTerm(BaseModel):
    label: Optional[str] = None
    value: Optional[str] = None


class ContractSummary(BaseModel):
    executive_summary: Optional[str] = None
    key_terms: List[KeyTerm] = Field(default_factory=list)
    obligations: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    renewal_notes: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class GlossaryEntry(BaseModel):
    term: Optional[str] = None
    definition: Optional[str] = None


class TermInconsistency(BaseModel):
    term: Optional[str] = None
    issue: Optional[str] = None


class GlossaryResult(BaseModel):
    glossary: List[GlossaryEntry] = Field(default_factory=list)
    inconsistencies: List[TermInconsistency] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class AssemblyResult(BaseModel):
    document: Optional[str] = None
    included_sections: List[str] = Field(default_factory=list)
    skipped_sections: List[str] = Field(default_factory=list)
    unresolved_vars: List[str] = Field(default_factory=list)


class RFPSection(BaseModel):
    requirement: Optional[str] = None
    response: Optional[str] = None


class RFPResponse(BaseModel):
    sections: List[RFPSection] = Field(default_factory=list)
    summary: Optional[str] = None
    gaps: List[str] = Field(default_factory=list)
    language: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class ObligationIssue(BaseModel):
    obligation_index: Optional[int] = None
    severity: Optional[str] = None
    issue: Optional[str] = None
    suggestion: Optional[str] = None


class ObligationQAReview(BaseModel):
    issues: List[ObligationIssue] = Field(default_factory=list)
    overall_confidence: Optional[float] = None
    missing_obligations: List[str] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


# AID-09 prompt library


class PromptTemplate(BaseModel):
    id: Optional[str] = None
    tenant_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt: Optional[str] = None
    variables: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PromptRunResult(BaseModel):
    output: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)
