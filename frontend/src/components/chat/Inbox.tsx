"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/social/Avatar";
import { useMyProfile } from "@/components/social/MyProfile";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { badgeLabel } from "@/lib/chat";
import { timeAgo } from "@/lib/format";
import type { ChatList, ChatSummary } from "@/lib/types";
import { useLive, useLiveEvents } from "./LiveUpdates";
import { NewChatDialog } from "./SendDialogs";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

type Folder = "inbox" | "requests";

function ChatRow({ chat }: { chat: ChatSummary }) {
  const unread = chat.unread_count > 0 && chat.status === "accepted";
  const name = chat.other ? chat.other.display_name || chat.other.username : "Drapeit user";
  return (
    <li>
      <Link href={`/messages/${chat.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/70">
        {chat.other ? <Avatar person={chat.other} /> : <span className="h-11 w-11 shrink-0 rounded-full bg-sunken" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${unread ? "font-semibold text-ink" : "font-medium"}`}>
            {name} <VerifiedBadge person={chat.other} />
          </span>
          <span className={`block truncate text-xs ${unread ? "font-medium text-ink" : "text-muted"}`}>
            {chat.last_message_mine && "You: "}
            {chat.last_message}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-faint">{timeAgo(chat.last_message_at)}</span>
          {unread && (
            <span className="min-w-5 rounded-full bg-wine px-1.5 text-center text-[11px] font-medium leading-5 text-on-wine">
              {badgeLabel(chat.unread_count)}
              <span className="sr-only"> unread</span>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** /messages: your chats and message requests, newest first. */
export function Inbox() {
  const { profile } = useMyProfile();
  const { connected, refreshBadges } = useLive();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [list, setList] = useState<ChatList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newChat, setNewChat] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.chats(folder));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your messages.");
      setList((l) => l ?? { chats: [], request_count: 0 });
    }
  }, [folder]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the spinner while the other folder loads
    setList(null);
    void load();
    refreshBadges();
  }, [load, refreshBadges]);

  // New messages appear without a refresh (or every few seconds when live updates are off).
  useLiveEvents((e) => e.event === "message" && void load());
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [connected, load]);

  const tab = (id: Folder, label: string, count = 0) => (
    <button
      type="button"
      role="tab"
      aria-selected={folder === id}
      onClick={() => setFolder(id)}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${folder === id ? "border-wine font-medium text-wine" : "border-transparent text-muted hover:text-ink"}`}
    >
      {label}
      {count > 0 && <span className="rounded-full bg-wine-soft px-1.5 text-[11px] text-wine">{badgeLabel(count)}</span>}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Messages</h1>
          <p className="mt-1 text-sm text-muted">Private chats. Only you and the other person can read them.</p>
        </div>
        <Button variant="primary" onClick={() => setNewChat(true)} disabled={!profile}>
          <Icon name="pen" />
          New message
        </Button>
      </div>

      {profile === null && (
        <div className="mt-4">
          <Notice tone="warn" title="Set up your profile first" action={<Link href="/profile/edit" className="text-sm text-wine hover:underline">Set up profile</Link>}>
            Choose a username so people can see who is writing to them.
          </Notice>
        </div>
      )}

      <div role="tablist" aria-label="Folders" className="mt-5 flex border-b border-line">
        {tab("inbox", "Chats")}
        {tab("requests", "Requests", list?.request_count ?? 0)}
        <Link href="/settings/privacy#messages" className="ml-auto self-center text-xs text-muted hover:text-wine">
          Who can message me?
        </Link>
      </div>

      {folder === "requests" && (
        <p className="mt-3 text-xs text-muted">
          Messages from people you don&apos;t follow wait here. They don&apos;t see that you read them until you accept. Accept to move the chat to Chats, or delete it.
        </p>
      )}

      {error && (
        <div className="mt-4">
          <Notice tone="err" action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {list === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading messages…
        </p>
      ) : list.chats.length === 0 && !error ? (
        <div className="mt-6">
          {folder === "inbox" ? (
            <EmptyState title="No chats yet" action={profile ? <Button onClick={() => setNewChat(true)}>Start a chat</Button> : undefined}>
              Message a designer, a tailor or a friend. You can also send posts and your design sketches from the Send buttons.
            </EmptyState>
          ) : (
            <EmptyState title="No message requests">When someone you don&apos;t follow writes to you, it shows up here first.</EmptyState>
          )}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {list.chats.map((c) => (
            <ChatRow key={c.id} chat={c} />
          ))}
        </ul>
      )}
    </div>
  );
}
