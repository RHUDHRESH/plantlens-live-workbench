"use client";

import { useState, type ReactNode } from "react";
import { Button, Dialog, Field, Textarea } from "@/components/ui";

/**
 * Confirmation dialog for every mutation that must carry a reason. The reason lands on
 * the audit trail; an empty reason cannot be submitted.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  children?: ReactNode;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const r = reason.trim();
    if (!r) return;
    setBusy(true);
    try {
      await onConfirm(r);
      setReason("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
        <Field label="Reason (required; recorded on the audit trail)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this decision is being recorded" required autoFocus aria-label="Reason" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!reason.trim() || busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
