"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { cleanUsername, ROLES, usernameProblem } from "@/lib/social";
import type { Profile, Role } from "@/lib/types";
import { Avatar } from "./Avatar";
import { useMyProfile } from "./MyProfile";

function Form({ existing }: { existing: Profile | null }) {
  const router = useRouter();
  const { setProfile } = useMyProfile();
  const [username, setUsername] = useState(existing?.username ?? "");
  const [displayName, setDisplayName] = useState(existing?.display_name ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [role, setRole] = useState<Role>(existing?.role ?? "designer");
  const [saved, setSaved] = useState<Profile | null>(existing);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameProblem = username ? usernameProblem(username) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = usernameProblem(username);
    if (problem) return setError(`Username: ${problem}`);
    setBusy(true);
    setError(null);
    try {
      const profile = await api.saveProfile({ username: cleanUsername(username), display_name: displayName.trim(), bio: bio.trim(), role });
      setProfile(profile);
      setSaved(profile);
      router.push(`/u/${profile.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setError(null);
    setNotice(null);
    try {
      const profile = await api.uploadAvatar(file, file.name);
      setProfile(profile);
      setSaved(profile);
      setNotice("Profile picture updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the picture.");
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5 rounded-lg border border-line bg-surface shadow-card p-5">
      <div className="flex items-center gap-4">
        {saved ? <Avatar person={saved} size="lg" /> : <span className="h-20 w-20 rounded-full bg-sunken" aria-hidden />}
        <div>
          <p className="text-sm font-medium">Profile picture</p>
          {saved ? (
            <>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="avatar-file" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
              <label htmlFor="avatar-file" className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-sunken">
                {avatarBusy && <Spinner className="h-3.5 w-3.5" />} Upload a picture
              </label>
              <p className="mt-1 text-xs text-muted">PNG, JPEG or WebP, up to 5 MB.</p>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted">Save your username first, then add a picture.</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="p-username" className={labelClass}>
          Username (your address: /u/username)
        </label>
        <div className="flex items-center rounded-md border border-line-strong bg-surface focus-within:border-wine focus-within:ring-2 focus-within:ring-wine/15">
          <span className="pl-3 text-sm text-muted">@</span>
          <input id="p-username" required className="w-full bg-transparent px-1 py-2 text-sm outline-none" value={username} onChange={(e) => setUsername(cleanUsername(e.target.value))} maxLength={30} autoComplete="username" />
        </div>
        <p className={`mt-1 text-xs ${nameProblem ? "text-err" : "text-muted"}`}>{nameProblem ?? "3–30 characters: lowercase letters, numbers, dots, underscores."}</p>
      </div>
      <div>
        <label htmlFor="p-name" className={labelClass}>
          Display name
        </label>
        <input id="p-name" className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="e.g. Vistas Atelier" />
      </div>
      <div>
        <label htmlFor="p-role" className={labelClass}>
          I am a…
        </label>
        <select id="p-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="p-bio" className={labelClass}>
          Bio ({bio.length}/300)
        </label>
        <textarea id="p-bio" className={`${inputClass} min-h-20`} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} placeholder="What you make, where you are…" />
      </div>
      <p className="text-xs text-muted">Your profile is visible to everyone with a Drapeit account. Your designs stay private until you publish them.</p>
      {error && <Notice tone="err">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        {saved && (
          <Link href={`/u/${saved.username}`} className="rounded-md px-3 py-2 text-sm text-muted hover:text-wine">
            Cancel
          </Link>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          {existing ? "Save profile" : "Create profile"}
        </Button>
      </div>
    </form>
  );
}

export function ProfileEditor() {
  const { profile } = useMyProfile();
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">{profile ? "Edit profile" : "Set up your profile"}</h1>
      <p className="mt-1 text-sm text-muted">{profile ? "Change how you appear to other people." : "Choose a username so you can publish designs and follow people."}</p>
      {profile === undefined ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading…
        </p>
      ) : (
        <Form key={profile?.username ?? "new"} existing={profile} />
      )}
    </div>
  );
}
