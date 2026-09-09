import type { DependencyEdge, KnowledgeProposal, KnowledgeVersion, ProposalValidation, RecoveryRequirement, RelationType, SourceDocument, SourceSpan, TagMapping, TimeStamp } from "@/lib/domain/types";
import { ASSET_BY_ID, ASSETS, TAGS } from "@/lib/domain/plant";
import type { ParsedFile } from "@/lib/sources/parsers";
import { stableId } from "@/lib/util";

/**
 * Local demo knowledge-compilation pipeline: deterministic parsers, explicit rules,
 * constrained template matching. It is NOT a language-model response and is labelled
 * LOCAL_DEMO on every proposal. Each stage has typed inputs/outputs; imported text is
 * evidence to analyse, never an instruction.
 */

export type StageState = "QUEUED" | "PARSING" | "NEEDS_MAPPING" | "PROPOSAL_READY" | "NEEDS_REVIEW" | "APPROVED" | "REJECTED" | "FAILED";

export interface StageReport {
  stage: KnowledgeProposal["producedBy"];
  state: StageState;
  inputs: string[];
  outputs: string[];
  messages: string[];
  durationMs: number;
}

export interface PipelineResult {
  proposals: KnowledgeProposal[];
  stages: StageReport[];
}

const UNTRUSTED_PATTERNS = [/ignore (?:all )?approvals?/i, /mark (?:every|all) tests? (?:as )?passed/i, /send .* to (?:the )?vendor portal/i, /reveal (?:the )?(?:api )?key/i, /execute (?:this )?(?:code|script)/i, /bypass (?:the )?(?:interlock|review)/i];

function span(doc: SourceDocument, startLine: number, endLine: number): SourceSpan {
  return { sourceId: doc.id, startLine, endLine };
}

function validateSpans(spans: SourceSpan[], docs: SourceDocument[]): string[] {
  const errors: string[] = [];
  for (const s of spans) {
    const d = docs.find((x) => x.id === s.sourceId);
    if (!d) errors.push(`Citation refers to unknown source ${s.sourceId}.`);
    else if (s.startLine < 1 || s.endLine > d.lines.length || s.startLine > s.endLine) errors.push(`Citation ${s.sourceId}:${s.startLine}-${s.endLine} is outside the document (1-${d.lines.length}).`);
    else if (d.lines.slice(s.startLine - 1, s.endLine).join("").trim() === "") errors.push(`Citation ${s.sourceId}:${s.startLine}-${s.endLine} points at empty lines.`);
  }
  return errors;
}

function assetByToken(token: string): string | undefined {
  const t = token.trim().replace(/[.,;:]$/, "");
  if (ASSET_BY_ID[t]) return t;
  const upper = t.toUpperCase();
  if (ASSET_BY_ID[upper]) return upper;
  return undefined;
}

/** Same-time diagnostic DAG check: physical feedback edges are excluded from the cycle test. */
export function findDiagnosticCycle(edges: DependencyEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.physicalFeedback || e.relation === "REVIEWED_NO_DEPENDENCY" || e.relation === "COMPONENT_OF") continue;
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (s === 0) {
        const r = visit(m);
        if (r) return r;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of adj.keys()) if ((state.get(n) ?? 0) === 0) {
    const r = visit(n);
    if (r) return r;
  }
  return null;
}

export function validateEdge(edge: DependencyEdge, docs: SourceDocument[], published: KnowledgeVersion): ProposalValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!ASSET_BY_ID[edge.from]) errors.push(`Unsupported endpoint ${edge.from}: not in the asset registry.`);
  if (!ASSET_BY_ID[edge.to]) errors.push(`Unsupported endpoint ${edge.to}: not in the asset registry.`);
  if (edge.from === edge.to) errors.push("An asset cannot depend on itself.");
  if (!edge.evidenceRefs.length) errors.push("No cited source span. Held as an uncited human draft; cannot be published.");
  errors.push(...validateSpans(edge.evidenceRefs, docs));
  if (edge.predicate) {
    const tagDef = TAGS.find((t) => t.id === edge.predicate!.tag || (t.assetId === edge.from && t.name === edge.predicate!.tag));
    if (!tagDef) errors.push(`Predicate references tag ${edge.predicate.tag}, which is not in the tag registry.`);
    else if (edge.predicate.unit && tagDef.unit && edge.predicate.unit !== tagDef.unit) errors.push(`Predicate unit ${edge.predicate.unit} is incompatible with ${tagDef.id} (${tagDef.unit}).`);
  }
  if (published.reviewedNoDependency.includes(`${edge.from}->${edge.to}`)) warnings.push(`${edge.from}->${edge.to} was explicitly reviewed as no dependency; approving this reverses that decision.`);
  const dup = published.edges.find((e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation);
  if (dup) warnings.push(`An equivalent edge ${dup.id} is already published; approving creates no change.`);
  if (!edge.physicalFeedback) {
    const cycle = findDiagnosticCycle([...published.edges, edge]);
    if (cycle) {
      const reverse = published.edges.find((e) => e.from === edge.to && e.to === edge.from);
      if (reverse) warnings.push(`Creates a same-time loop with ${reverse.id} (${cycle.join(" → ")}). Mark one edge as a physical feedback relationship to keep the diagnostic DAG acyclic.`);
      else errors.push(`Creates a circular same-time diagnostic explanation: ${cycle.join(" → ")}.`);
    }
  }
  if (edge.basis === "TEMPORAL_ASSOCIATION") warnings.push("Temporal association only: labelled association, not proven causation.");
  return { ok: errors.length === 0, errors, warnings };
}

function proposal(p: Omit<KnowledgeProposal, "pipeline" | "createdAt" | "changeSummary"> & { changeSummary?: string[] }, now: TimeStamp): KnowledgeProposal {
  return { pipeline: "LOCAL_DEMO", createdAt: now, changeSummary: p.changeSummary ?? [], ...p };
}

function edgeDraft(id: string, from: string, to: string, relation: RelationType, summary: string, evidence: SourceSpan[], extra: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    id,
    from,
    to,
    relation,
    applicableModes: ["AUTO"],
    applicablePhases: [],
    evidenceRefs: evidence,
    basis: "EXPLICIT_SOURCE_RULE",
    reviewStatus: "PROPOSED",
    knowledgeVersion: "draft",
    limitations: ["Proposed by the local demo pipeline from an explicit sentence; requires engineer review"],
    summary,
    ...extra,
  };
}

/**
 * Run the pipeline over parsed files against the currently published knowledge.
 * Proposals equivalent to published records are reported as no-change and skipped.
 */
export function runLocalPipeline(files: ParsedFile[], published: KnowledgeVersion, now: TimeStamp): PipelineResult {
  const docs = files.map((f) => f.document);
  const stages: StageReport[] = [];
  const proposals: KnowledgeProposal[] = [];
  const t0 = Date.now();

  // --- Stage 1: source parser ---
  const parserMsgs: string[] = [];
  for (const f of files) {
    parserMsgs.push(`${f.document.fileName}: ${f.document.parseStatus}${f.document.rowCount !== undefined ? `, ${f.document.rowCount} rows` : ""}${f.document.parseMessages.length ? ` — ${f.document.parseMessages.join("; ")}` : ""}`);
  }
  stages.push({ stage: "SOURCE_PARSER", state: files.some((f) => f.document.parseStatus === "FAILED") ? "FAILED" : "PROPOSAL_READY", inputs: docs.map((d) => d.fileName), outputs: [`${docs.filter((d) => d.parseStatus === "PARSED").length} parsed documents`], messages: parserMsgs, durationMs: Date.now() - t0 });

  // --- Stage 2: asset & tag resolver ---
  const t1 = Date.now();
  const resolverMsgs: string[] = [];
  const tagList = files.find((f) => f.document.sourceType === "TAG_LIST" && f.csv);
  const notes = files.filter((f) => f.notes);
  const existingAliases = new Set(published.mappings.map((m) => m.alias));
  if (tagList?.csv) {
    const h = tagList.csv.headers.map((x) => x.toLowerCase());
    const iAlias = h.indexOf("asset_alias");
    const iTag = h.indexOf("tag");
    const iDesc = h.indexOf("description");
    const iInstalled = h.indexOf("installed");
    const seenAliases = new Set<string>();
    tagList.csv.rows.forEach((row, r) => {
      const alias = row[iAlias]?.trim();
      const tagName = row[iTag]?.trim();
      const line = r + 2;
      if (!alias || seenAliases.has(alias)) return;
      seenAliases.add(alias);
      if (ASSET_BY_ID[alias] || existingAliases.has(alias)) return;
      // Candidates: registry aliases and similarity.
      const candidates: Array<{ assetId: string; reason: string; score: number }> = [];
      for (const a of ASSETS) {
        const regAliases = TAGS.filter((t) => t.assetId === a.id).flatMap((t) => t.aliases);
        if (regAliases.some((x) => x.toLowerCase() === alias.toLowerCase())) candidates.push({ assetId: a.id, reason: "Exact alias in the tag registry", score: 1 });
        const sim = similarity(alias, a.id) * 0.6 + similarity(alias, a.name) * 0.4;
        if (sim > 0.45) candidates.push({ assetId: a.id, reason: `String similarity ${(sim * 100).toFixed(0)}%`, score: sim });
      }
      // Notes may name the alias with a different meaning.
      const noteHits = notes.flatMap((f) => f.notes!.entries.filter((e) => e.body.includes(alias) && !e.body.includes(`${alias}_`)).map((e) => ({ doc: f.document, entry: e })));
      const contradiction = noteHits.find((n) => /referred to cell B/i.test(n.entry.body) && alias === "CoolantPump");
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      const evidence: SourceSpan[] = [span(tagList.document, line, line), ...noteHits.map((n) => span(n.doc, n.entry.startLine, n.entry.endLine))];
      if (!best) {
        proposals.push(
          proposal(
            {
              id: stableId("PROP-UNMATCHED", alias),
              kind: "UNMATCHED_TAG",
              title: `Unmatched tag ${tagName} (asset alias "${alias}")`,
              state: "NEEDS_MAPPING",
              producedBy: "ASSET_TAG_RESOLVER",
              evidence,
              rationale: `No registry alias or similar asset name matches "${alias}". Human mapping required; the resolver does not guess.`,
              validation: { ok: false, errors: ["No candidate asset"], warnings: [] },
              payload: { kind: "UNMATCHED_TAG", rawTag: tagName, occurrences: 1 },
            },
            now,
          ),
        );
        resolverMsgs.push(`"${alias}": no candidate → needs mapping`);
        return;
      }
      const ambiguous = !!contradiction || (candidates.length > 1 && candidates[1].score > best.score - 0.15 && best.score < 1);
      const mapping: TagMapping = {
        id: stableId("MAP", alias),
        alias,
        assetId: best.assetId,
        status: "PROPOSED",
        alternatives: candidates.slice(0, 3).map((c) => ({ assetId: c.assetId, reason: c.reason })).concat(contradiction ? [{ assetId: "PUMP-02", reason: `Engineer note (${contradiction.entry.date}) says the older ${alias} column referred to cell B's pump.` }] : []),
        evidence,
        rationale: contradiction ? `Resolver proposes ${best.assetId} by ${best.reason.toLowerCase()}, but the cited note contradicts it. Reviewer decision required; strings resembling each other is not a merge reason.` : `${best.reason}.`,
        ambiguous,
      };
      proposals.push(
        proposal(
          {
            id: stableId("PROP-ALIAS", alias),
            kind: "ALIAS_MERGE",
            title: `Map alias "${alias}" → ${best.assetId}${ambiguous ? " (ambiguous)" : ""}`,
            state: ambiguous ? "NEEDS_REVIEW" : "PROPOSAL_READY",
            producedBy: "ASSET_TAG_RESOLVER",
            evidence,
            rationale: mapping.rationale,
            validation: { ok: true, errors: [], warnings: ambiguous ? ["Two plausible assets; reversible until published."] : [] },
            payload: { kind: "ALIAS_MERGE", mapping },
            changeSummary: [`Adds mapping ${alias} → ${best.assetId}`],
          },
          now,
        ),
      );
      resolverMsgs.push(`"${alias}" → ${best.assetId}${ambiguous ? " (ambiguous)" : ""}`);
      if (iInstalled >= 0 && /^(no|false|not installed)$/i.test(row[iInstalled]?.trim() ?? "")) {
        resolverMsgs.push(`${tagName}: not installed → missing channel`);
      }
      void iDesc;
    });
    // Missing channels declared in the tag list.
    if (iInstalled >= 0) {
      tagList.csv.rows.forEach((row, r) => {
        if (/^(no|false|not installed)$/i.test(row[iInstalled]?.trim() ?? "")) {
          const alias = row[iAlias]?.trim();
          const tagName = row[iTag]?.trim();
          const assetId = assetByToken(alias ?? "") ?? published.mappings.find((m) => m.alias === alias)?.assetId ?? alias;
          proposals.push(
            proposal(
              {
                id: stableId("PROP-MISSING", assetId, tagName),
                kind: "MISSING_CHANNEL",
                title: `Missing channel: ${assetId}.${tagName} not installed`,
                state: "NEEDS_REVIEW",
                producedBy: "ASSET_TAG_RESOLVER",
                evidence: [span(tagList.document, r + 2, r + 2)],
                rationale: "Tag list marks this channel as not installed. Any rule that needs it must show unavailable evidence, not a healthy value.",
                validation: { ok: true, errors: [], warnings: [] },
                payload: { kind: "MISSING_CHANNEL", assetId, tagName, requiredBy: ["DEP-PUMP-SPN-02"] },
              },
              now,
            ),
          );
        }
      });
    }
  } else resolverMsgs.push("No tag list (plc_tags.csv) provided; alias resolution skipped.");
  stages.push({ stage: "ASSET_TAG_RESOLVER", state: proposals.some((p) => p.kind === "UNMATCHED_TAG") ? "NEEDS_MAPPING" : "PROPOSAL_READY", inputs: tagList ? [tagList.document.fileName] : [], outputs: [`${proposals.filter((p) => p.kind === "ALIAS_MERGE").length} alias proposals`, `${proposals.filter((p) => p.kind === "UNMATCHED_TAG").length} unmatched`], messages: resolverMsgs, durationMs: Date.now() - t1 });

  // --- Stage 3: dependency proposer ---
  const t2 = Date.now();
  const depMsgs: string[] = [];
  const drafts: Array<{ edge: DependencyEdge; rationale: string }> = [];
  const requirementDrafts: Array<{ req: RecoveryRequirement; rationale: string; evidence: SourceSpan[]; sourceRevision?: string }> = [];
  for (const f of notes) {
    const doc = f.document;
    for (const e of f.notes!.entries) {
      const body = e.body;
      const sp = span(doc, e.startLine, e.endLine);
      // Untrusted instructions are flagged and never become actions.
      const inj = UNTRUSTED_PATTERNS.filter((re) => re.test(body));
      if (inj.length) {
        proposals.push(
          proposal(
            {
              id: stableId("PROP-UNTRUSTED", doc.id, e.startLine),
              kind: "UNTRUSTED_INSTRUCTION",
              title: `Untrusted instruction text in ${doc.fileName} (line ${e.bodyStartLine})`,
              state: "REJECTED",
              producedBy: "CONSISTENCY_REVIEWER",
              evidence: [sp],
              rationale: "Document content asked the system to bypass review or act. Imported text is evidence to analyse, not operational authority. Rejected as an instruction; retained as evidence of the note's content.",
              validation: { ok: false, errors: ["Matched untrusted-instruction pattern"], warnings: [] },
              payload: { kind: "UNTRUSTED_INSTRUCTION", text: body.slice(0, 200) },
              review: { reviewer: "Consistency reviewer (local rule)", simulatedIdentity: true, decision: "REJECTED", reason: "Untrusted document content", at: now },
            },
            now,
          ),
        );
        depMsgs.push(`Rejected instruction-like text at ${doc.fileName}:${e.bodyStartLine}`);
        continue;
      }
      // Handshake: "X may proceed only after Y ... and Z ..."
      const hs = body.match(/([A-Z]+-\d+) may proceed only after ([A-Z]+-\d+) [\w-]+ and ([A-Z]+-\d+) [\w-]+ are received/);
      if (hs) {
        const [, to, a, b] = hs;
        drafts.push({ edge: edgeDraft(stableId("DEP", a, to, "HS"), a, to, "HANDSHAKE", `${a} handshake gates ${to} (from note)`, [sp], { applicablePhases: ["LOADING", "UNLOADING"], expectedLagMs: { min: 0, max: 8000 } }), rationale: `Sentence "${hs[0]}" states an explicit sequencing prerequisite.` });
        drafts.push({ edge: edgeDraft(stableId("DEP", b, to, "HS"), b, to, "HANDSHAKE", `${b} clamp proof gates ${to} (from note)`, [sp], { applicablePhases: ["CLAMPING"] }), rationale: `Sentence "${hs[0]}" states an explicit clamp-proof prerequisite.` });
      }
      // Pneumatic requirement: "X requires header pressure of at least N bar"
      const pr = body.match(/([A-Z]+-\d+) requires header pressure of at least ([\d.]+) bar/);
      if (pr) {
        const [, to, val] = pr;
        drafts.push({ edge: edgeDraft(stableId("DEP", "AIR-HDR-01", to, "PN"), "AIR-HDR-01", to, "PNEUMATIC_PREREQUISITE", `${to} clamp requires header pressure ≥ ${val} bar (from note)`, [sp], { applicablePhases: ["CLAMPING"], predicate: { tag: "header_pressure", operator: ">=", value: Number(val), unit: "bar" }, expectedObservation: "clamp_proof" }), rationale: `Sentence states a pressure prerequisite of ${val} bar.` });
        requirementDrafts.push({
          req: { id: stableId("REQ", "AIR", val), title: `Header pressure ≥ ${val} bar during clamping (${e.date})`, predicate: { tag: "AIR-HDR-01.header_pressure", operator: ">=", value: Number(val), unit: "bar" }, band: { min: Number(val), max: 6.5, unit: "bar", phase: "CLAMPING" }, applicableRecipes: ["PART-A", "PART-B"], applicableModes: ["AUTO"], applicablePhases: ["CLAMPING"], evidenceRefs: [sp], basis: "DEMO_ENGINEER_AUTHORED_RULE", reviewStatus: "PROPOSED", knowledgeVersion: "draft", limitations: ["Illustrative threshold"], coversEdgeIds: ["DEP-AIR-FIX-01"] },
          rationale: `Engineer note dated ${e.date} states ${val} bar.`,
          evidence: [sp],
          sourceRevision: e.date,
        });
      }
      // Integrated clamp fed from the same header
      const ic = body.match(/([A-Z]+-\d+) has an integrated clamp fed from the same header \(([A-Z]+-[A-Z]+-\d+)\)/);
      if (ic) {
        const [, to, from] = ic;
        drafts.push({ edge: edgeDraft("DEP-AIR-CNC-02", from, to, "PNEUMATIC_PREREQUISITE", `${to} integrated clamp is fed from the shared header (proposed)`, [sp], { applicablePhases: ["CLAMPING"], predicate: { tag: "header_pressure", operator: ">=", value: 5.5, unit: "bar" }, expectedObservation: "clamp_proof", basis: "DEMO_ENGINEER_AUTHORED_RULE", limitations: ["Threshold applicability to the CNC-02 fixture model not yet reviewed (note says so explicitly)"] }), rationale: "Note states the clamp is fed from the same header but explicitly leaves the threshold unreviewed." });
      }
      // Coolant delivery
      const cd = body.match(/([A-Z]+-\d+) delivers coolant to the ([A-Z]+-\d+) spindle during cutting/);
      if (cd) drafts.push({ edge: edgeDraft(stableId("DEP", cd[1], cd[2], "CL"), cd[1], cd[2], "COOLING", `${cd[1]} cools ${cd[2]} during cutting (from note)`, [sp], { applicablePhases: ["CUTTING"], expectedLagMs: { min: 30_000, max: 180_000 } }), rationale: "Sentence states a cooling relationship active during cutting." });
      // Electrical: "X feeds A, B, C, and D."
      const el = body.match(/([A-Z]+-\d+) feeds ((?:[A-Z]+-\d+,?\s*(?:and\s*)?)+)\./);
      if (el) {
        const targets = el[2].match(/[A-Z]+-\d+/g) ?? [];
        for (const t of targets) drafts.push({ edge: edgeDraft(stableId("DEP", el[1], t, "EL"), el[1], t, "ELECTRICAL_SUPPLY", `${el[1]} supplies ${t} (from note)`, [sp], { applicableModes: ["AUTO", "MANUAL"] }), rationale: "Sentence lists electrical supply targets." });
      }
      // Downstream ack
      const da = body.match(/After ([A-Z]+-\d+) cycle_complete, ([A-Z]+-\d+) must acknowledge with downstream_accept within (\d+) seconds/);
      if (da) drafts.push({ edge: edgeDraft(stableId("DEP", da[1], da[2], "HS"), da[1], da[2], "HANDSHAKE", `${da[2]} acknowledges ${da[1]} cycles within ${da[3]} s (from note)`, [sp], { applicablePhases: ["UNLOADING"], expectedLagMs: { min: 0, max: Number(da[3]) * 1000 } }), rationale: "Sentence states an acknowledgement envelope." });
      // No dependency
      const nd = body.match(/([A-Z]+-\d+) is auxiliary.*no dependency on ([A-Z]+-\d+)/);
      if (nd) drafts.push({ edge: edgeDraft(stableId("DEP", nd[1], nd[2], "ND"), nd[1], nd[2], "REVIEWED_NO_DEPENDENCY", `${nd[1]} reviewed as no dependency on ${nd[2]}`, [sp]), rationale: "Note records an explicit reviewed non-dependency." });
      // Missing instrumentation
      const mi = body.match(/([A-Z]+-\d+) has no bearing temperature sensor installed/);
      if (mi) depMsgs.push(`${mi[1]}: temperature not instrumented (recorded as missing channel)`);
    }
  }
  // Sequence excerpt prerequisites (older revision).
  const seq = files.find((f) => f.sequence);
  if (seq?.sequence) {
    for (const p of seq.sequence.prerequisites) {
      if (p.tag && p.value !== undefined) {
        const sp = span(seq.document, p.startLine, p.endLine);
        requirementDrafts.push({
          req: { id: stableId("REQ", "AIR", String(p.value)), title: `${p.tag} ${p.operator} ${p.value} ${p.unit} (${p.revision ?? seq.sequence.revision ?? "unknown revision"})`, predicate: { tag: `AIR-HDR-01.${p.tag}`, operator: (p.operator as ">=") ?? ">=", value: p.value, unit: p.unit }, band: { min: p.value, max: 6.5, unit: p.unit ?? "", phase: "CLAMPING" }, applicableRecipes: ["PART-A", "PART-B"], applicableModes: ["AUTO"], applicablePhases: ["CLAMPING"], evidenceRefs: [sp], basis: "EXPLICIT_SOURCE_RULE", reviewStatus: "PROPOSED", knowledgeVersion: "draft", limitations: ["From an older revision; fixture supplier note 2024"], coversEdgeIds: ["DEP-AIR-FIX-01"] },
          rationale: `Sequence excerpt ${p.revision ?? ""} states ${p.tag} ${p.operator} ${p.value} ${p.unit}.`,
          evidence: [sp],
          sourceRevision: p.revision ?? seq.sequence.revision,
        });
      }
    }
    for (const o of seq.sequence.obsolete) depMsgs.push(`${o.title} marked OBSOLETE in the source (lines ${o.startLine}-${o.endLine}); not proposed as a current rule.`);
    for (const st of seq.sequence.states) {
      if (st.name === "LOAD_COMPLETE") depMsgs.push(`STATE LOAD_COMPLETE requires ${st.required.join(", ")} → supports REQ-DEMO-SEQUENCE-01 (already published).`);
    }
  }
  // Conflicting requirements on the same subject → SOURCE_CONFLICT.
  const airReqs = requirementDrafts.filter((r) => r.req.predicate?.tag === "AIR-HDR-01.header_pressure");
  const distinctValues = Array.from(new Set(airReqs.map((r) => r.req.predicate!.value)));
  if (distinctValues.length > 1) {
    proposals.push(
      proposal(
        {
          id: stableId("PROP-CONFLICT", "AIR-PRESSURE"),
          kind: "SOURCE_CONFLICT",
          title: `Conflicting header pressure condition: ${distinctValues.map((v) => `${v} bar`).join(" vs ")}`,
          state: "NEEDS_REVIEW",
          producedBy: "CONSISTENCY_REVIEWER",
          evidence: airReqs.flatMap((r) => r.evidence),
          rationale: "Two sources state different pressure conditions for the same clamp prerequisite. Neither is authoritative merely because it is newer. Decide by revision, scope, and equipment applicability, and record the reason.",
          validation: { ok: true, errors: [], warnings: ["Resolution required before any dependent requirement changes"] },
          payload: {
            kind: "SOURCE_CONFLICT",
            subject: "AIR-HDR-01.header_pressure clamp prerequisite",
            options: airReqs.map((r) => ({ label: r.req.title, value: `${r.req.predicate!.value} ${r.req.predicate!.unit}`, evidence: r.evidence, revision: r.sourceRevision, scope: r.req.basis === "EXPLICIT_SOURCE_RULE" ? "Sequence excerpt REV B (2024 supplier note)" : "Engineer note 2026 (current fixture)" })),
            affectedEdgeIds: ["DEP-AIR-FIX-01", "DEP-AIR-CNC-02"],
            affectedRequirementIds: ["REQ-DEMO-AIR-01"],
          },
        },
        now,
      ),
    );
    depMsgs.push(`Conflict: header pressure ${distinctValues.join(" vs ")} bar`);
  }
  // Uncited human draft example (demonstrates validation holding an uncited proposal).
  drafts.push({
    edge: edgeDraft("DEP-CHLR-SPN-01", "CHLR-01", "SPN-01", "THERMAL_SUPPLY", "Chiller supply temperature directly drives spindle temperature (uncited)", [], { basis: "UNRESOLVED_INFERENCE", reviewStatus: "DRAFT" }),
    rationale: "Draft entered without a source span. Validation holds it as an uncited human draft.",
  });

  const seenKeys = new Set<string>();
  for (const d of drafts) {
    const key = `${d.edge.from}|${d.edge.to}|${d.edge.relation}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const dup = published.edges.find((e) => e.from === d.edge.from && e.to === d.edge.to && e.relation === d.edge.relation);
    const noDep = d.edge.relation === "REVIEWED_NO_DEPENDENCY" && published.reviewedNoDependency.includes(`${d.edge.from}->${d.edge.to}`);
    if (dup || noDep) {
      depMsgs.push(`${d.edge.from} → ${d.edge.to} (${d.edge.relation}): already published as ${dup?.id ?? "reviewed no-dependency"}; no change.`);
      continue;
    }
    const validation = validateEdge(d.edge, docs, published);
    const uncited = !d.edge.evidenceRefs.length;
    proposals.push(
      proposal(
        {
          id: stableId("PROP-EDGE", d.edge.id),
          kind: uncited ? "UNCITED_DRAFT" : "DEPENDENCY_EDGE",
          title: `${d.edge.relation.replace(/_/g, " ").toLowerCase()}: ${d.edge.from} → ${d.edge.to}`,
          state: uncited ? "NEEDS_REVIEW" : validation.ok ? (d.edge.id === "DEP-AIR-CNC-02" ? "NEEDS_REVIEW" : "PROPOSAL_READY") : "FAILED",
          producedBy: "DEPENDENCY_PROPOSER",
          evidence: d.edge.evidenceRefs,
          rationale: d.rationale,
          validation,
          payload: uncited ? { kind: "UNCITED_DRAFT", edge: d.edge } : { kind: "DEPENDENCY_EDGE", edge: d.edge },
          changeSummary: [`Adds edge ${d.edge.id} (${d.edge.relation})`],
        },
        now,
      ),
    );
  }
  stages.push({ stage: "DEPENDENCY_PROPOSER", state: "PROPOSAL_READY", inputs: [...notes.map((n) => n.document.fileName), ...(seq ? [seq.document.fileName] : [])], outputs: [`${proposals.filter((p) => p.kind === "DEPENDENCY_EDGE").length} edge proposals`, `${proposals.filter((p) => p.kind === "SOURCE_CONFLICT").length} conflict(s)`, `${proposals.filter((p) => p.kind === "UNCITED_DRAFT").length} uncited draft(s)`], messages: depMsgs, durationMs: Date.now() - t2 });

  // --- Stage 4: consistency reviewer (already applied per proposal; summarise) ---
  const t3 = Date.now();
  const reviewMsgs = proposals.filter((p) => !p.validation.ok || p.validation.warnings.length).map((p) => `${p.title}: ${[...p.validation.errors, ...p.validation.warnings].join("; ")}`);
  stages.push({ stage: "CONSISTENCY_REVIEWER", state: proposals.some((p) => p.state === "NEEDS_REVIEW") ? "NEEDS_REVIEW" : "PROPOSAL_READY", inputs: [`${proposals.length} proposals`], outputs: [`${proposals.filter((p) => p.validation.ok).length} valid`, `${proposals.filter((p) => !p.validation.ok).length} held/rejected`], messages: reviewMsgs, durationMs: Date.now() - t3 });

  // --- Stage 5: recovery-check drafter (informational: which templates the approved requirements enable) ---
  stages.push({ stage: "RECOVERY_CHECK_DRAFTER", state: "PROPOSAL_READY", inputs: ["Published requirements", "Template library"], outputs: ["Templates are selected per incident in the Recovery builder; no check thresholds are invented here."], messages: ["Checks are drawn from recovery_templates.json and justified by requirement references."], durationMs: 0 });

  return { proposals, stages };
}

/** Normalised Jaro-like similarity for alias resolution (deterministic, no ML). */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const y = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [k, v] of bx) inter += Math.min(v, by.get(k) ?? 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}
