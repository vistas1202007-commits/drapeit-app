/* eslint-disable @next/next/no-img-element -- post pictures are served by our own API */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { LoadingPosts, LoadMore, PostGrid, usePostPages } from "@/components/social/PostList";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { daysLeft, formatDuration, localDay, weekday } from "@/lib/activity";
import { timeAgo } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import type { MyComment, Post, SearchEntry, TimeDay } from "@/lib/types";
import { SettingsHeader } from "./SettingsHome";

type Tab = "time" | "likes" | "comments" | "archived" | "deleted" | "searches";

const TABS: { id: Tab; label: MessageKey }[] = [
  { id: "time", label: "settings.timeSpent" },
  { id: "likes", label: "settings.likes" },
  { id: "comments", label: "settings.comments" },
  { id: "archived", label: "settings.archived" },
  { id: "deleted", label: "settings.recentlyDeleted" },
  { id: "searches", label: "settings.searchHistory" },
];

function Loading() {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <Spinner /> Loading…
    </p>
  );
}

function TimeSpent() {
  const [days, setDays] = useState<TimeDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .timeSpent(localDay())
      .then(setDays)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your time."));
  }, []);
  if (error) return <Notice tone="err">{error}</Notice>;
  if (!days) return <Loading />;
  const total = days.reduce((sum, d) => sum + d.seconds, 0);
  const most = Math.max(...days.map((d) => d.seconds), 60);
  return (
    <div>
      <p className="text-sm text-muted">
        This week: <span className="font-medium text-ink">{formatDuration(total)}</span> · daily average{" "}
        <span className="font-medium text-ink">{formatDuration(Math.round(total / 7))}</span>
      </p>
      <ul className="mt-5 flex h-48 items-end gap-2 sm:gap-4" aria-label="Time spent each day this week">
        {days.map((d, i) => (
          <li key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] text-muted">{d.seconds >= 60 ? formatDuration(d.seconds) : ""}</span>
            <span
              className={`w-full max-w-12 rounded-t-md ${i === days.length - 1 ? "bg-wine" : "bg-wine/40"}`}
              style={{ height: `${Math.max(2, (d.seconds / most) * 100)}%` }}
              aria-label={`${weekday(d.day)}: ${formatDuration(d.seconds)}`}
            />
            <span className="text-xs text-muted">{i === days.length - 1 ? "Today" : weekday(d.day)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-faint">Counted while the app is open on your screen, about one minute at a time, on this and your other devices.</p>
    </div>
  );
}

function PostsTab({ load, empty }: { load: (cursor: string | null) => ReturnType<typeof api.liked>; empty: string }) {
  const list = usePostPages(load);
  if (list.posts === null) return <LoadingPosts />;
  return (
    <div className="space-y-4">
      {list.posts.length === 0 && !list.error && <EmptyState title={empty} />}
      {list.posts.length > 0 && <PostGrid posts={list.posts} />}
      <LoadMore list={list} />
    </div>
  );
}

function MyComments() {
  const [items, setItems] = useState<MyComment[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (cursor: string | null) => {
    setBusy(true);
    try {
      const page = await api.myComments(cursor);
      setItems((prev) => (cursor && prev ? [...prev, ...page.comments] : page.comments));
      setNext(page.next_cursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your comments.");
      setItems((prev) => prev ?? []);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first page when the tab opens
    void load(null);
  }, [load]);
  if (items === null) return <Loading />;
  return (
    <div>
      {error && <Notice tone="err">{error}</Notice>}
      {items.length === 0 && !error ? (
        <EmptyState title="No comments yet">Comments you write on posts show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/p/${c.post_id}#comments`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/70">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm">{c.body}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {c.post_author ? `On @${c.post_author.username}'s post` : "On a post"} · {timeAgo(c.created_at)}
                    {!c.approved && " · waiting for approval"}
                  </span>
                </span>
                {c.post_image_id && <img src={api.postImageUrl(c.post_image_id)} alt="" className="h-12 w-12 shrink-0 rounded-md border border-line bg-canvas object-cover" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => load(next)} loading={busy}>
            Show older
          </Button>
        </div>
      )}
    </div>
  );
}

function RecentlyDeleted() {
  const { t } = useT();
  const { confirm, dialog } = useConfirm();
  const load = useCallback((cursor: string | null) => api.myPosts("deleted", cursor), []);
  const list = usePostPages(load);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(post: Post, forGood: boolean) {
    if (forGood) {
      const ok = await confirm({ title: "Delete this post for good?", message: "Its pictures, likes and comments are removed. This cannot be undone.", confirmLabel: "Delete for good", danger: true });
      if (!ok) return;
    }
    setBusy(post.id);
    setError(null);
    try {
      if (forGood) await api.deletePostForGood(post.id);
      else await api.restorePost(post.id);
      setGone((s) => new Set(s).add(post.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  if (list.posts === null) return <LoadingPosts />;
  const posts = list.posts.filter((p) => !gone.has(p.id));
  return (
    <div className="space-y-4">
      {dialog}
      <p className="text-sm text-muted">Deleted posts wait here for 30 days, hidden from everyone. Restore one to put it back where it was.</p>
      {error && <Notice tone="err">{error}</Notice>}
      {posts.length === 0 && !list.error ? (
        <EmptyState title="Nothing recently deleted" />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {p.images[0] ? (
                <img src={api.postImageUrl(p.images[0].id)} alt="" className="h-14 w-14 shrink-0 rounded-md border border-line bg-canvas object-cover" />
              ) : (
                <span className="h-14 w-14 shrink-0 rounded-md bg-sunken" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.caption || "No caption"}</span>
                <span className="block text-xs text-muted">{p.deleted_at ? `${daysLeft(p.deleted_at)} days left` : ""}</span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" onClick={() => act(p, false)} loading={busy === p.id}>
                  {t("common.restore")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => act(p, true)} disabled={busy === p.id}>
                  Delete for good
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={list} />
    </div>
  );
}

function SearchHistory() {
  const { t } = useT();
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<SearchEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .searchHistory()
      .then(setItems)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load your searches.");
        setItems([]);
      });
  }, []);

  async function remove(id?: string) {
    if (!id && !(await confirm({ title: "Clear all searches?", message: "Your search history is removed. This cannot be undone.", confirmLabel: t("common.clearAll"), danger: true }))) return;
    try {
      await api.deleteSearch(id);
      setItems((list) => (id ? (list ?? []).filter((s) => s.id !== id) : []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  }

  if (items === null) return <Loading />;
  return (
    <div>
      {dialog}
      {error && <Notice tone="err">{error}</Notice>}
      {items.length === 0 ? (
        <EmptyState title="No searches">What you search for on Explore shows up here. Only you can see it.</EmptyState>
      ) : (
        <>
          <div className="flex justify-end">
            <Button size="sm" variant="danger" onClick={() => remove()}>
              {t("common.clearAll")}
            </Button>
          </div>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {items.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <Icon name="search" className="h-4 w-4 text-muted" />
                <Link href={`/explore?q=${encodeURIComponent(s.query)}`} className="min-w-0 flex-1 truncate text-sm hover:text-wine">
                  {s.query}
                </Link>
                <span className="text-xs text-faint">{timeAgo(s.created_at)}</span>
                <button type="button" onClick={() => remove(s.id)} className="rounded p-1 text-muted hover:bg-sunken hover:text-err" aria-label={`Remove “${s.query}”`}>
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** /settings/activity */
export function ActivityView() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("time");
  const liked = useCallback((cursor: string | null) => api.liked(cursor), []);
  const archived = useCallback((cursor: string | null) => api.myPosts("archived", cursor), []);

  useEffect(() => {
    // Links from the Settings search open the right tab (/settings/activity#deleted).
    const fromHash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only known in the browser
    if (TABS.some((x) => x.id === fromHash)) setTab(fromHash as Tab);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(window.history.state, "", `#${next}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.activity")} />
      <div role="tablist" aria-label={t("settings.activity")} className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => choose(x.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === x.id ? "border-wine font-medium text-wine" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t(x.label)}
          </button>
        ))}
        <Link href="/saved" className="whitespace-nowrap px-3 py-2 text-sm text-muted hover:text-ink">
          {t("nav.saved")} ↗
        </Link>
      </div>
      <div className="mt-5" role="tabpanel">
        {tab === "time" && <TimeSpent />}
        {tab === "likes" && <PostsTab load={liked} empty="Posts you like show up here." />}
        {tab === "comments" && <MyComments />}
        {tab === "archived" && <PostsTab load={archived} empty="No archived posts. Archive a post to hide it from everyone but you." />}
        {tab === "deleted" && <RecentlyDeleted />}
        {tab === "searches" && <SearchHistory />}
      </div>
    </div>
  );
}
