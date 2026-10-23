"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, api } from "@/lib/api";
import type { PersonListItem, PersonSummary } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useMyProfile } from "./MyProfile";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

/** One person in a list: picture, name, @username, and an action on the right. */
export function PersonRow({ person, action }: { person: PersonSummary; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar person={person} size="sm" />
      <Link href={`/u/${person.username}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium hover:text-wine">
          {person.display_name || person.username} <VerifiedBadge person={person} />
        </span>
        <span className="block truncate text-xs text-muted">@{person.username}</span>
      </Link>
      {action}
    </li>
  );
}

export function PeopleLoading() {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
      <Spinner /> Loading…
    </p>
  );
}

/** /u/<username>/followers and /u/<username>/following */
export function PeopleListView({ username, kind }: { username: string; kind: "followers" | "following" }) {
  const { profile: me } = useMyProfile();
  const { confirm, dialog } = useConfirm();
  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = me?.username === username;

  const load = useCallback(
    async (offset: number) => {
      setError(null);
      try {
        const page = kind === "followers" ? await api.followers(username, offset) : await api.following(username, offset);
        setPeople((prev) => (offset && prev ? [...prev, ...page.people] : page.people));
        setNext(page.next_offset);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) setIsPrivate(true);
        setError(e instanceof Error ? e.message : "Could not load the list.");
        setPeople((prev) => prev ?? []);
      }
    },
    [kind, username],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first page when the list opens
    void load(0);
  }, [load]);

  async function act(person: PersonListItem) {
    const at = `@${person.username}`;
    const ok = await confirm(
      kind === "followers"
        ? { title: `Remove ${at} as a follower?`, message: "They are not told. They can follow you again (or send a request if your account is private).", confirmLabel: "Remove", danger: true }
        : { title: `Unfollow ${at}?`, message: "You can follow them again any time.", confirmLabel: "Unfollow", danger: true },
    );
    if (!ok) return;
    setBusy(person.username);
    setError(null);
    try {
      if (kind === "followers") await api.removeFollower(person.username);
      else await api.follow(person.username, false);
      setPeople((list) => (list ?? []).filter((p) => p.username !== person.username));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const title = kind === "followers" ? "Followers" : "Following";
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      {dialog}
      <Link href={`/u/${username}`} className="text-xs text-muted hover:text-wine">
        ← @{username}
      </Link>
      <h1 className="mt-1 font-display text-3xl">{title}</h1>
      {isPrivate ? (
        <div className="mt-6">
          <EmptyState title="This account is private">Follow it to see who it follows and who follows it.</EmptyState>
        </div>
      ) : (
        <>
          {error && (
            <div className="mt-4">
              <Notice tone="err" action={<Button size="sm" onClick={() => load(people?.length ? (next ?? 0) : 0)}>Try again</Button>}>
                {error}
              </Notice>
            </div>
          )}
          {people === null ? (
            <PeopleLoading />
          ) : people.length === 0 && !error ? (
            <div className="mt-6">
              <EmptyState title={kind === "followers" ? "No followers yet" : "Not following anyone yet"}>
                {kind === "followers" ? "When people follow this account they show up here." : "People this account follows show up here."}
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface shadow-card px-4">
              {people.map((p) => (
                <PersonRow
                  key={p.user_id}
                  person={p}
                  action={
                    mine ? (
                      <Button size="sm" variant={kind === "followers" ? "ghost" : "secondary"} loading={busy === p.username} onClick={() => act(p)}>
                        {kind === "followers" ? "Remove" : "Following"}
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          )}
          {next !== null && !error && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => load(next)}>Load more</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** /requests: follow requests waiting for you (private accounts). */
export function FollowRequestsView() {
  const { profile } = useMyProfile();
  const [requests, setRequests] = useState<PersonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await api.followRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load requests.");
      setRequests((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once when the page opens
    void load();
  }, [load]);

  async function answer(username: string, accept: boolean) {
    setBusy(`${username}-${accept}`);
    setError(null);
    try {
      setRequests(await api.answerRequest(username, accept));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">Follow requests</h1>
      <p className="mt-1 text-sm text-muted">People who asked to follow your private account. Accept to let them see your posts; decline and they are not told.</p>
      {profile && !profile.is_private && (
        <div className="mt-4">
          <Notice title="Your account is public" action={<Link href="/settings/privacy" className="text-sm text-wine hover:underline">Privacy & safety</Link>}>
            Anyone can follow you without asking. Turn on Private account to get requests.
          </Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="err" action={<Button size="sm" onClick={load}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {requests === null ? (
        <PeopleLoading />
      ) : requests.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No requests waiting">When someone asks to follow you, they show up here.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface shadow-card px-4">
          {requests.map((p) => (
            <PersonRow
              key={p.user_id}
              person={p}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" loading={busy === `${p.username}-true`} disabled={busy !== null} onClick={() => answer(p.username, true)}>
                    Accept
                  </Button>
                  <Button size="sm" loading={busy === `${p.username}-false`} disabled={busy !== null} onClick={() => answer(p.username, false)}>
                    Decline
                  </Button>
                </div>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
