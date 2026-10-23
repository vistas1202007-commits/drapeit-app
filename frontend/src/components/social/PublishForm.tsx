/* eslint-disable @next/next/no-img-element -- design pictures are served by our own API */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { VISIBILITY } from "@/lib/social";
import type { Post, PostTags, PublishOptions, Visibility } from "@/lib/types";
import { useMyProfile } from "./MyProfile";
import { PostImages } from "./PostCard";

const NEVER_SHARED = "Never shared: measurements, budget, notes, notes for the tailor, reference photos, the design's name and your idea text.";

/** Pick pictures (in order), and whether to show colours and fabric. */
function ContentPicker({ options, selected, setSelected, showPalette, setShowPalette, showFabric, setShowFabric }: {
  options: PublishOptions;
  selected: string[];
  setSelected: (ids: string[]) => void;
  showPalette: boolean;
  setShowPalette: (v: boolean) => void;
  showFabric: boolean;
  setShowFabric: (v: boolean) => void;
}) {
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, 10));
  return (
    <div className="space-y-4">
      <div>
        <p className={labelClass}>Pictures ({selected.length} chosen; the first is the cover)</p>
        {options.images.length === 0 ? (
          <Notice tone="warn">This design has no sketches or generated pictures yet. Generate a sketch in the Notebook, or save a drawing from the Design Studio.</Notice>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {options.images.map((img) => {
              const n = selected.indexOf(img.asset_id);
              return (
                <li key={img.asset_id}>
                  <button
                    type="button"
                    onClick={() => toggle(img.asset_id)}
                    aria-pressed={n >= 0}
                    className={`relative block w-full overflow-hidden rounded-md border-2 bg-canvas text-left ${n >= 0 ? "border-wine" : "border-line hover:border-line-strong"}`}
                  >
                    <img src={api.assetUrl(img.asset_id)} alt={img.label} className="aspect-[3/4] w-full object-cover" />
                    {n >= 0 && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-wine text-xs font-medium text-on-wine">{n + 1}</span>}
                    <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{img.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`flex cursor-pointer gap-2 rounded-md border p-3 text-sm ${showPalette ? "border-wine bg-wine-soft" : "border-line"}`}>
          <input type="checkbox" className="mt-0.5 accent-wine" checked={showPalette} onChange={(e) => setShowPalette(e.target.checked)} />
          <span>
            Show colour palette
            <span className="mt-1 flex gap-1">
              {options.palette.length === 0 ? <span className="text-xs text-faint">No colours in this design</span> : options.palette.map((c) => <span key={c.hex + c.name} title={c.name} className="h-4 w-4 rounded-full border border-ink/10" style={{ backgroundColor: c.hex }} />)}
            </span>
          </span>
        </label>
        <label className={`flex cursor-pointer gap-2 rounded-md border p-3 text-sm ${showFabric ? "border-wine bg-wine-soft" : "border-line"}`}>
          <input type="checkbox" className="mt-0.5 accent-wine" checked={showFabric} onChange={(e) => setShowFabric(e.target.checked)} />
          <span>
            Show fabric
            <span className="block text-xs text-muted">{options.fabrics.length ? options.fabrics.map((f) => f.name).join(", ") : "No fabric saved to this design"}</span>
          </span>
        </label>
      </div>
    </div>
  );
}

/** Create a post from a design (projectId), or edit an existing post. */
export function PublishForm({ projectId, post }: { projectId: string | null; post?: Post }) {
  const router = useRouter();
  const { profile } = useMyProfile();
  const editing = Boolean(post);
  const [options, setOptions] = useState<PublishOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rechoose, setRechoose] = useState(!editing);
  const [selected, setSelected] = useState<string[]>([]);
  const [showPalette, setShowPalette] = useState(post ? post.palette.length > 0 : true);
  const [showFabric, setShowFabric] = useState(post ? post.fabrics.length > 0 : true);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [tags, setTags] = useState<PostTags>(post?.tags ?? { garment: "", fabric: "", occasion: "" });
  const [visibility, setVisibility] = useState<Visibility>(post?.visibility ?? "public");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .publishOptions(projectId)
      .then((o) => {
        if (cancelled) return;
        setOptions(o);
        if (!post) {
          setSelected(o.images.slice(0, 1).map((i) => i.asset_id));
          setCaption(o.suggested_caption);
          setTags(o.suggested_tags);
        }
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, post]);

  async function save(status: "draft" | "published" | "keep") {
    setBusy(status);
    setError(null);
    const content = { image_asset_ids: selected, show_palette: showPalette, show_fabric: showFabric };
    try {
      const result = post
        ? await api.updatePost(post.id, {
            caption,
            tags,
            visibility,
            ...(rechoose && projectId ? { content } : {}),
            ...(status === "published" && post.status !== "published" ? { status: "published" as const } : {}),
          })
        : await api.createPost({ project_id: projectId!, status: status === "keep" ? "draft" : status, visibility, caption, tags, content });
      router.push(`/p/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the post.");
      setBusy(null);
    }
  }

  if (profile === null || options?.has_profile === false) {
    return (
      <Notice tone="warn" title="Set up your profile first" action={<Link href="/profile/edit" className="text-sm text-wine hover:underline">Set up profile</Link>}>
        Choose a username so people know who posted. It takes a minute.
      </Notice>
    );
  }
  if (loadError) return <Notice tone="err" title="This design could not be prepared for posting">{loadError}</Notice>;
  if (projectId && !options) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" role="status">
        <Spinner /> Preparing…
      </p>
    );
  }

  const set = (key: keyof PostTags, value: string) => setTags((t) => ({ ...t, [key]: value }));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <section className="rounded-lg border border-line bg-surface shadow-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">What to show</h2>
          <div className="mt-3">
            {editing && !rechoose ? (
              <div className="space-y-3">
                {post && <PostImages post={post} className="max-w-xs rounded-md border border-line" />}
                {projectId ? (
                  <Button size="sm" onClick={() => setRechoose(true)}>
                    Choose pictures, colours or fabric again
                  </Button>
                ) : (
                  <p className="text-xs text-muted">The design this post came from was deleted, so its pictures cannot be changed. Caption, tags and visibility can.</p>
                )}
              </div>
            ) : (
              options && <ContentPicker options={options} selected={selected} setSelected={setSelected} showPalette={showPalette} setShowPalette={setShowPalette} showFabric={showFabric} setShowFabric={setShowFabric} />
            )}
          </div>
          <p className="mt-4 flex gap-2 rounded-md bg-ok-soft px-3 py-2 text-xs text-ok">
            <Icon name="check" className="h-4 w-4 shrink-0" /> {NEVER_SHARED}
          </p>
        </section>

        <section className="space-y-4 rounded-lg border border-line bg-surface shadow-card p-4">
          <div>
            <label htmlFor="post-caption" className={labelClass}>
              Caption ({caption.length}/2200)
            </label>
            <textarea id="post-caption" className={`${inputClass} min-h-28`} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} placeholder="Tell people about this design…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {([["garment", "Garment"], ["fabric", "Fabric"], ["occasion", "Occasion"]] as const).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`tag-${key}`} className={labelClass}>
                  {label} tag
                </label>
                <input id={`tag-${key}`} className={inputClass} value={tags[key]} onChange={(e) => set(key, e.target.value)} maxLength={60} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <fieldset className="rounded-lg border border-line bg-surface shadow-card p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Who can see it</legend>
          <div className="mt-1 space-y-2">
            {VISIBILITY.map((v) => (
              <label key={v.id} className={`flex cursor-pointer gap-2 rounded-md border p-2.5 text-sm ${visibility === v.id ? "border-wine bg-wine-soft" : "border-line"}`}>
                <input type="radio" name="visibility" className="mt-0.5 accent-wine" checked={visibility === v.id} onChange={() => setVisibility(v.id)} />
                <span>
                  <span className="font-medium">{v.label}</span>
                  <span className="block text-xs text-muted">{v.help}</span>
                </span>
              </label>
            ))}
          </div>
          {visibility === "close_friends" && (
            <Link href="/close-friends" className="mt-2 inline-block text-xs text-wine hover:underline">
              Manage your Close Friends list →
            </Link>
          )}
        </fieldset>

        {error && <Notice tone="err">{error}</Notice>}
        <div className="flex flex-col gap-2">
          {editing ? (
            <>
              <Button variant="primary" onClick={() => save("keep")} loading={busy === "keep"} disabled={busy !== null}>
                Save changes
              </Button>
              {post && post.status !== "published" && (
                <Button onClick={() => save("published")} loading={busy === "published"} disabled={busy !== null}>
                  Save and publish
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="primary" onClick={() => save("published")} loading={busy === "published"} disabled={busy !== null}>
                <Icon name="send" /> Publish
              </Button>
              <Button onClick={() => save("draft")} loading={busy === "draft"} disabled={busy !== null}>
                Save as draft
              </Button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
