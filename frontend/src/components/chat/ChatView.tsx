/* eslint-disable @next/next/no-img-element -- pictures are served by our own API */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "@/components/social/Avatar";
import { MoreMenu, type MenuItem } from "@/components/social/MoreMenu";
import { useReport } from "@/components/social/ReportDialog";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, api } from "@/lib/api";
import { dayLabel, mergeMessages, messageTime, newDay } from "@/lib/chat";
import type { ChatDetail, ChatMessage } from "@/lib/types";
import { useLive, useLiveEvents } from "./LiveUpdates";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

const MAX_LENGTH = 2000;

/** A shared post inside a message: first picture, designer and caption, linking to the post. */
function SharedPostCard({ message }: { message: ChatMessage }) {
  if (!message.post) {
    return <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs italic text-muted">This post is not available. It was deleted, or you are not allowed to see it.</p>;
  }
  const post = message.post;
  return (
    <Link href={`/p/${post.id}`} className="block w-60 max-w-full overflow-hidden rounded-lg border border-line bg-surface shadow-card text-ink hover:border-line-strong">
      <span className="flex items-center gap-2 px-3 py-2">
        <Avatar person={post.author} size="sm" />
        <span className="truncate text-xs font-medium">@{post.author.username}</span>
      </span>
      {post.image_id ? (
        <img src={api.postImageUrl(post.image_id)} alt="Shared post" className="aspect-[4/5] w-full bg-canvas object-contain" />
      ) : (
        <span className="flex aspect-[4/5] items-center justify-center bg-sunken text-xs text-faint">No picture</span>
      )}
      {post.caption && (
        <span className="block px-3 py-2 text-xs text-muted">
          <span className="line-clamp-2">{post.caption}</span>
        </span>
      )}
    </Link>
  );
}

function Bubble({ message, seen, onUnsend, onReport }: { message: ChatMessage; seen: "Seen" | "Sent" | null; onUnsend: (m: ChatMessage) => void; onReport: (m: ChatMessage) => void }) {
  const mine = message.is_mine;
  const hasText = message.body.trim().length > 0;
  return (
    <li className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`flex max-w-[85%] items-start gap-1 sm:max-w-[70%] ${mine ? "flex-row-reverse" : ""}`}>
        <div className={`flex min-w-0 flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
          {message.kind === "post" && <SharedPostCard message={message} />}
          {message.kind === "design" && message.has_image && (
            <a href={api.messageImageUrl(message.id)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line bg-canvas">
              <img src={api.messageImageUrl(message.id)} alt="Design picture" className="max-h-72 w-60 max-w-full object-contain" />
            </a>
          )}
          {hasText && (
            <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-md bg-wine text-on-wine" : "rounded-bl-md bg-sunken text-ink"}`}>{message.body}</p>
          )}
        </div>
        <div className="self-center opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <MoreMenu
            size="sm"
            label="Message actions"
            items={
              mine
                ? [{ label: "Unsend", icon: "trash", danger: true, onSelect: () => onUnsend(message) }]
                : [{ label: "Report message", icon: "flag", danger: true, onSelect: () => onReport(message) }]
            }
          />
        </div>
      </div>
      <span className="mt-0.5 px-1 text-[11px] text-faint">
        {messageTime(message.created_at)}
        {seen && <span className={seen === "Seen" ? "font-medium text-muted" : ""}> · {seen}</span>}
      </span>
    </li>
  );
}

/** The box at the bottom: Enter sends, Shift+Enter starts a new line. */
function Composer({ chat, onSent }: { chat: ChatDetail; onSent: (m: ChatMessage) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSent(await api.sendMessage(chat.id, body));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send. Your message is kept, try again.");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  if (!chat.can_send) {
    return <p className="border-t border-line bg-sunken/60 px-4 py-3 text-center text-sm text-muted">{chat.cannot_send_reason ?? "You cannot send messages in this chat."}</p>;
  }
  return (
    <form onSubmit={send} className="border-t border-line bg-surface px-3 py-2.5">
      {error && (
        <p role="alert" className="mb-1.5 px-1 text-xs text-err">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-message"
          ref={box}
          rows={1}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message…"
          className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-wine focus:outline-none focus:ring-2 focus:ring-wine/15"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          aria-busy={busy || undefined}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine text-on-wine hover:bg-wine-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Icon name="send" />}
        </button>
      </div>
      {text.length > MAX_LENGTH - 200 && <p className="mt-1 px-1 text-right text-[11px] text-faint">{text.length}/{MAX_LENGTH}</p>}
    </form>
  );
}

/** /messages/<id>: one chat, with live updates. */
export function ChatView({ id }: { id: string }) {
  const router = useRouter();
  const { connected, refreshBadges } = useLive();
  const { confirm, dialog } = useConfirm();
  const { report, dialog: reportDialog } = useReport();
  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [older, setOlder] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(
    (detail: ChatDetail | null) => {
      // Reading a request would tell the sender "Seen"; that waits until you accept.
      if (!detail || detail.status !== "accepted" || document.visibilityState !== "visible") return;
      api.markChatRead(id).then(refreshBadges).catch(() => {});
    },
    [id, refreshBadges],
  );

  const loadDetail = useCallback(async () => {
    const detail = await api.chat(id);
    setChat(detail);
    return detail;
  }, [id]);

  /** The newest page. Anything older that was already loaded is kept, so unsent messages disappear too. */
  const loadLatest = useCallback(async () => {
    const page = await api.messages(id);
    setMessages((current) => {
      if (!current || page.messages.length === 0) return page.messages;
      const first = page.messages[0].created_at;
      return mergeMessages(current.filter((m) => m.created_at < first), page.messages);
    });
    setOlder((cur) => cur ?? page.next_cursor);
    return page;
  }, [id]);

  const loadAll = useCallback(async () => {
    try {
      const [detail] = await Promise.all([loadDetail(), loadLatest()]);
      setError(null);
      markRead(detail);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      setError(e instanceof Error ? e.message : "Could not load this chat.");
      setMessages((m) => m ?? []);
    }
  }, [loadDetail, loadLatest, markRead]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load when the chat opens
    void loadAll();
  }, [loadAll]);

  useLiveEvents((e) => {
    if (e.conversationId !== id) return;
    if (e.event === "message") void loadAll();
    if (e.event === "seen") void loadDetail().catch(() => {});
  });

  // Without live updates, check for new messages every few seconds.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void loadAll(), 8_000);
    return () => clearInterval(timer);
  }, [connected, loadAll]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && markRead(chat);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chat, markRead]);

  // Keep the newest message in view (unless the user scrolled up to read older ones), also while
  // pictures finish loading and make the list taller.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const loaded = messages !== null;
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [loaded]);

  function onScroll() {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    if (!older) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await api.messages(id, older);
      stickToBottom.current = false;
      setMessages((current) => mergeMessages(page.messages, current ?? []));
      setOlder(page.next_cursor);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  function sent(message: ChatMessage) {
    stickToBottom.current = true;
    setMessages((current) => mergeMessages(current ?? [], [message]));
    // Replying accepts a request.
    setChat((c) => (c && c.status === "request" ? { ...c, status: "accepted" } : c));
  }

  async function unsend(message: ChatMessage) {
    const ok = await confirm({ title: "Unsend this message?", message: "It will be removed for both of you.", confirmLabel: "Unsend", danger: true });
    if (!ok) return;
    try {
      await api.unsend(message.id);
      setMessages((current) => (current ?? []).filter((m) => m.id !== message.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unsend the message.");
    }
  }

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    await run(async () => {
      const detail = await api.acceptChat(id);
      setChat(detail);
      refreshBadges();
    });
  }

  async function deleteChat() {
    const request = chat?.status === "request";
    const ok = await confirm({
      title: request ? "Delete this request?" : "Delete this chat?",
      message: "It is removed for you only. If they write again, the chat comes back.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await run(() => api.deleteChat(id), () => {
      refreshBadges();
      router.push("/messages");
    });
  }

  async function toggleBlock() {
    if (!chat?.other) return;
    const other = chat.other;
    if (!chat.blocked_by_me) {
      const ok = await confirm({
        title: `Block @${other.username}?`,
        message: "They will not be able to message you, find your profile or see your posts. They are not told.",
        confirmLabel: "Block",
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.setSafety(other.username, "block", !chat.blocked_by_me), () => void loadDetail());
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <EmptyState title="Chat not found" action={<Link href="/messages" className="text-sm text-wine hover:underline">Back to messages</Link>}>
          It may have been deleted, or this account is no longer available to you.
        </EmptyState>
      </div>
    );
  }

  const other = chat?.other ?? null;
  const name = other ? other.display_name || other.username : "Drapeit user";
  const lastMine = messages ? [...messages].reverse().find((m) => m.is_mine) : undefined;
  const items: MenuItem[] = other
    ? [
        { label: "View profile", icon: "user", onSelect: () => router.push(`/u/${other.username}`) },
        { label: chat?.blocked_by_me ? "Unblock" : "Block", icon: "ban", danger: !chat?.blocked_by_me, onSelect: () => void toggleBlock() },
        { label: "Report account", icon: "flag", danger: true, onSelect: () => report({ type: "user", id: other.username, name: `@${other.username}` }) },
        { label: "Delete chat", icon: "trash", danger: true, onSelect: () => void deleteChat() },
      ]
    : [{ label: "Delete chat", icon: "trash", danger: true, onSelect: () => void deleteChat() }];

  return (
    <div className="mx-auto flex h-[calc(100dvh-57px)] max-w-3xl flex-col lg:h-dvh lg:border-x lg:border-line">
      {dialog}
      {reportDialog}
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <Link href="/messages" className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label="Back to messages">
          <Icon name="chevronLeft" className="h-5 w-5" />
        </Link>
        {other ? (
          <Link href={`/u/${other.username}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar person={other} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium hover:text-wine">
                {name} <VerifiedBadge person={other} />
              </span>
              <span className="block truncate text-xs text-muted">@{other.username}</span>
            </span>
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{chat ? name : "Loading…"}</span>
        )}
        {chat && <MoreMenu label="Chat actions" items={items} />}
      </header>

      {chat?.status === "request" && other && (
        <div className="border-b border-line bg-wine-soft/60 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">@{other.username}</span> wants to send you a message. You don&apos;t follow them. They won&apos;t see that you read this until you accept.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={accept} loading={busy}>
              Accept
            </Button>
            <Button size="sm" onClick={deleteChat} disabled={busy}>
              Delete
            </Button>
            <Button size="sm" variant="danger" onClick={toggleBlock} disabled={busy}>
              Block
            </Button>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="px-4 pt-3">
          <Notice tone="err" action={<Button size="sm" onClick={() => void loadAll()}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
        <div>
          {messages === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
              <Spinner /> Loading messages…
            </p>
          ) : (
            <>
              {older && (
                <div className="mb-4 flex justify-center">
                  <Button size="sm" onClick={loadOlder} loading={loadingOlder}>
                    Load older messages
                  </Button>
                </div>
              )}
              {messages.length === 0 && (
                <div className="flex flex-col items-center py-10 text-center">
                  {other && <Avatar person={other} size="lg" />}
                  <p className="mt-3 font-display text-lg">{name}</p>
                  <p className="mt-1 max-w-xs text-sm text-muted">No messages yet. Say hello, or send a post or a design sketch.</p>
                </div>
              )}
              <ul className="space-y-2">
                {messages.map((m, i) => (
                  <FragmentWithDay key={m.id} show={newDay(i ? messages[i - 1].created_at : null, m.created_at)} iso={m.created_at}>
                    <Bubble message={m} seen={m.id === lastMine?.id ? (chat?.seen_message_id === m.id ? "Seen" : "Sent") : null} onUnsend={unsend} onReport={(msg) => report({ type: "message", id: msg.id, name: "this message" })} />
                  </FragmentWithDay>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {chat && <Composer chat={chat} onSent={sent} />}
    </div>
  );
}

function FragmentWithDay({ show, iso, children }: { show: boolean; iso: string; children: ReactNode }) {
  return (
    <>
      {show && (
        <li className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-faint" aria-hidden>
          {dayLabel(iso)}
        </li>
      )}
      {children}
    </>
  );
}
