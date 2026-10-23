/* eslint-disable @next/next/no-img-element -- post pictures are served by our own API */
"use client";

import Link from "next/link";
import { useState } from "react";
import { SendPostDialog } from "@/components/chat/SendDialogs";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Swatch } from "@/components/outputs/Swatch";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { countLabel, hashtag, postLink, tagList, VISIBILITY_LABEL } from "@/lib/social";
import type { FabricRecommendation, Post } from "@/lib/types";
import { Avatar } from "./Avatar";
import { MoreMenu } from "./MoreMenu";
import { useReport } from "./ReportDialog";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

const TEXTURES = new Set(["plain", "twill", "satin", "sheer", "knit", "pile", "slub", "crepe"]);

/** Copy a link to the post (or use the phone's share sheet). The link only opens for people allowed to see the post. */
async function sharePost(post: Post): Promise<string> {
  const url = postLink(window.location.origin, post.id);
  if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ title: "Drapeit design", url });
      return "Shared";
    } catch {
      /* the share sheet was closed; fall back to copying */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Link copied";
  } catch {
    window.prompt("Copy this link:", url);
    return "Link ready";
  }
}

/** Like, Comment, Repost, Save, Send and Share buttons. They change at once and go back if the server says no. */
export function PostActions({ post, onChange }: { post: Post; onChange: (p: Post) => void }) {
  const [busy, setBusy] = useState<"like" | "save" | "repost" | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  async function toggle(what: "like" | "save" | "repost") {
    const on = what === "like" ? !post.liked_by_me : what === "save" ? !post.saved_by_me : !post.reposted_by_me;
    const step = on ? 1 : -1;
    const optimistic: Post =
      what === "like"
        ? { ...post, liked_by_me: on, like_count: post.like_count + step }
        : what === "save"
          ? { ...post, saved_by_me: on, save_count: post.save_count + step }
          : { ...post, reposted_by_me: on, repost_count: post.repost_count + step };
    setBusy(what);
    setError(null);
    onChange(optimistic);
    try {
      onChange(what === "repost" ? await api.repost(post.id, on) : await api.react(post.id, what, on));
    } catch (e) {
      onChange(post);
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setShared(await sharePost(post));
    setTimeout(() => setShared(null), 2500);
  }

  const canReact = post.status === "published";
  return (
    <div>
      {sending && <SendPostDialog post={post} onClose={() => setSending(false)} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap text-sm">
        <button
          type="button"
          onClick={() => toggle("like")}
          disabled={!canReact || busy !== null}
          aria-pressed={post.liked_by_me}
          className="flex items-center gap-1.5 rounded-md py-1 text-muted hover:text-wine disabled:opacity-50"
        >
          <Icon name="heart" className={`h-5 w-5 ${post.liked_by_me ? "fill-wine text-wine" : ""}`} />
          <span>{countLabel(post.like_count, "like")}</span>
        </button>
        {canReact && (
          <Link href={`/p/${post.id}#comments`} className="flex items-center gap-1.5 rounded-md py-1 text-muted hover:text-wine">
            <Icon name="comment" className="h-5 w-5" />
            <span>{post.comment_count}</span>
            <span className="sr-only">{post.comment_count === 1 ? "comment" : "comments"}</span>
          </Link>
        )}
        {(post.can_repost || post.reposted_by_me) && (
          <button
            type="button"
            onClick={() => toggle("repost")}
            disabled={busy !== null}
            aria-pressed={post.reposted_by_me}
            title={post.reposted_by_me ? "Undo repost" : "Repost to your profile (the designer keeps the credit)"}
            className={`flex items-center gap-1.5 rounded-md py-1 hover:text-wine disabled:opacity-50 ${post.reposted_by_me ? "text-wine" : "text-muted"}`}
          >
            <Icon name="repost" className="h-5 w-5" />
            <span>{post.reposted_by_me ? "Reposted" : "Repost"}</span>
            {post.repost_count > 0 && <span className="text-xs text-faint">({post.repost_count})</span>}
          </button>
        )}
        <button
          type="button"
          onClick={() => toggle("save")}
          disabled={!canReact || busy !== null}
          aria-pressed={post.saved_by_me}
          className="flex items-center gap-1.5 rounded-md py-1 text-muted hover:text-wine disabled:opacity-50"
        >
          <Icon name="bookmark" className={`h-5 w-5 ${post.saved_by_me ? "fill-wine text-wine" : ""}`} />
          <span>{post.saved_by_me ? "Saved" : "Save"}</span>
          {post.save_count > 0 && <span className="text-xs text-faint">({post.save_count})</span>}
        </button>
        {canReact && (
          <button type="button" onClick={() => setSending(true)} className="ml-auto flex items-center gap-1.5 rounded-md py-1 text-muted hover:text-wine" title="Send this post in a chat">
            <Icon name="send" className="h-5 w-5" />
            <span>Send</span>
          </button>
        )}
        {canReact && (
          <button type="button" onClick={share} className="flex items-center gap-1.5 rounded-md py-1 text-muted hover:text-wine" title="Copy a link to this post">
            <Icon name="link" className="h-5 w-5" />
            <span aria-live="polite">{shared ?? "Share"}</span>
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-err">
          {error}
        </p>
      )}
    </div>
  );
}

/** The post's pictures, one at a time, with arrows and dots when there are several. */
export function PostImages({ post, className = "" }: { post: Post; className?: string }) {
  const [index, setIndex] = useState(0);
  if (post.images.length === 0) {
    return <div className={`flex aspect-[4/5] items-center justify-center bg-sunken text-sm text-faint ${className}`}>No pictures yet</div>;
  }
  const i = Math.min(index, post.images.length - 1);
  const several = post.images.length > 1;
  return (
    <div className={`relative aspect-[4/5] overflow-hidden bg-canvas ${className}`}>
      <img src={api.postImageUrl(post.images[i].id)} alt={`Picture ${i + 1} of ${post.images.length}${post.caption ? `: ${post.caption.slice(0, 80)}` : ""}`} className="h-full w-full object-contain" />
      {several && (
        <>
          <button type="button" aria-label="Previous picture" disabled={i === 0} onClick={() => setIndex(i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1.5 shadow disabled:opacity-0">
            <Icon name="chevronLeft" />
          </button>
          <button type="button" aria-label="Next picture" disabled={i === post.images.length - 1} onClick={() => setIndex(i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-surface/90 p-1.5 shadow disabled:opacity-0">
            <Icon name="chevronRight" />
          </button>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5" aria-hidden>
            {post.images.map((img, n) => (
              <span key={img.id} className={`h-1.5 w-1.5 rounded-full ${n === i ? "bg-wine" : "bg-canvas/80 ring-1 ring-ink/10"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Colours and fabrics the author chose to show. */
export function PostDetails({ post }: { post: Post }) {
  if (post.palette.length === 0 && post.fabrics.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
      {post.palette.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted">Colours</span>
          {post.palette.map((c) => (
            <span key={c.name + c.hex} title={c.name} className="h-5 w-5 rounded-full border border-ink/10" style={{ backgroundColor: c.hex }} />
          ))}
          <span className="sr-only">{post.palette.map((c) => c.name).join(", ")}</span>
        </div>
      )}
      {post.fabrics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted">Fabric</span>
          {post.fabrics.map((f) => (
            <span key={f.name} className="flex items-center gap-1 rounded-full border border-line py-0.5 pl-0.5 pr-2">
              <Swatch colour={f.swatch} texture={(TEXTURES.has(f.texture) ? f.texture : "plain") as FabricRecommendation["texture"]} className="h-4 w-4 rounded-full" />
              {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PostCard({ post: initial, link = true }: { post: Post; link?: boolean }) {
  const [post, setPost] = useState(initial);
  const { report, dialog } = useReport();
  const when = post.published_at ?? post.updated_at;
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      {dialog}
      {post.reposted_by && (
        <p className="flex flex-wrap items-center gap-1.5 border-b border-line bg-sunken/60 px-4 py-1.5 text-xs text-muted">
          <Icon name="repost" className="h-3.5 w-3.5" />
          Reposted by
          <Link href={`/u/${post.reposted_by.username}`} className="font-medium text-ink hover:text-wine">
            @{post.reposted_by.username}
          </Link>
          <span>· design by @{post.author.username}</span>
        </p>
      )}
      <header className="flex items-center gap-3 px-4 py-3">
        <Link href={`/u/${post.author.username}`} className="shrink-0">
          <Avatar person={post.author} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${post.author.username}`} className="block truncate text-sm font-medium hover:text-wine">
            {post.author.display_name || post.author.username} <VerifiedBadge person={post.author} />
          </Link>
          <p className="truncate text-xs text-muted">
            @{post.author.username} · {timeAgo(when)}
          </p>
        </div>
        {post.visibility !== "public" && <Badge>{VISIBILITY_LABEL[post.visibility]}</Badge>}
        {post.pinned && <Icon name="pin" className="h-4 w-4 text-wine" />}
        {!post.is_mine && post.status === "published" && (
          <MoreMenu size="sm" label="Post actions" items={[{ label: "Report post", icon: "flag", danger: true, onSelect: () => report({ type: "post", id: post.id, name: "this post" }) }]} />
        )}
      </header>
      {link ? (
        <Link href={`/p/${post.id}`} aria-label="Open post">
          <PostImages post={post} className="border-y border-line" />
        </Link>
      ) : (
        <PostImages post={post} className="border-y border-line" />
      )}
      <div className="space-y-2.5 px-4 py-3">
        <PostActions post={post} onChange={setPost} />
        {post.caption && <p className="whitespace-pre-line text-sm">{post.caption}</p>}
        {tagList(post.tags).length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {tagList(post.tags).map((t) => (
              <li key={t} className="rounded-full bg-wine-soft px-2 py-0.5 text-xs text-wine">
                {hashtag(t)}
              </li>
            ))}
          </ul>
        )}
        <PostDetails post={post} />
      </div>
    </article>
  );
}
