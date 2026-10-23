"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { REPORT_REASONS } from "@/lib/social";
import type { ReportReason, ReportTarget } from "@/lib/types";

interface Target {
  type: ReportTarget;
  /** Post id, comment id or username. */
  id: string;
  /** "this post", "this comment", "@meera" */
  name: string;
}

const NOUN: Record<ReportTarget, string> = { post: "post", comment: "comment", user: "account", message: "message" };

/**
 * Report a post, comment or person with a reason.
 *
 *   const { report, dialog } = useReport();
 *   report({ type: "post", id: post.id, name: "this post" });
 *   return <>{dialog}...</>
 */
export function useReport() {
  const [target, setTarget] = useState<Target | null>(null);
  const report = useCallback((t: Target) => setTarget(t), []);
  const dialog = target ? <ReportDialog key={`${target.type}-${target.id}`} target={target} onClose={() => setTarget(null)} /> : null;
  return { report, dialog };
}

function ReportDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  function close() {
    ref.current?.close();
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return setError("Choose a reason first.");
    setBusy(true);
    setError(null);
    try {
      await api.report({ target_type: target.type, target: target.id, reason, details: details.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-[min(92vw,460px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl"
    >
      {done ? (
        <div className="p-5">
          <h2 className="font-display text-lg">Thank you for telling us</h2>
          <p className="mt-2 text-sm text-muted">
            Your report about {target.name} is saved for review. The person is not told who reported them. You can also block, restrict or mute them from their profile.
          </p>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={close} autoFocus>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="p-5">
          <h2 className="font-display text-lg">Report {target.name}</h2>
          <p className="mt-1 text-sm text-muted">Why are you reporting this {NOUN[target.type]}?</p>
          <fieldset className="mt-3 space-y-1">
            <legend className="sr-only">Reason</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken">
                <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-wine" />
                {r.label}
              </label>
            ))}
          </fieldset>
          <div className="mt-3">
            <label htmlFor="report-details" className={labelClass}>
              Anything else? (optional, {details.length}/500)
            </label>
            <textarea id="report-details" className={`${inputClass} min-h-16`} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          {error && (
            <div className="mt-3">
              <Notice tone="err">{error}</Notice>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!reason}>
              Send report
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
