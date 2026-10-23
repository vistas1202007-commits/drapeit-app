/* eslint-disable @next/next/no-img-element -- pictures are served by our own API */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/social/Avatar";
import { Button, buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import type { PersonSummary, Post, PublishOptions, SendResult } from "@/lib/types";

/** A dialog box with a title and a close button. Closes on Escape. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        ref.current?.close();
        onClose();
      }}
      className="m-auto w-[min(94vw,480px)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-display text-lg">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            ref.current?.close();
            onClose();
          }}
          className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

/** Search for people (or pick from your recent chats) and tick one or more. */
function PeoplePicker({ selected, onToggle, max }: { selected: PersonSummary[]; onToggle: (p: PersonSummary) => void; max: number }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSummary[] | null>(null);
  const [recent, setRecent] = useState<PersonSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .chats("inbox")
      .then((list) => setRecent(list.chats.flatMap((c) => (c.other ? [c.other] : [])).slice(0, 8)))
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.replace(/^@/, "").length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear old results when the box is emptied
      setResults(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .searchPeople(q)
        .then((people) => {
          setResults(people);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Search failed."));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const list = results ?? recent;
  const chosen = new Set(selected.map((p) => p.user_id));
  return (
    <div>
      <label htmlFor="people-search" className={labelClass}>
        To
      </label>
      <input id="people-search" className={inputClass} placeholder="Search by name or @username" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      {selected.length > 0 && max > 1 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen people">
          {selected.map((p) => (
            <li key={p.user_id}>
              <button type="button" onClick={() => onToggle(p)} className="flex items-center gap-1 rounded-full bg-wine-soft py-0.5 pl-2.5 pr-1.5 text-xs text-wine hover:bg-wine/15" aria-label={`Remove @${p.username}`}>
                @{p.username}
                <Icon name="close" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-faint">{results ? "Results" : "Recent chats"}</p>
      {list === null ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="mt-2 text-sm text-faint">{results ? "Nobody found. Check the spelling." : "Search for someone to start."}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {list.map((p) => {
            const on = chosen.has(p.user_id);
            const full = !on && selected.length >= max && max > 1;
            return (
              <li key={p.user_id}>
                <button type="button" disabled={full} onClick={() => onToggle(p)} aria-pressed={on} className="flex w-full items-center gap-3 py-2 text-left disabled:opacity-40">
                  <Avatar person={p} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.display_name || p.username}</span>
                    <span className="block truncate text-xs text-muted">@{p.username}</span>
                  </span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${on ? "border-wine bg-wine text-on-wine" : "border-line-strong"}`}>
                    {on && <Icon name="check" className="h-3.5 w-3.5" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "New message": choose one person and open the chat with them. */
export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(person: PersonSummary) {
    setBusy(true);
    setError(null);
    try {
      const chat = await api.startChat(person.username);
      onClose();
      router.push(`/messages/${chat.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the chat.");
      setBusy(false);
    }
  }

  return (
    <Modal title="New message" onClose={onClose}>
      {error && (
        <div className="mb-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Opening chat…
        </p>
      ) : (
        <PeoplePicker selected={[]} onToggle={open} max={1} />
      )}
    </Modal>
  );
}

/** Send a post to up to 10 people (each gets it in their chat with you). */
export function SendPostDialog({ post, onClose }: { post: Post; onClose: () => void }) {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[] | null>(null);

  function toggle(p: PersonSummary) {
    setPeople((list) => (list.some((x) => x.user_id === p.user_id) ? list.filter((x) => x.user_id !== p.user_id) : [...list, p]));
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      setResults(await api.sendPost(post.id, people.map((p) => p.username), note.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    return (
      <Modal title="Sent" onClose={onClose}>
        <ul className="space-y-2 text-sm">
          {results.map((r) => (
            <li key={r.username} className="flex items-start gap-2">
              <Icon name={r.ok ? "check" : "close"} className={`mt-0.5 h-4 w-4 shrink-0 ${r.ok ? "text-ok" : "text-err"}`} />
              <span className="min-w-0">
                {r.ok ? (
                  <>
                    Sent to{" "}
                    <Link href={`/messages/${r.conversation_id}`} className="font-medium text-wine hover:underline">
                      @{r.username}
                    </Link>
                  </>
                ) : (
                  <>
                    Not sent to <span className="font-medium">@{r.username}</span>: <span className="text-muted">{r.error}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onClose} autoFocus>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Send post" onClose={onClose}>
      <PeoplePicker selected={people} onToggle={toggle} max={10} />
      <label htmlFor="send-note" className={`${labelClass} mt-4`}>
        Message (optional)
      </label>
      <textarea id="send-note" className={`${inputClass} min-h-16`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Say something about it…" />
      <p className="mt-2 text-xs text-muted">People only see the post if they are allowed to (for example, Followers-only posts stay hidden from others).</p>
      {error && (
        <div className="mt-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={send} loading={busy} disabled={people.length === 0}>
          <Icon name="send" />
          Send{people.length > 1 ? ` to ${people.length}` : ""}
        </Button>
      </div>
    </Modal>
  );
}

/** Send one sketch or generated picture of your design to one person. */
export function SendDesignDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [images, setImages] = useState<PublishOptions["images"] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ chatId: string; username: string } | null>(null);

  useEffect(() => {
    api
      .publishOptions(projectId)
      .then((o) => {
        setImages(o.images);
        setPicked(o.images[0]?.asset_id ?? null);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load the pictures.");
        setImages([]);
      });
  }, [projectId]);

  async function send() {
    if (!picked || !person) return;
    setBusy(true);
    setError(null);
    try {
      const chat = await api.startChat(person.username);
      await api.sendDesign(chat.id, projectId, picked, note.trim());
      setSentTo({ chatId: chat.id, username: person.username });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <Modal title="Design sent" onClose={onClose}>
        <p className="text-sm text-muted">
          A copy of the picture is in your chat with <span className="font-medium text-ink">@{sentTo.username}</span>. Your design itself stays private.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Link href={`/messages/${sentTo.chatId}`} className={buttonClass("primary")}>
            Open chat
          </Link>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Send design in a chat" onClose={onClose}>
      <p className="text-sm text-muted">Only the picture you choose is sent, as a copy. Measurements, notes, the design&apos;s name and reference photos are never sent.</p>
      <p className={`${labelClass} mt-4`}>Picture</p>
      {images === null ? (
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading pictures…
        </p>
      ) : images.length === 0 ? (
        <Notice tone="warn">This design has no sketch or generated picture yet. Draw one in Design Studio or press Generate Sketch first.</Notice>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <li key={img.asset_id}>
              <button
                type="button"
                onClick={() => setPicked(img.asset_id)}
                aria-pressed={picked === img.asset_id}
                className={`block w-full overflow-hidden rounded-md border-2 bg-surface ${picked === img.asset_id ? "border-wine" : "border-transparent hover:border-line-strong"}`}
              >
                <img src={api.assetUrl(img.asset_id)} alt={img.label} className="aspect-square w-full bg-canvas object-contain" />
                <span className="block truncate px-1 py-0.5 text-[11px] text-muted">{img.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {images && images.length > 0 && (
        <>
          <div className="mt-4">
            {person ? (
              <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                <Avatar person={person} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  To <span className="font-medium">@{person.username}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPerson(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <PeoplePicker selected={[]} onToggle={setPerson} max={1} />
            )}
          </div>
          <label htmlFor="design-note" className={`${labelClass} mt-4`}>
            Message (optional)
          </label>
          <textarea id="design-note" className={`${inputClass} min-h-16`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={send} loading={busy} disabled={!picked || !person}>
          <Icon name="send" />
          Send
        </Button>
      </div>
    </Modal>
  );
}
