"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { VISIBILITY_LABEL } from "@/lib/social";
import type { Post, PostStatus } from "@/lib/types";
import { Comments } from "./Comments";
import { PostCard } from "./PostCard";
import { PublishForm } from "./PublishForm";

const STATUS_LABEL: Record<PostStatus, string> = { draft: "Draft", published: "Published", archived: "Archived", deleted: "Recently deleted" };

function usePost(id: string) {
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getPost(id)
      .then((p) => !cancelled && setPost(p))
      .catch((e: Error) => !cancelled && setError(e.message.startsWith("Post not found") ? "This post does not exist, or you are not allowed to see it." : e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { post, setPost, error };
}

function NotOpen({ error }: { error: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-8">
      <Notice tone="err" title="This post could not be opened" action={<Link href="/feed" className={buttonClass("secondary", "sm")}>Home Feed</Link>}>
        {error}
      </Notice>
    </div>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted" role="status">
      <Spinner /> Opening post…
    </p>
  );
}

/** Buttons only the author sees. */
function OwnerTools({ post, onChange }: { post: Post; onChange: (p: Post) => void }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<Post | void>) {
    setBusy(label);
    setError(null);
    try {
      const result = await action();
      if (result) onChange(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this post?",
      message: "It moves to Recently deleted (Settings → Your activity) for 30 days, hidden from everyone. You can restore it there; after 30 days it is deleted for good. Your design itself is not touched.",
      confirmLabel: "Delete post",
      danger: true,
    });
    if (!ok) return;
    await run("delete", async () => {
      await api.deletePost(post.id);
      router.push("/feed");
    });
  }

  return (
    <section className="rounded-lg border border-line bg-surface shadow-card p-4">
      {dialog}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={post.status === "published" ? "ok" : "warn"}>{STATUS_LABEL[post.status]}</Badge>
        <Badge>{VISIBILITY_LABEL[post.visibility]}</Badge>
        {post.pinned && <Badge tone="wine">Pinned</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/p/${post.id}/edit`} className={buttonClass("secondary", "sm")}>
          <Icon name="pen" className="h-3.5 w-3.5" /> Edit
        </Link>
        {post.status !== "published" && (
          <Button size="sm" variant="primary" loading={busy === "publish"} onClick={() => run("publish", () => api.updatePost(post.id, { status: "published" }))}>
            <Icon name="send" className="h-3.5 w-3.5" /> {post.status === "draft" ? "Publish" : "Publish again"}
          </Button>
        )}
        {post.status === "published" && (
          <>
            <Button size="sm" loading={busy === "pin"} onClick={() => run("pin", () => api.updatePost(post.id, { pinned: !post.pinned }))}>
              <Icon name="pin" className="h-3.5 w-3.5" /> {post.pinned ? "Unpin" : "Pin to profile"}
            </Button>
            <Button size="sm" loading={busy === "archive"} onClick={() => run("archive", () => api.updatePost(post.id, { status: "archived" }))}>
              <Icon name="archive" className="h-3.5 w-3.5" /> Archive
            </Button>
          </>
        )}
        {post.project_id && (
          <Link href={`/projects/${post.project_id}`} className={buttonClass("ghost", "sm")}>
            Open design
          </Link>
        )}
        <Button size="sm" variant="danger" loading={busy === "delete"} onClick={remove}>
          <Icon name="trash" className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {post.status === "draft" && "Only you can see drafts."}
        {post.status === "archived" && "Archived posts are hidden from everyone but you."}
        {post.status === "published" && "Archive hides the post again without deleting it."}
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
    </section>
  );
}

export function PostDetail({ id }: { id: string }) {
  const { post, setPost, error } = usePost(id);
  if (error) return <NotOpen error={error} />;
  if (!post) return <Loading />;
  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6 sm:px-8">
      <Link href="/feed" className="text-xs text-muted hover:text-wine">
        ← Home Feed
      </Link>
      {post.is_mine && <OwnerTools post={post} onChange={setPost} />}
      <PostCard key={`${post.id}-${post.updated_at}`} post={post} link={false} />
      <Comments post={post} />
    </div>
  );
}

export function PostEditor({ id }: { id: string }) {
  const { post, error } = usePost(id);
  if (error) return <NotOpen error={error} />;
  if (!post) return <Loading />;
  if (!post.is_mine) return <NotOpen error="Only the author can edit this post." />;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
      <Link href={`/p/${post.id}`} className="text-xs text-muted hover:text-wine">
        ← Back to the post
      </Link>
      <h1 className="mt-1 font-display text-3xl">Edit post</h1>
      <div className="mt-6">
        <PublishForm projectId={post.project_id} post={post} />
      </div>
    </div>
  );
}

/** The Publish page inside a design (/projects/[id]/publish). */
export function PublishPage({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
      <h2 className="font-display text-2xl">Publish this design</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Choose what to share, write a caption and decide who can see it. You can save it as a draft and publish later.</p>
      <div className="mt-6">
        <PublishForm projectId={projectId} />
      </div>
    </div>
  );
}
