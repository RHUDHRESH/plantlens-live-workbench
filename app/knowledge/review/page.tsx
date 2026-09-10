"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { KnowledgeProposal, PipelineKind, ProposalKind, ProposalState } from "@/lib/domain/types";
import { cn } from "@/lib/util";
import { useApp } from "@/store/app";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Label, LoadingState, PageHeader, Select, StatusBadge } from "@/components/ui";
import { ProposalDetail } from "@/components/knowledge/ProposalDetail";
import { HumanDraftDialog } from "@/components/knowledge/HumanDraftDialog";
import { PublishPanel } from "@/components/knowledge/PublishPanel";
import { VersionsPanel } from "@/components/knowledge/VersionsPanel";
import { PROPOSAL_KINDS, PROPOSAL_STATE_ORDER, isPublishedProposal, kindLabel } from "@/components/knowledge/helpers";

const PIPELINES: PipelineKind[] = ["LOCAL_DEMO", "CONNECTED_AI", "HUMAN"];

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReviewPage />
    </Suspense>
  );
}

function ReviewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const snapshot = useApp((s) => s.snapshot);
  const proposals = useApp((s) => s.proposals);
  const sources = useApp((s) => s.sources);
  const identity = useApp((s) => s.identity);
  const activeKnowledge = useApp((s) => s.activeKnowledge);
  const activeKnowledgeVersionId = useApp((s) => s.activeKnowledgeVersionId);
  const reviewProposalAction = useApp((s) => s.reviewProposalAction);

  const selectedId = params.get("proposal");
  const [kind, setKind] = useState<ProposalKind | "ALL">("ALL");
  const [state, setState] = useState<ProposalState | "ALL">("ALL");
  const [pipeline, setPipeline] = useState<PipelineKind | "ALL">("ALL");
  const [draftOpen, setDraftOpen] = useState(false);

  const select = useCallback(
    (id: string | null) => {
      router.push(id ? `/knowledge/review?proposal=${encodeURIComponent(id)}` : "/knowledge/review");
    },
    [router],
  );

  const filtered = useMemo(() => proposals.filter((p) => (kind === "ALL" || p.kind === kind) && (state === "ALL" || p.state === state) && (pipeline === "ALL" || p.pipeline === pipeline)), [proposals, kind, state, pipeline]);
  const groups = useMemo(() => {
    const byState = new Map<ProposalState, KnowledgeProposal[]>();
    for (const p of filtered) byState.set(p.state, [...(byState.get(p.state) ?? []), p]);
    const order = [...PROPOSAL_STATE_ORDER, ...Array.from(byState.keys()).filter((s) => !PROPOSAL_STATE_ORDER.includes(s))];
    return order.filter((s) => byState.has(s)).map((s) => ({ state: s, items: (byState.get(s) ?? []).sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [filtered]);

  const selected = selectedId ? proposals.find((p) => p.id === selectedId) : undefined;
  const knowledge = activeKnowledge();
  const openCount = proposals.filter((p) => p.state === "NEEDS_REVIEW" || p.state === "NEEDS_MAPPING" || p.state === "PROPOSAL_READY").length;

  if (!snapshot) return <LoadingState label="Starting the simulation engine…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Knowledge review"
        description="Document-to-knowledge editor. Proposals cite source lines; a reviewer approves, rejects, defers, or requests evidence with a recorded reason. Only published versions reach diagnosis and recovery."
        badges={
          <>
            <Badge tone="accent">active {activeKnowledgeVersionId}</Badge>
            <Badge tone={openCount ? "amber" : "grey"}>
              <span className="tnum">{openCount}</span> awaiting review
            </Badge>
          </>
        }
        actions={
          <Button onClick={() => setDraftOpen(true)}>
            <Plus size={14} /> Add human draft edge
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader title="Proposals" description={`${filtered.length} of ${proposals.length} shown`} />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="f-kind">Kind</Label>
                <Select id="f-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as ProposalKind | "ALL")}>
                  <option value="ALL">all</option>
                  {PROPOSAL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {kindLabel(k)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="f-state">State</Label>
                <Select id="f-state" className="w-full" value={state} onChange={(e) => setState(e.target.value as ProposalState | "ALL")}>
                  <option value="ALL">all</option>
                  {PROPOSAL_STATE_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ").toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="f-pipeline">Pipeline</Label>
                <Select id="f-pipeline" className="w-full" value={pipeline} onChange={(e) => setPipeline(e.target.value as PipelineKind | "ALL")}>
                  <option value="ALL">all</option>
                  {PIPELINES.map((p) => (
                    <option key={p} value={p}>
                      {p.replace(/_/g, " ").toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {proposals.length === 0 ? (
              <EmptyState title="No proposals" description="Load the sample factory pack or import sources; the local pipeline produces proposals from cited lines." action={<Button onClick={() => router.push("/knowledge/sources")}>Go to sources</Button>} />
            ) : groups.length === 0 ? (
              <EmptyState title="No proposals match the filters" />
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <section key={g.state} aria-label={`${g.state} proposals`}>
                    <div className="mb-1 flex items-center gap-2">
                      <StatusBadge value={g.state} />
                      <span className="tnum text-[12px] text-muted">{g.items.length}</span>
                    </div>
                    <ul className="space-y-1">
                      {g.items.map((p) => {
                        const active = p.id === selectedId;
                        return (
                          <li key={p.id}>
                            <button type="button" aria-current={active ? "true" : undefined} onClick={() => select(p.id)} className={cn("w-full rounded-md border px-2.5 py-1.5 text-left hover:bg-surface-2", active ? "border-accent bg-accent-soft" : "border-border")}>
                              <span className="block text-[13px]">{p.title}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                                <span>{kindLabel(p.kind)}</span>
                                <span>· {p.pipeline.replace(/_/g, " ").toLowerCase()}</span>
                                {!p.validation.ok ? <Badge tone="red">invalid</Badge> : p.validation.warnings.length ? <Badge tone="amber">warnings</Badge> : null}
                                {isPublishedProposal(p) ? <Badge tone="green">published</Badge> : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Proposal detail" description={selected ? undefined : "Select a proposal to review it."} />
            <CardBody>
              {selectedId && !selected ? (
                <ErrorState title="Record not available in this browser" description={`Proposal ${selectedId} is not in this workspace. Load the sample factory pack, re-run the pipeline, or import an evidence bundle that contains it.`} action={<Button onClick={() => router.push("/knowledge/sources")}>Go to sources</Button>} />
              ) : selected ? (
                <ProposalDetail proposal={selected} sources={sources} knowledge={knowledge} identity={identity} onReview={(decision, reason, edits) => reviewProposalAction(selected.id, decision, reason, edits)} />
              ) : (
                <EmptyState title="No proposal selected" description="Deep links use ?proposal=<id>." />
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PublishPanel onSelectProposal={(id) => select(id)} />
        <VersionsPanel />
      </div>

      <HumanDraftDialog open={draftOpen} onOpenChange={setDraftOpen} sources={sources} />
    </div>
  );
}
