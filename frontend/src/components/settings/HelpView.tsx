"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import type { ProblemCategory } from "@/lib/types";
import { SettingsCard } from "./AccountSettings";
import { SettingsHeader } from "./SettingsHome";

// Set NEXT_PUBLIC_SUPPORT_EMAIL (frontend/.env.local or Vercel) to show a support address.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";
const MAX_SCREENSHOT_MB = 5;

const FAQ: { q: string; a: string }[] = [
  { q: "Is Drapeit free?", a: "Yes. Without AI keys every AI tool runs as a free mock (a simple stand-in, always labelled MOCK). Real AI needs API keys and costs a little per use; a daily limit protects you from surprise bills." },
  { q: "Who can see my designs?", a: "Only you. A design becomes visible to others only when you publish it as a post, and you choose who sees each post (Public, Followers, Close Friends or Private). Measurements, budget, notes and reference photos are never published." },
  { q: "How do I make my account private?", a: "Settings → Privacy & safety → Private account. Then only people you accept see your posts." },
  { q: "Someone is bothering me. What can I do?", a: "Open their profile or your chat with them and press ⋯. You can mute, restrict, block or report them. You can also choose who can message, comment on or mention you, and add hidden words." },
  { q: "I deleted a post by mistake.", a: "Settings → Your activity → Recently deleted. Posts wait there for 30 days; press Restore." },
  { q: "How do I download my data or delete my account?", a: "Settings → Account. Download your data as one file. Deleting hides the account at once and removes everything after 30 days; sign in within 30 days to cancel." },
  { q: "How do I change how Drapeit looks?", a: "Settings → Theme. Choose Light, Dark, Linen, Cotton or Denim for the app (System follows your phone or computer), and a separate theme for your public profile. Silk, Velvet, Brocade, Khadi, Chiffon and your own custom theme come with Premium, which is coming soon." },
  { q: "I forgot my password.", a: "On the sign-in page press “Forgot password?”. We email you a link to choose a new one." },
  { q: "Why don't my messages appear right away?", a: "They normally appear at once. If your connection is weak, the app checks again every few seconds. Reloading the page always shows the newest messages." },
];

const CATEGORIES: { id: ProblemCategory; label: string }[] = [
  { id: "bug", label: "Something is broken" },
  { id: "account", label: "Account or sign-in" },
  { id: "design_tools", label: "Design tools (notebook, studio, generators)" },
  { id: "social", label: "Posts, comments, messages" },
  { id: "payments", label: "Payments" },
  { id: "other", label: "Something else" },
];

function ReportProblem() {
  const { t } = useT();
  const [category, setCategory] = useState<ProblemCategory>("bug");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (description.trim().length < 5) return setError("Please describe the problem in a few words.");
    if (file && file.size > MAX_SCREENSHOT_MB * 1024 * 1024) return setError(`The screenshot is larger than ${MAX_SCREENSHOT_MB} MB.`);
    setBusy(true);
    setError(null);
    try {
      await api.reportProblem(
        { category, description: description.trim(), page: document.referrer ? new URL(document.referrer).pathname : "", browser: navigator.userAgent.slice(0, 300) },
        file,
      );
      setSent(true);
      setDescription("");
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="report" icon="flag" title={t("settings.reportProblem")}>
      {sent ? (
        <div className="mt-2">
          <Notice tone="ok" title="Thank you, your report is saved">
            We read every report. If we need more details we will contact you at your account email.
          </Notice>
          <Button className="mt-3" size="sm" onClick={() => setSent(false)}>
            Report another problem
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-3">
          <div>
            <label htmlFor="problem-category" className={labelClass}>
              What is it about?
            </label>
            <select id="problem-category" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as ProblemCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="problem-text" className={labelClass}>
              What happened? What did you expect? ({description.length}/2000)
            </label>
            <textarea id="problem-text" className={`${inputClass} min-h-28`} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="problem-shot" className={labelClass}>
              Screenshot (optional, PNG / JPEG / WebP, up to {MAX_SCREENSHOT_MB} MB)
            </label>
            <input
              id="problem-shot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-sunken"
            />
          </div>
          {error && <Notice tone="err">{error}</Notice>}
          <Button type="submit" variant="primary" loading={busy}>
            {t("common.send")}
          </Button>
        </form>
      )}
    </SettingsCard>
  );
}

/** /help: questions and answers, Report a problem, contact. */
export function HelpView() {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.help")} />
      <SettingsCard id="faq" icon="comment" title={t("settings.faq")}>
        <div className="mt-2 divide-y divide-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                {f.q}
                <span aria-hidden className="text-faint transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-1.5 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </SettingsCard>
      <ReportProblem />
      <SettingsCard id="contact" icon="send" title={t("settings.contact")}>
        {SUPPORT_EMAIL ? (
          <p className="mt-0.5 text-sm text-muted">
            Write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-wine hover:underline">
              {SUPPORT_EMAIL}
            </a>
            . Please never send your password.
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-muted">Use “Report a problem” above; it reaches the team directly.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          Also see the{" "}
          <Link href="/legal/guidelines" className="hover:text-wine hover:underline">
            Community Guidelines
          </Link>
          ,{" "}
          <Link href="/legal/terms" className="hover:text-wine hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="hover:text-wine hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </SettingsCard>
    </div>
  );
}
