"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { useMyProfile } from "@/components/social/MyProfile";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { VerificationState } from "@/lib/types";
import { SettingsCard } from "./AccountSettings";
import { SettingsHeader } from "./SettingsHome";

const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "err" } as const;

/** /settings/verification: ask for the verified badge, and see the answer. */
export function VerificationSettings() {
  const { t } = useT();
  const { profile } = useMyProfile();
  const [state, setState] = useState<VerificationState | null>(null);
  const [reason, setReason] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .verification()
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your verification status."));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) return setError("Please write at least a sentence (10 characters).");
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) return setError("The link must start with https:// (or http://).");
    setBusy(true);
    setError(null);
    try {
      setState(await api.requestVerification(reason.trim(), url.trim()));
      setReason("");
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  }

  const latest = state?.latest_request;
  const canAsk = state && !state.verified && latest?.status !== "pending";
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.verification")}>
        The badge <VerifiedBadge person={{ verified: true }} /> next to a name means the Drapeit team checked that the account belongs to the designer, tailor
        or boutique it says it is.
      </SettingsHeader>
      {error && (
        <div className="mt-4">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      {state === null ? (
        !error && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> {t("common.loading")}
          </p>
        )
      ) : (
        <>
          {state.verified && (
            <div className="mt-5">
              <Notice tone="ok" title="Your account is verified">
                The badge shows next to your name on your profile, posts, comments and chats.
              </Notice>
            </div>
          )}
          {latest && (
            <SettingsCard icon="history" title="Your latest request">
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={STATUS_TONE[latest.status]}>{latest.status === "pending" ? "Waiting for review" : latest.status === "approved" ? "Approved" : "Not approved"}</Badge>
                <span className="text-muted">sent {formatDate(latest.created_at)}</span>
              </p>
              <p className="mt-2 whitespace-pre-line text-sm">{latest.reason}</p>
              {latest.portfolio_url && (
                <a href={latest.portfolio_url} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-sm text-wine hover:underline">
                  {latest.portfolio_url}
                </a>
              )}
              {latest.review_note && <p className="mt-2 text-sm text-muted">Note from the team: {latest.review_note}</p>}
            </SettingsCard>
          )}
          {profile === null ? (
            <div className="mt-5">
              <Notice tone="warn" action={<Link href="/profile/edit" className="text-sm text-wine hover:underline">Set up profile</Link>}>
                Set up your profile first.
              </Notice>
            </div>
          ) : (
            canAsk && (
              <SettingsCard icon="check" title={latest?.status === "rejected" ? "Ask again" : "Ask to be verified"}>
                <form onSubmit={submit} className="mt-2 space-y-3">
                  <div>
                    <label htmlFor="verify-reason" className={labelClass}>
                      Who are you, and why should your account be verified? ({reason.length}/1000)
                    </label>
                    <textarea id="verify-reason" className={`${inputClass} min-h-24`} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
                  </div>
                  <div>
                    <label htmlFor="verify-url" className={labelClass}>
                      Portfolio, website or shop link (optional)
                    </label>
                    <input id="verify-url" type="url" className={inputClass} maxLength={300} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
                  </div>
                  <Button type="submit" variant="primary" loading={busy}>
                    {t("common.send")}
                  </Button>
                </form>
              </SettingsCard>
            )
          )}
        </>
      )}
    </div>
  );
}
