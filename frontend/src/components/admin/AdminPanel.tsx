"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/chat/SendDialogs";
import { useT } from "@/components/i18n/LanguageProvider";
import { Avatar } from "@/components/social/Avatar";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { REPORT_REASONS } from "@/lib/social";
import type {
  AdminAction,
  AdminProblemReport,
  AdminReport,
  AdminReportStatus,
  AdminStats,
  AdminSuspension,
  PersonSummary,
  ReportTarget,
  VerificationRequest,
  VerificationStatus,
} from "@/lib/types";

type Tab = "overview" | "reports" | "problems" | "verification" | "suspensions" | "log";

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: "overview", label: "admin.overview" },
  { id: "reports", label: "admin.reports" },
  { id: "problems", label: "admin.problems" },
  { id: "verification", label: "admin.verification" },
  { id: "suspensions", label: "admin.suspensions" },
  { id: "log", label: "admin.log" },
];

const REASON_LABEL: Record<string, string> = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label]));
const TARGET_LABEL: Record<ReportTarget, string> = { post: "Post", comment: "Comment", user: "Account", message: "Chat message" };
const ACTION_LABEL: Record<string, string> = {
  dismiss_report: "Dismissed a report",
  resolve_report: "Resolved a report",
  remove_post: "Removed a post",
  remove_comment: "Removed a comment",
  remove_message: "Removed a chat message",
  warn_user: "Warned",
  suspend_user: "Suspended",
  lift_suspension: "Lifted a suspension of",
  update_problem_report: "Updated a problem report from",
  approve_verification: "Verified",
  reject_verification: "Did not verify",
  remove_verification: "Removed the badge of",
};

/** A list that loads, can fail, and can be reloaded. */
function useList<T>(load: () => Promise<T[]>, refresh = 0) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setItems(await load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this list.");
      setItems((cur) => cur ?? []);
    }
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load when the tab opens
    void reload();
  }, [reload, refresh]);
  return { items, error, reload };
}

function Loading() {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <Spinner /> Loading…
    </p>
  );
}

function ListState<T>({ list, empty, children }: { list: { items: T[] | null; error: string | null; reload: () => void }; empty: string; children: (items: T[]) => ReactNode }) {
  if (list.items === null) return <Loading />;
  return (
    <>
      {list.error && (
        <div className="mb-3">
          <Notice tone="err" action={<Button size="sm" onClick={list.reload}>Try again</Button>}>
            {list.error}
          </Notice>
        </div>
      )}
      {list.items.length === 0 && !list.error ? <EmptyState title={empty} /> : children(list.items)}
    </>
  );
}

function Who({ person, fallback = "No profile" }: { person: PersonSummary | null; fallback?: string }) {
  if (!person) return <span className="text-muted">{fallback}</span>;
  return (
    <Link href={`/u/${person.username}`} className="inline-flex items-center gap-1.5 font-medium hover:text-wine">
      <Avatar person={person} size="sm" />@{person.username}
      <VerifiedBadge person={person} />
    </Link>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-line-strong bg-surface p-0.5 text-sm">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className={`rounded px-3 py-1 ${value === o.id ? "bg-wine text-on-wine" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- the action dialog (note / reason, and the length of a suspension) ----------

interface ActionRequest {
  title: string;
  help: string;
  confirm: string;
  danger?: boolean;
  /** The text is required (warn, suspend) or optional (a note). */
  needsReason?: boolean;
  withDuration?: boolean;
  run: (text: string, days: number | null) => Promise<void>;
}

function ActionDialog({ action, onClose, onDone }: { action: ActionRequest; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [days, setDays] = useState<string>("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (action.needsReason && text.trim().length < 3) return setError("Please write a short reason; the person will see it.");
    setBusy(true);
    setError(null);
    try {
      await action.run(text.trim(), days === "permanent" ? null : Number(days));
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      setBusy(false);
    }
  }

  return (
    <Modal title={action.title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">{action.help}</p>
        {action.withDuration && (
          <div>
            <label htmlFor="admin-days" className={labelClass}>
              How long
            </label>
            <select id="admin-days" className={inputClass} value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="permanent">Permanently</option>
            </select>
          </div>
        )}
        <div>
          <label htmlFor="admin-text" className={labelClass}>
            {action.needsReason ? "Reason (the person sees this)" : "Note for the log (optional)"}
          </label>
          <textarea id="admin-text" className={`${inputClass} min-h-20`} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {error && <Notice tone="err">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={action.danger ? "danger" : "primary"} loading={busy}>
            {action.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- tabs ----------

function Overview({ stats, onOpen }: { stats: AdminStats | null; onOpen: (t: Tab) => void }) {
  if (!stats) return <Loading />;
  const tiles: { label: string; value: number; tab?: Tab; icon: IconName; alert?: boolean }[] = [
    { label: "Accounts", value: stats.total_users, icon: "users" },
    { label: "New this week", value: stats.new_users_this_week, icon: "sparkle" },
    { label: "Profiles", value: stats.profiles, icon: "user" },
    { label: "Published posts", value: stats.published_posts, icon: "image" },
    { label: "Open reports", value: stats.open_reports, tab: "reports", icon: "flag", alert: stats.open_reports > 0 },
    { label: "Open problem reports", value: stats.open_problem_reports, tab: "problems", icon: "comment", alert: stats.open_problem_reports > 0 },
    { label: "Waiting verifications", value: stats.pending_verifications, tab: "verification", icon: "check", alert: stats.pending_verifications > 0 },
    { label: "Active suspensions", value: stats.active_suspensions, tab: "suspensions", icon: "ban" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => {
        const body = (
          <>
            <Icon name={tile.icon} className={`h-5 w-5 ${tile.alert ? "text-wine" : "text-muted"}`} />
            <span className="mt-2 block font-display text-3xl">{tile.value}</span>
            <span className="block text-xs text-muted">{tile.label}</span>
          </>
        );
        return (
          <li key={tile.label}>
            {tile.tab ? (
              <button type="button" onClick={() => onOpen(tile.tab!)} className={`block w-full rounded-lg border bg-surface p-4 text-left hover:border-line-strong ${tile.alert ? "border-wine/30" : "border-line"}`}>
                {body}
              </button>
            ) : (
              <div className="rounded-lg border border-line bg-surface shadow-card p-4">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReportCard({ report, open, onAction }: { report: AdminReport; open: boolean; onAction: (a: ActionRequest) => void }) {
  const target = report.reported;
  const link = report.post_id ? `/p/${report.post_id}` : report.target_type === "user" && target ? `/u/${target.username}` : null;
  return (
    <li className="rounded-lg border border-line bg-surface shadow-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="wine">{TARGET_LABEL[report.target_type]}</Badge>
        <Badge tone="warn">{REASON_LABEL[report.reason] ?? report.reason}</Badge>
        {!report.target_exists && <Badge>Already gone</Badge>}
        {report.reports_about_person > 1 && open && <Badge tone="err">{report.reports_about_person} open reports about this person</Badge>}
        {!open && <Badge tone={report.status === "resolved" ? "ok" : "neutral"}>{report.status}</Badge>}
        <span className="ml-auto text-muted" title={formatDateTime(report.created_at)}>
          {timeAgo(report.created_at)}
        </span>
      </div>
      {report.excerpt && <blockquote className="mt-3 whitespace-pre-line break-words border-l-2 border-wine/30 pl-3 text-sm">{report.excerpt}</blockquote>}
      {report.details && <p className="mt-2 text-sm text-muted">Reporter says: {report.details}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">Reported:</span> <Who person={target} fallback="An account without a profile" />
        <span className="text-muted">by</span> <Who person={report.reporter} />
        {link && (
          <Link href={link} className="text-xs text-wine hover:underline">
            Open ↗
          </Link>
        )}
      </div>
      {!open && report.resolution_note && <p className="mt-2 text-xs text-muted">Decision: {report.resolution_note}</p>}
      {open && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={() => onAction({ title: "Dismiss this report?", help: "Nothing breaks the rules. The report is closed; nobody is told.", confirm: "Dismiss", run: (note) => api.admin.reportAction(report.id, "dismiss", note) })}>
            Dismiss
          </Button>
          {report.target_type !== "user" && (
            <Button
              size="sm"
              variant="danger"
              disabled={!report.target_exists}
              onClick={() =>
                onAction({
                  title: `Remove this ${TARGET_LABEL[report.target_type].toLowerCase()}?`,
                  help: "It is deleted for good (with its pictures). Other open reports about it are closed too.",
                  confirm: "Remove for good",
                  danger: true,
                  run: (note) => api.admin.reportAction(report.id, "remove", note),
                })
              }
            >
              Remove content
            </Button>
          )}
          {report.reported_user_id && (
            <>
              <Button size="sm" onClick={() => onAction({ title: `Warn @${target?.username ?? "this person"}?`, help: "They see your message at the top of the app until they press “I understand”.", confirm: "Send warning", needsReason: true, run: (reason) => api.admin.warn(report.reported_user_id!, reason, report.id) })}>
                Warn
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  onAction({
                    title: `Suspend @${target?.username ?? "this person"}?`,
                    help: "They can still sign in and read, but cannot post, comment, repost or send messages. They see the reason and the end date.",
                    confirm: "Suspend",
                    danger: true,
                    needsReason: true,
                    withDuration: true,
                    run: (reason, days) => api.admin.suspend(report.reported_user_id!, reason, days, report.id),
                  })
                }
              >
                Suspend
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function ReportsTab({ onAction, refresh }: { onAction: (a: ActionRequest) => void; refresh: number }) {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [type, setType] = useState<"" | ReportTarget>("");
  const load = useCallback(() => api.admin.reports(status, type), [status, type]);
  const list = useList(load, refresh);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={status} onChange={setStatus} options={[{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }]} />
        <Segmented
          value={type}
          onChange={setType}
          options={[{ id: "", label: "All" }, { id: "post", label: "Posts" }, { id: "comment", label: "Comments" }, { id: "user", label: "Accounts" }, { id: "message", label: "Chats" }]}
        />
      </div>
      <ListState list={list} empty={status === "open" ? "No open reports. All clear!" : "No closed reports yet."}>
        {(items) => (
          <ul className="space-y-3">
            {items.map((r) => (
              <ReportCard key={r.id} report={r} open={status === "open"} onAction={onAction} />
            ))}
          </ul>
        )}
      </ListState>
    </div>
  );
}

const PROBLEM_STATUS: { id: AdminReportStatus; label: string }[] = [
  { id: "reviewing", label: "Reviewing" },
  { id: "resolved", label: "Resolved" },
  { id: "dismissed", label: "Dismiss" },
];

function ProblemsTab({ refresh }: { refresh: number }) {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const load = useCallback(() => api.admin.problemReports(status), [status]);
  const list = useList(load, refresh);
  const [error, setError] = useState<string | null>(null);

  async function set(item: AdminProblemReport, next: AdminReportStatus) {
    setError(null);
    try {
      await api.admin.setProblemStatus(item.id, next);
      await list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Segmented value={status} onChange={setStatus} options={[{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }]} />
      </div>
      {error && (
        <div className="mb-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <ListState list={list} empty={status === "open" ? "No open problem reports." : "Nothing closed yet."}>
        {(items) => (
          <ul className="space-y-3">
            {items.map((p) => (
              <li key={p.id} className="rounded-lg border border-line bg-surface shadow-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="wine">{p.category.replace("_", " ")}</Badge>
                  <Badge tone={p.status === "open" ? "warn" : p.status === "resolved" ? "ok" : "neutral"}>{p.status}</Badge>
                  <span className="ml-auto text-muted">{timeAgo(p.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-sm">{p.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <Who person={p.person} fallback={p.email ?? "Unknown"} />
                  {p.email && <a href={`mailto:${p.email}`} className="hover:text-wine">{p.email}</a>}
                  {p.page && <span>Page: {p.page}</span>}
                  {p.browser && <span className="truncate" title={p.browser}>Browser: {p.browser.slice(0, 60)}</span>}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  {p.has_screenshot && (
                    <Button size="sm" onClick={() => api.admin.openScreenshot(p.id).catch((e: Error) => setError(e.message))}>
                      <Icon name="image" /> Screenshot
                    </Button>
                  )}
                  {PROBLEM_STATUS.filter((s) => s.id !== p.status).map((s) => (
                    <Button key={s.id} size="sm" variant={s.id === "resolved" ? "primary" : "secondary"} onClick={() => set(p, s.id)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListState>
    </div>
  );
}

function VerificationTab({ onAction, refresh }: { onAction: (a: ActionRequest) => void; refresh: number }) {
  const [status, setStatus] = useState<VerificationStatus>("pending");
  const load = useCallback(() => api.admin.verifications(status), [status]);
  const list = useList(load, refresh);
  return (
    <div>
      <div className="mb-4">
        <Segmented value={status} onChange={setStatus} options={[{ id: "pending", label: "Waiting" }, { id: "approved", label: "Approved" }, { id: "rejected", label: "Rejected" }]} />
      </div>
      <ListState list={list} empty={status === "pending" ? "No requests waiting." : "None yet."}>
        {(items: VerificationRequest[]) => (
          <ul className="space-y-3">
            {items.map((v) => (
              <li key={v.id} className="rounded-lg border border-line bg-surface shadow-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Who person={v.person} />
                  <span className="ml-auto text-xs text-muted">{timeAgo(v.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line break-words text-sm">{v.reason}</p>
                {v.portfolio_url && (
                  <a href={v.portfolio_url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-sm text-wine hover:underline">
                    {v.portfolio_url}
                  </a>
                )}
                {v.review_note && <p className="mt-2 text-xs text-muted">Note: {v.review_note}</p>}
                {status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button size="sm" variant="primary" onClick={() => onAction({ title: "Verify this account?", help: "The badge appears next to their name everywhere.", confirm: "Approve", run: (note) => api.admin.reviewVerification(v.id, true, note) })}>
                      Approve
                    </Button>
                    <Button size="sm" onClick={() => onAction({ title: "Reject this request?", help: "They see your note on their verification page and can ask again.", confirm: "Reject", run: (note) => api.admin.reviewVerification(v.id, false, note) })}>
                      Reject
                    </Button>
                  </div>
                )}
                {status === "approved" && v.person && (
                  <div className="mt-3 border-t border-line pt-3">
                    <Button size="sm" variant="danger" onClick={() => onAction({ title: "Remove the badge?", help: "The verified badge disappears from their name.", confirm: "Remove badge", danger: true, run: () => api.admin.removeBadge(v.person!.user_id) })}>
                      Remove badge
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </ListState>
    </div>
  );
}

function SuspensionsTab({ onAction, refresh }: { onAction: (a: ActionRequest) => void; refresh: number }) {
  const load = useCallback(() => api.admin.suspensions(), []);
  const list = useList(load, refresh);
  return (
    <ListState list={list} empty="Nobody is suspended.">
      {(items: AdminSuspension[]) => (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Who person={s.person} />
              <span className="min-w-0 flex-1 text-muted">
                {s.reason} · {s.permanent || !s.ends_at ? "permanent" : `until ${formatDateTime(s.ends_at)}`}
              </span>
              <Button size="sm" onClick={() => onAction({ title: "Lift this suspension?", help: "They can post, comment and message again straight away.", confirm: "Lift", run: (note) => api.admin.lift(s.id, note) })}>
                Lift
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ListState>
  );
}

function LogTab({ refresh }: { refresh: number }) {
  const load = useCallback(() => api.admin.actions(), []);
  const list = useList(load, refresh);
  return (
    <ListState list={list} empty="No admin actions yet.">
      {(items: AdminAction[]) => (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card text-sm">
          {items.map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <p>
                <span className="font-medium">@{a.admin?.username ?? "admin"}</span> {ACTION_LABEL[a.action] ?? a.action}{" "}
                {a.target && <span className="font-medium">@{a.target.username}</span>}
                <span className="ml-2 text-xs text-muted" title={formatDateTime(a.created_at)}>
                  {timeAgo(a.created_at)}
                </span>
              </p>
              {a.note && <p className="text-xs text-muted">{a.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </ListState>
  );
}

/** /admin: only for people in admin_users (the API answers "not found" to everyone else). */
export function AdminPanel() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionRequest | null>(null);
  const [refresh, setRefresh] = useState(0);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.admin.stats());
      setAllowed(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setAllowed(false);
      else setError(e instanceof Error ? e.message : "Could not load the admin panel.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load
    void loadStats();
  }, [loadStats]);

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <EmptyState title="Page not found" action={<Link href="/" className="text-sm text-wine hover:underline">Back to the dashboard</Link>}>
          This page is only for the Drapeit team.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => { setRefresh((n) => n + 1); void loadStats(); }} />}
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-wine">Drapeit team</p>
      <h1 className="mt-1 font-display text-3xl">{t("admin.title")}</h1>
      <p className="mt-1 text-sm text-muted">Every action here is saved in the action log.</p>
      {error && (
        <div className="mt-4">
          <Notice tone="err" action={<Button size="sm" onClick={() => void loadStats()}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {allowed === null && !error ? (
        <Loading />
      ) : (
        <>
          <div role="tablist" aria-label={t("admin.title")} className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
            {TABS.map((x) => {
              const count = x.id === "reports" ? stats?.open_reports : x.id === "problems" ? stats?.open_problem_reports : x.id === "verification" ? stats?.pending_verifications : 0;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === x.id ? "border-wine font-medium text-wine" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {t(x.label)}
                  {!!count && <span className="rounded-full bg-wine px-1.5 text-[11px] leading-5 text-on-wine">{count}</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-5" role="tabpanel">
            {tab === "overview" && <Overview stats={stats} onOpen={setTab} />}
            {tab === "reports" && <ReportsTab onAction={setAction} refresh={refresh} />}
            {tab === "problems" && <ProblemsTab refresh={refresh} />}
            {tab === "verification" && <VerificationTab onAction={setAction} refresh={refresh} />}
            {tab === "suspensions" && <SuspensionsTab onAction={setAction} refresh={refresh} />}
            {tab === "log" && <LogTab refresh={refresh} />}
          </div>
        </>
      )}
    </div>
  );
}
