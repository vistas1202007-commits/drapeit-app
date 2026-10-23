/* eslint-disable @next/next/no-img-element -- post pictures are served by our own API */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { Post, PostPage } from "@/lib/types";
import { PostCard } from "./PostCard";

/** Loads a list of posts a page at a time ("Load more"), with loading, error and empty states. */
export function usePostPages(load: (cursor: string | null) => Promise<PostPage & { pinned?: Post[] }>) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [pinned, setPinned] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const page = await load(after);
        if (!after) setPinned(page.pinned ?? []);
        setPosts((prev) => (after && prev ? [...prev, ...page.posts] : page.posts));
        setCursor(page.next_cursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load posts.");
        setPosts((prev) => prev ?? []);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first page when the list opens
    void fetchPage(null);
  }, [fetchPage]);

  return { posts, pinned, cursor, busy, error, more: () => fetchPage(cursor), reload: () => fetchPage(null) };
}

export function LoadMore({ list }: { list: ReturnType<typeof usePostPages> }) {
  return (
    <>
      {list.error && (
        <Notice tone="err" title="Could not load posts" action={<Button size="sm" onClick={list.posts?.length ? list.more : list.reload}>Try again</Button>}>
          {list.error}
        </Notice>
      )}
      {list.cursor && !list.error && (
        <div className="flex justify-center">
          <Button onClick={list.more} loading={list.busy}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

export function LoadingPosts({ label = "Loading posts…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <Spinner /> {label}
    </p>
  );
}

/** A feed-style column of full post cards. */
export function PostColumn({ load, empty }: { load: (cursor: string | null) => Promise<PostPage>; empty: ReactNode }) {
  const list = usePostPages(load);
  if (list.posts === null) return <LoadingPosts />;
  return (
    <div className="space-y-5">
      {list.posts.length === 0 && !list.error && empty}
      {list.posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <LoadMore list={list} />
    </div>
  );
}

/** Square thumbnails, Instagram-style. */
export function PostGrid({ posts }: { posts: Post[] }) {
  return (
    <ul className="grid grid-cols-3 gap-1 sm:gap-2">
      {posts.map((p) => (
        <li key={p.id}>
          <Link href={`/p/${p.id}`} className="group relative block aspect-square overflow-hidden rounded-sm bg-sunken sm:rounded-md" aria-label={p.caption ? `Post: ${p.caption.slice(0, 60)}` : "Open post"}>
            {p.images[0] ? (
              <img src={api.postImageUrl(p.images[0].id)} alt="" loading="lazy" className="h-full w-full bg-canvas object-cover transition-transform group-hover:scale-[1.03]" />
            ) : (
              <span className="flex h-full items-center justify-center p-2 text-center text-xs text-faint">{p.caption || "No pictures yet"}</span>
            )}
            <span className="absolute right-1.5 top-1.5 flex gap-1">
              {p.pinned && <Icon name="pin" className="h-4 w-4 rounded bg-surface/90 p-0.5 text-wine" />}
              {p.images.length > 1 && <Icon name="grid" className="h-4 w-4 rounded bg-surface/90 p-0.5 text-ink" />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FeedView() {
  const load = useCallback((cursor: string | null) => api.feed(cursor), []);
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">Home Feed</h1>
      <p className="mt-1 text-sm text-muted">Newest designs from people on Drapeit that you are allowed to see.</p>
      <div className="mt-6">
        <PostColumn
          load={load}
          empty={
            <EmptyState title="Nothing to see yet" action={<Link href="/" className="text-sm text-wine hover:underline">Open a design and press Publish</Link>}>
              When you or other people publish designs, they show up here, newest first.
            </EmptyState>
          }
        />
      </div>
    </div>
  );
}

export function SavedView() {
  const load = useCallback((cursor: string | null) => api.saved(cursor), []);
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">Saved</h1>
      <p className="mt-1 text-sm text-muted">Posts you saved. Only you can see this list.</p>
      <div className="mt-6">
        <PostColumn
          load={load}
          empty={
            <EmptyState title="No saved posts" action={<Link href="/feed" className="text-sm text-wine hover:underline">Go to the Home Feed</Link>}>
              Press <span className="font-medium">Save</span> under a post to keep it here.
            </EmptyState>
          }
        />
      </div>
    </div>
  );
}
