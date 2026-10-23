"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { followLabel, ROLE_LABEL } from "@/lib/social";
import { resolveTheme, themeStyle } from "@/lib/themes";
import type { PostStatus, ProfileDetail } from "@/lib/types";
import { Avatar } from "./Avatar";
import { MoreMenu, type MenuItem } from "./MoreMenu";
import { LoadingPosts, LoadMore, PostColumn, PostGrid, usePostPages } from "./PostList";
import { useReport } from "./ReportDialog";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

type Tab = PostStatus | "reposts";

function PublishedGrid({ username, isMe }: { username: string; isMe: boolean }) {
  const load = useCallback((cursor: string | null) => api.profilePosts(username, cursor), [username]);
  const list = usePostPages(load);
  if (list.posts === null) return <LoadingPosts />;
  const all = [...list.pinned, ...list.posts];
  return (
    <div className="space-y-4">
      {all.length === 0 && !list.error && (
        <EmptyState
          title={isMe ? "You have not published anything yet" : "No posts to show"}
          action={isMe ? <Link href="/" className="text-sm text-wine hover:underline">Open a design and press Publish</Link> : undefined}
        >
          {isMe ? "Your published designs will appear here." : "Posts only show here when you are allowed to see them."}
        </EmptyState>
      )}
      {all.length > 0 && <PostGrid posts={all} />}
      <LoadMore list={list} />
    </div>
  );
}

function MyPostsGrid({ status }: { status: PostStatus }) {
  const load = useCallback((cursor: string | null) => api.myPosts(status, cursor), [status]);
  const list = usePostPages(load);
  if (list.posts === null) return <LoadingPosts />;
  return (
    <div className="space-y-4">
      {list.posts.length === 0 && !list.error && (
        <EmptyState title={status === "draft" ? "No drafts" : "Nothing archived"}>
          {status === "draft" ? "Posts you save as a draft wait here until you publish them." : "Archived posts are hidden from everyone but you. Publish them again any time."}
        </EmptyState>
      )}
      {list.posts.length > 0 && <PostGrid posts={list.posts} />}
      <LoadMore list={list} />
    </div>
  );
}

function RepostsColumn({ username, isMe }: { username: string; isMe: boolean }) {
  const load = useCallback((cursor: string | null) => api.profileReposts(username, cursor), [username]);
  return (
    <div className="mx-auto max-w-xl">
      <PostColumn
        load={load}
        empty={
          <EmptyState title="No reposts yet">
            {isMe ? "Press Repost under someone's Public post to share it here. The designer always keeps the credit." : "Designs this person reposts show up here."}
          </EmptyState>
        }
      />
    </div>
  );
}

/** Follow / Requested / Following, plus the ⋯ menu with restrict, mute, block and report. */
function ProfileActions({ profile, onChange }: { profile: ProfileDetail; onChange: (p: ProfileDetail) => void }) {
  const { confirm, dialog } = useConfirm();
  const { report, dialog: reportDialog } = useReport();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const at = `@${profile.username}`;

  async function run(action: () => Promise<ProfileDetail>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFollow() {
    if (profile.follow_status === "following") {
      const ok = await confirm({
        title: `Unfollow ${at}?`,
        message: profile.is_private ? "Their account is private: to see their posts again you will have to send a new request." : "You can follow them again any time.",
        confirmLabel: "Unfollow",
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => api.follow(profile.username, profile.follow_status === "none"));
  }

  async function message() {
    setBusy(true);
    setError(null);
    try {
      const chat = await api.startChat(profile.username);
      router.push(`/messages/${chat.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the chat.");
      setBusy(false);
    }
  }

  async function block() {
    if (profile.blocked_by_me) return run(() => api.setSafety(profile.username, "block", false));
    const ok = await confirm({
      title: `Block ${at}?`,
      message: "They will not be able to find your profile or see your posts, comments and reposts, and you stop following each other. They are not told.",
      confirmLabel: "Block",
      danger: true,
    });
    if (ok) await run(() => api.setSafety(profile.username, "block", true));
  }

  const items: MenuItem[] = [
    {
      label: profile.restricted_by_me ? "Unrestrict" : "Restrict",
      icon: "shield",
      onSelect: () => run(() => api.setSafety(profile.username, "restrict", !profile.restricted_by_me)),
    },
    { label: profile.muted_by_me ? "Unmute" : "Mute", icon: "mute", onSelect: () => run(() => api.setSafety(profile.username, "mute", !profile.muted_by_me)) },
    { label: profile.blocked_by_me ? "Unblock" : "Block", icon: "ban", danger: !profile.blocked_by_me, onSelect: block },
    { label: "Report account", icon: "flag", danger: true, onSelect: () => report({ type: "user", id: profile.username, name: at }) },
  ];

  return (
    <>
      {dialog}
      {reportDialog}
      <div className="flex flex-wrap items-center gap-2">
        {profile.blocked_by_me ? (
          <Button size="sm" onClick={block} loading={busy}>
            Unblock
          </Button>
        ) : (
          <Button size="sm" variant={profile.follow_status === "none" ? "primary" : "secondary"} onClick={toggleFollow} loading={busy}>
            {followLabel(profile.follow_status, profile.is_private)}
          </Button>
        )}
        {profile.can_message && (
          <Button size="sm" onClick={message} disabled={busy}>
            <Icon name="chat" />
            Message
          </Button>
        )}
        {profile.follow_status === "requested" && <span className="text-xs text-muted">Waiting for them to accept. Press again to cancel.</span>}
        {profile.follows_me && <Badge>Follows you</Badge>}
        {profile.is_close_friend && <Badge tone="ok">On your Close Friends</Badge>}
        {profile.restricted_by_me && <Badge tone="warn">Restricted</Badge>}
        {profile.muted_by_me && <Badge>Muted</Badge>}
        <MoreMenu label={`More actions for ${at}`} items={items} />
      </div>
      {profile.restricted_by_me && <p className="mt-2 text-xs text-muted">Their new comments on your posts wait for your approval. Only they and you can see them until then.</p>}
      {profile.muted_by_me && <p className="mt-2 text-xs text-muted">Their posts are hidden from your Home Feed and Explore. You still follow them.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-err">{error}</p>}
    </>
  );
}

/** Everyone sees a profile in its owner's profile theme ("Default" = the visitor's own app theme). */
function ProfileThemeScope({ appearance, children }: { appearance: ProfileDetail["appearance"] | undefined; children: ReactNode }) {
  const look = appearance ? resolveTheme(appearance.profile_theme, appearance.custom_theme, appearance.is_premium) : null;
  return (
    <div className={`min-h-screen ${look ? "theme-scope" : ""}`} style={look ? themeStyle(look) : undefined} data-profile-theme={look?.id ?? "default"}>
      {children}
    </div>
  );
}

export function ProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("published");

  useEffect(() => {
    let cancelled = false;
    api
      .profile(username)
      .then((p) => !cancelled && setProfile(p))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (error && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <Notice tone="err" title="This profile could not be opened" action={<Link href="/feed" className={buttonClass("secondary", "sm")}>Home Feed</Link>}>
          {error.startsWith("Profile not found") ? `There is no profile called @${username}.` : error}
        </Notice>
      </div>
    );
  }
  if (!profile) {
    return (
      <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted" role="status">
        <Spinner /> Opening profile…
      </p>
    );
  }

  const tabs: [Tab, string][] = profile.is_me
    ? [["published", "Posts"], ["reposts", "Reposts"], ["draft", "Drafts"], ["archived", "Archived"]]
    : [["published", "Posts"], ["reposts", "Reposts"]];
  const listLink = (what: "followers" | "following", count: number, word: string) => {
    const text = (
      <>
        <span className="font-medium">{count}</span> <span className="text-muted">{word}</span>
      </>
    );
    return profile.can_see_posts ? (
      <Link href={`/u/${profile.username}/${what}`} className="hover:text-wine">
        {text}
      </Link>
    ) : (
      text
    );
  };

  return (
    <ProfileThemeScope appearance={profile.appearance}>
      <div className="mx-auto max-w-3xl px-4 pb-6 sm:px-8 sm:pt-6">
        <div aria-hidden className="cover-banner -mx-4 h-32 sm:mx-0 sm:h-44 sm:rounded-2xl sm:shadow-card" />
        <header className="flex animate-rise flex-col gap-4 px-1 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
          <span className="-mt-10 w-fit shrink-0 rounded-full border-4 border-paper bg-paper shadow-md sm:-mt-14">
            <Avatar person={profile} size="lg" />
          </span>
          <div className="min-w-0 flex-1 sm:pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="flex items-center gap-1.5 font-display text-3xl leading-tight">
                {profile.display_name || profile.username}
                <VerifiedBadge person={profile} className="h-5 w-5" />
              </h1>
              <Badge tone="wine">{ROLE_LABEL[profile.role]}</Badge>
              {profile.appearance?.is_premium && (
                <Badge tone="gold" title="Premium member">
                  Premium
                </Badge>
              )}
              {profile.is_private && (
                <span className="flex items-center gap-1 text-xs text-muted" title="Private account">
                  <Icon name="lock" className="h-3.5 w-3.5" /> Private
                </span>
              )}
            </div>
            <p className="text-sm text-muted">@{profile.username}</p>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <li>
                <span className="font-medium">{profile.post_count}</span> <span className="text-muted">{profile.post_count === 1 ? "post" : "posts"}</span>
              </li>
              <li>{listLink("followers", profile.follower_count, profile.follower_count === 1 ? "follower" : "followers")}</li>
              <li>{listLink("following", profile.following_count, "following")}</li>
            </ul>
            {profile.bio && <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed">{profile.bio}</p>}
            <div className="mt-4">
              {profile.is_me ? (
                <div className="flex flex-wrap gap-2">
                  <Link href="/profile/edit" className={buttonClass("secondary", "sm")}>
                    Edit profile
                  </Link>
                  <Link href="/close-friends" className={buttonClass("secondary", "sm")}>
                    Close Friends
                  </Link>
                  {(profile.is_private || profile.request_count > 0) && (
                    <Link href="/requests" className={buttonClass(profile.request_count > 0 ? "primary" : "secondary", "sm")}>
                      Follow requests{profile.request_count > 0 ? ` (${profile.request_count})` : ""}
                    </Link>
                  )}
                  <Link href="/settings/privacy" className={buttonClass("ghost", "sm")}>
                    <Icon name="shield" className="h-3.5 w-3.5" /> Privacy & safety
                  </Link>
                  <Link href="/settings/theme#profile" className={buttonClass("ghost", "sm")}>
                    <Icon name="palette" className="h-3.5 w-3.5" /> Profile theme
                  </Link>
                </div>
              ) : (
                <ProfileActions profile={profile} onChange={setProfile} />
              )}
            </div>
          </div>
        </header>

        <hr aria-hidden className="stitch-divider mt-8" />
        {!profile.can_see_posts ? (
          <div className="mt-6">
            {profile.blocked_by_me ? (
              <EmptyState title="You blocked this account">Unblock them to see their posts again. They cannot see yours while they are blocked.</EmptyState>
            ) : (
              <EmptyState title="This account is private">
                {profile.follow_status === "requested" ? "Your follow request is waiting. You will see their posts once they accept." : "Follow this account to see its posts and followers."}
              </EmptyState>
            )}
          </div>
        ) : (
          <>
            <div role="tablist" aria-label="Posts" className="mt-4 flex gap-1 overflow-x-auto border-b border-line sm:justify-center">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`shrink-0 border-b-2 px-4 pb-2.5 text-xs uppercase tracking-[0.14em] ${tab === id ? "border-wine font-medium text-wine" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4">
              {tab === "published" && <PublishedGrid key={profile.username} username={profile.username} isMe={profile.is_me} />}
              {tab === "reposts" && <RepostsColumn key={profile.username} username={profile.username} isMe={profile.is_me} />}
              {(tab === "draft" || tab === "archived") && profile.is_me && <MyPostsGrid key={tab} status={tab} />}
            </div>
          </>
        )}
      </div>
    </ProfileThemeScope>
  );
}
