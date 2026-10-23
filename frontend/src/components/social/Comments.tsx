"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Comment, CommentList, Post } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useMyProfile } from "./MyProfile";
import { useReport } from "./ReportDialog";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

/** Put a changed comment back into the tree (top level or a reply). */
function replaceIn(list: Comment[], next: Comment): Comment[] {
  return list.map((c) => (c.id === next.id ? { ...next, replies: c.replies } : { ...c, replies: c.replies.map((r) => (r.id === next.id ? next : r)) }));
}

function removeFrom(list: Comment[], id: string): Comment[] {
  return list.filter((c) => c.id !== id).map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== id) }));
}

function CommentForm({ onSend, placeholder, autoFocus, onCancel }: { onSend: (body: string) => Promise<void>; placeholder: string; autoFocus?: boolean; onCancel?: () => void }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(body.trim());
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the comment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex items-end gap-2">
        <textarea
          aria-label={placeholder}
          className={`${inputClass} min-h-10 resize-y`}
          rows={1}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()}>
          Post
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {body.length > 900 && <p className="text-xs text-muted">{body.length}/1000</p>}
      {error && (
        <p role="alert" className="text-xs text-err">
          {error}
        </p>
      )}
    </form>
  );
}

function CommentItem({
  comment,
  onChange,
  onRemove,
  onReply,
  isReply = false,
}: {
  comment: Comment;
  onChange: (c: Comment) => void;
  onRemove: (id: string) => void;
  onReply?: () => void;
  isReply?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const { report, dialog: reportDialog } = useReport();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this comment?",
      message: comment.replies.length ? "Its replies are deleted too. This cannot be undone." : "This cannot be undone.",
      confirmLabel: "Delete comment",
      danger: true,
    });
    if (ok) await run("delete", async () => {
      await api.deleteComment(comment.id);
      onRemove(comment.id);
    });
  }

  const name = comment.author.display_name || comment.author.username;
  return (
    <div className="flex gap-2.5">
      {dialog}
      {reportDialog}
      <Link href={`/u/${comment.author.username}`} className="shrink-0">
        <Avatar person={comment.author} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className={`rounded-lg px-3 py-2 ${comment.approved ? "bg-sunken/70" : "border border-dashed border-warn/40 bg-warn-soft"}`}>
          <p className="flex flex-wrap items-center gap-x-2 text-xs">
            <Link href={`/u/${comment.author.username}`} className="font-medium text-ink hover:text-wine">
              {name} <VerifiedBadge person={comment.author} className="h-3 w-3" />
            </Link>
            <span className="text-faint">@{comment.author.username}</span>
            {!comment.approved && <Badge tone="warn">{comment.is_mine ? "Waiting for approval" : "Needs your approval"}</Badge>}
            {comment.hidden && <Badge title="It has one of the post owner's hidden words, so only its writer and the post owner see it.">Hidden from others</Badge>}
          </p>
          <p className="mt-0.5 whitespace-pre-line break-words text-sm">{comment.body}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-xs text-muted">
          <span>{timeAgo(comment.created_at)}</span>
          {comment.approved && (
            <button
              type="button"
              aria-pressed={comment.liked_by_me}
              disabled={busy !== null}
              onClick={() => run("like", async () => onChange(await api.likeComment(comment.id, !comment.liked_by_me)))}
              className={`flex items-center gap-1 hover:text-wine disabled:opacity-50 ${comment.liked_by_me ? "text-wine" : ""}`}
            >
              <Icon name="heart" className={`h-3.5 w-3.5 ${comment.liked_by_me ? "fill-wine" : ""}`} />
              {comment.like_count > 0 ? comment.like_count : "Like"}
            </button>
          )}
          {!isReply && onReply && comment.approved && (
            <button type="button" onClick={onReply} className="hover:text-wine">
              Reply
            </button>
          )}
          {comment.can_approve && (
            <button type="button" disabled={busy !== null} onClick={() => run("approve", async () => onChange(await api.approveComment(comment.id)))} className="font-medium text-ok hover:underline disabled:opacity-50">
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
          )}
          {comment.can_delete && (
            <button type="button" disabled={busy !== null} onClick={remove} className="hover:text-err disabled:opacity-50">
              {busy === "delete" ? "Deleting…" : "Delete"}
            </button>
          )}
          {!comment.is_mine && (
            <button type="button" onClick={() => report({ type: "comment", id: comment.id, name: `@${comment.author.username}'s comment` })} className="hover:text-err">
              Report
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-1 px-1 text-xs text-err">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Comments under a post: add, reply (one level), like, delete, approve (restricted writers), report. */
export function Comments({ post }: { post: Post }) {
  const { profile } = useMyProfile();
  const [data, setData] = useState<CommentList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.comments(post.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load comments.");
    }
  }, [post.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load when the post opens
    void load();
  }, [load]);

  const update = (fn: (list: Comment[]) => Comment[], delta = 0) =>
    setData((d) => (d ? { ...d, comments: fn(d.comments), total: d.total + delta } : d));

  async function add(body: string, parentId: string | null = null) {
    const created = await api.addComment(post.id, body, parentId);
    if (parentId) {
      update((list) => list.map((c) => (c.id === parentId ? { ...c, replies: [...c.replies, created] } : c)), 1);
      setReplyTo(null);
    } else {
      update((list) => [...list, created], 1);
    }
  }

  function removed(id: string) {
    setData((d) => {
      if (!d) return d;
      const top = d.comments.find((c) => c.id === id);
      const gone = top ? 1 + top.replies.length : 1;
      return { ...d, comments: removeFrom(d.comments, id), total: d.total - gone };
    });
  }

  if (post.status !== "published") return null;
  return (
    <section id="comments" aria-labelledby="comments-title" className="scroll-mt-20 rounded-xl border border-line bg-surface p-4">
      <h2 id="comments-title" className="font-display text-lg">
        Comments{data ? ` (${data.total})` : ""}
      </h2>
      {error && (
        <div className="mt-3">
          <Notice tone="err" title="Could not load comments" action={<Button size="sm" onClick={load}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {!data && !error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading comments…
        </p>
      )}
      {data && (
        <>
          {data.comments.length === 0 && <p className="mt-3 text-sm text-faint">No comments yet. Be the first to say something kind.</p>}
          <ul className="mt-3 space-y-4">
            {data.comments.map((c) => (
              <li key={c.id} className="space-y-2.5">
                <CommentItem comment={c} onChange={(n) => update((l) => replaceIn(l, n))} onRemove={removed} onReply={() => setReplyTo(replyTo === c.id ? null : c.id)} />
                {(c.replies.length > 0 || replyTo === c.id) && (
                  <ul className="ml-10 space-y-2.5 border-l border-line pl-3">
                    {c.replies.map((r) => (
                      <li key={r.id}>
                        <CommentItem comment={r} isReply onChange={(n) => update((l) => replaceIn(l, n))} onRemove={removed} />
                      </li>
                    ))}
                    {replyTo === c.id && (
                      <li>
                        <CommentForm autoFocus placeholder={`Reply to @${c.author.username}`} onSend={(body) => add(body, c.id)} onCancel={() => setReplyTo(null)} />
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {data.truncated && <p className="mt-3 text-xs text-muted">Showing the first {data.total} comments.</p>}
          <div className="mt-4 border-t border-line pt-4">
            {profile === null ? (
              <p className="text-sm text-muted">
                <Link href="/profile/edit" className="text-wine hover:underline">
                  Set up your profile
                </Link>{" "}
                to comment.
              </p>
            ) : !post.can_comment ? (
              <p className="text-sm text-muted">The designer has limited who can comment on this post.</p>
            ) : (
              <CommentForm placeholder="Add a comment…" onSend={(body) => add(body)} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
