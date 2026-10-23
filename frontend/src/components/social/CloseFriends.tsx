"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import type { PersonSummary } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useMyProfile } from "./MyProfile";

function Person({ person, action }: { person: PersonSummary; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar person={person} size="sm" />
      <Link href={`/u/${person.username}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium hover:text-wine">{person.display_name || person.username}</span>
        <span className="block truncate text-xs text-muted">@{person.username}</span>
      </Link>
      {action}
    </li>
  );
}

export function CloseFriendsManager() {
  const { profile } = useMyProfile();
  const [friends, setFriends] = useState<PersonSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .closeFriends()
      .then(setFriends)
      .catch((e: Error) => {
        setFriends([]);
        setError(e.message);
      });
  }, []);

  // Search a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      api
        .searchPeople(q)
        .then((r) => !cancelled && setResults(r))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function change(username: string, add: boolean) {
    setBusy(username);
    setError(null);
    try {
      setFriends(add ? await api.addCloseFriend(username) : await api.removeCloseFriend(username));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const onList = new Set((friends ?? []).map((f) => f.username));
  const shownResults = query.trim().length >= 2 ? results : [];
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">Close Friends</h1>
      <p className="mt-1 text-sm text-muted">Posts shared with “Close Friends” are shown only to these people. Nobody is told when you add or remove them.</p>
      {profile === null && (
        <div className="mt-4">
          <Notice tone="warn" title="Set up your profile first" action={<Link href="/profile/edit" className="text-sm text-wine hover:underline">Set up profile</Link>}>
            You need a username before you can share posts.
          </Notice>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-line bg-surface shadow-card p-4">
        <label htmlFor="cf-search" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Add people
        </label>
        <div className="mt-2 flex items-center gap-2">
          <Icon name="search" className="h-4 w-4 text-muted" />
          <input id="cf-search" className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by username or name" maxLength={60} autoComplete="off" />
          {searching && <Spinner />}
        </div>
        {query.trim().length >= 2 && !searching && shownResults.length === 0 && <p className="mt-3 text-sm text-faint">Nobody found with that name.</p>}
        <ul className="mt-2 divide-y divide-line">
          {shownResults.map((p) => (
            <Person
              key={p.user_id}
              person={p}
              action={
                onList.has(p.username) ? (
                  <span className="text-xs text-ok">On your list</span>
                ) : (
                  <Button size="sm" onClick={() => change(p.username, true)} loading={busy === p.username}>
                    Add
                  </Button>
                )
              }
            />
          ))}
        </ul>
      </section>

      {error && <div className="mt-4"><Notice tone="err">{error}</Notice></div>}

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Your list{friends ? ` (${friends.length})` : ""}</h2>
        {friends === null ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Loading…
          </p>
        ) : friends.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="Your Close Friends list is empty">Search above to add people. Only you can see this list.</EmptyState>
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface shadow-card px-4">
            {friends.map((f) => (
              <Person
                key={f.user_id}
                person={f}
                action={
                  <Button size="sm" variant="ghost" onClick={() => change(f.username, false)} loading={busy === f.username}>
                    Remove
                  </Button>
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
