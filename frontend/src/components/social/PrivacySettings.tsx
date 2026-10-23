"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { useT } from "@/components/i18n/LanguageProvider";
import { PrivacyExtras } from "@/components/settings/PrivacyExtras";
import { SettingsHeader } from "@/components/settings/SettingsHome";
import { api } from "@/lib/api";
import { MESSAGING_CHOICES } from "@/lib/chat";
import type { AllowMessages, PersonListItem } from "@/lib/types";
import { useMyProfile } from "./MyProfile";
import { PeopleLoading, PersonRow } from "./PeopleList";

type ListKind = "blocked" | "restricted" | "muted";

const LISTS: { kind: ListKind; what: "block" | "restrict" | "mute"; title: string; help: string; undo: string; empty: string }[] = [
  {
    kind: "blocked",
    what: "block",
    title: "Blocked accounts",
    help: "They cannot find your profile or see your posts, comments and reposts. You do not follow each other.",
    undo: "Unblock",
    empty: "You have not blocked anyone.",
  },
  {
    kind: "restricted",
    what: "restrict",
    title: "Restricted accounts",
    help: "Their new comments on your posts wait for your approval. Until you approve, only they and you see them.",
    undo: "Unrestrict",
    empty: "You have not restricted anyone.",
  },
  {
    kind: "muted",
    what: "mute",
    title: "Muted accounts",
    help: "Their posts are hidden from your Home Feed and Explore. You still follow them and they are not told.",
    undo: "Unmute",
    empty: "You have not muted anyone.",
  },
];

function SafetyList({ list }: { list: (typeof LISTS)[number] }) {
  const { confirm, dialog } = useConfirm();
  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople(await api.safetyList(list.kind));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the list.");
      setPeople((p) => p ?? []);
    }
  }, [list.kind]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once when the page opens
    void load();
  }, [load]);

  async function undo(username: string) {
    if (list.kind === "blocked") {
      const ok = await confirm({
        title: `Unblock @${username}?`,
        message: "They will be able to find your profile and see your Public posts again. You will not follow each other again automatically.",
        confirmLabel: "Unblock",
      });
      if (!ok) return;
    }
    setBusy(username);
    setError(null);
    try {
      await api.setSafety(username, list.what, false);
      setPeople((p) => (p ?? []).filter((x) => x.username !== username));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface shadow-card p-4">
      {dialog}
      <h2 className="font-display text-lg">
        {list.title}
        {people ? ` (${people.length})` : ""}
      </h2>
      <p className="mt-0.5 text-sm text-muted">{list.help}</p>
      {error && (
        <div className="mt-3">
          <Notice tone="err" action={<Button size="sm" onClick={load}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {people === null ? (
        <PeopleLoading />
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{list.empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {people.map((p) => (
            <PersonRow
              key={p.user_id}
              person={p}
              action={
                <Button size="sm" loading={busy === p.username} onClick={() => undo(p.username)}>
                  {list.undo}
                </Button>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PrivateToggle() {
  const { profile, setProfile } = useMyProfile();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile === undefined) {
    return (
      <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
        <Spinner /> Loading…
      </p>
    );
  }
  if (profile === null) {
    return (
      <div className="mt-6">
        <Notice tone="warn" title="Set up your profile first" action={<Link href="/profile/edit" className="text-sm text-wine hover:underline">Set up profile</Link>}>
          Choose a username to use these settings.
        </Notice>
      </div>
    );
  }

  async function toggle() {
    if (!profile) return;
    const next = !profile.is_private;
    if (!next) {
      const ok = await confirm({
        title: "Make your account public?",
        message: "Everyone with a Drapeit account will see your Public posts, and every follow request waiting now is accepted.",
        confirmLabel: "Make public",
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      setProfile(await api.setPrivacy(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-line bg-surface shadow-card p-4">
      {dialog}
      <div className="flex items-start gap-4">
        <Icon name="lock" className="mt-0.5 h-5 w-5 text-wine" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg">Private account</h2>
          <p className="mt-0.5 text-sm text-muted">
            {profile.is_private
              ? "On. Only people you accept (and your Close Friends) see your posts, reposts and follower lists. New followers send a request."
              : "Off. Everyone with a Drapeit account can see your Public posts and follow you without asking."}
          </p>
          <p className="mt-1 text-xs text-muted">People who already follow you keep following. Your name, picture and bio are always visible.</p>
          {profile.is_private && (
            <Link href="/requests" className="mt-2 inline-block text-sm text-wine hover:underline">
              See follow requests
            </Link>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={profile.is_private}
          aria-label="Private account"
          disabled={busy}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${profile.is_private ? "bg-wine" : "bg-line-strong"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-canvas shadow transition-all ${profile.is_private ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
    </section>
  );
}

/** "Who can message me" (Phase 6C). */
function MessagingChoice() {
  const [value, setValue] = useState<AllowMessages | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .messagingSettings()
      .then((s) => setValue(s.allow_messages_from))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this setting."));
  }, []);

  async function choose(next: AllowMessages) {
    if (next === value) return;
    const before = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      setValue((await api.saveMessagingSettings(next)).allow_messages_from);
    } catch (e) {
      setValue(before);
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="messages" className="mt-6 scroll-mt-20 rounded-lg border border-line bg-surface shadow-card p-4">
      <div className="flex items-start gap-4">
        <Icon name="chat" className="mt-0.5 h-5 w-5 text-wine" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg">Who can message me</h2>
          <p className="mt-0.5 text-sm text-muted">People you follow can always message you. Chats you already accepted keep working.</p>
          {value === null && !error ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
              <Spinner /> Loading…
            </p>
          ) : (
            <fieldset className="mt-3 space-y-1" disabled={busy || value === null}>
              <legend className="sr-only">Who can message me</legend>
              {MESSAGING_CHOICES.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-sunken">
                  <input type="radio" name="allow-messages" value={c.id} checked={value === c.id} onChange={() => choose(c.id)} className="mt-1 accent-wine" />
                  <span>
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted">{c.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
        </div>
      </div>
    </section>
  );
}

/** /settings/privacy: private account, and the blocked / restricted / muted lists. */
export function PrivacySettings() {
  const { profile } = useMyProfile();
  const { t } = useT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.privacy")}>
        Choose who sees your posts, and manage people you blocked, restricted or muted. Nobody is told when you change these.
      </SettingsHeader>
      <PrivateToggle />
      {profile && <MessagingChoice />}
      {profile && <PrivacyExtras />}
      <div id="blocked" className="scroll-mt-20">
        {profile && LISTS.map((l) => <SafetyList key={l.kind} list={l} />)}
      </div>
      <p className="mt-6 text-xs text-muted">
        To block, restrict, mute or report someone, open their profile (or your chat with them) and press the <span className="font-medium">⋯</span> button. Reports are kept for review.
      </p>
      <p className="mt-2 text-xs text-muted">
        Choose which notifications you get in{" "}
        <Link href="/settings/notifications" className="text-wine hover:underline">
          Notification settings
        </Link>
        .
      </p>
    </div>
  );
}
