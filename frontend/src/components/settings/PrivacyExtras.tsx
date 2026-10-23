"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { cleanWords } from "@/lib/activity";
import type { Audience, PrivacyChoices } from "@/lib/types";
import { SettingsCard } from "./AccountSettings";

const AUDIENCE: { id: Audience; label: string }[] = [
  { id: "everyone", label: "Everyone" },
  { id: "followers", label: "Only people who follow me" },
  { id: "nobody", label: "Nobody" },
];

function AudienceChoice({ name, value, disabled, onChange }: { name: string; value: Audience; disabled: boolean; onChange: (a: Audience) => void }) {
  return (
    <fieldset className="mt-2 space-y-0.5" disabled={disabled}>
      <legend className="sr-only">{name}</legend>
      {AUDIENCE.map((a) => (
        <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken">
          <input type="radio" name={name} checked={value === a.id} onChange={() => onChange(a.id)} className="accent-wine" />
          {a.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Who can comment, who can mention me, and hidden words (Phase 6D), on the Privacy page. */
export function PrivacyExtras() {
  const { t } = useT();
  const [choices, setChoices] = useState<PrivacyChoices | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [word, setWord] = useState("");

  useEffect(() => {
    api
      .privacyChoices()
      .then(setChoices)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load these settings."));
  }, []);

  async function save(next: PrivacyChoices) {
    const before = choices;
    setChoices(next);
    setBusy(true);
    setError(null);
    try {
      setChoices(await api.savePrivacyChoices(next));
      return true;
    } catch (e) {
      setChoices(before);
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addWords(e: FormEvent) {
    e.preventDefault();
    if (!choices) return;
    const added = cleanWords(word).filter((w) => !choices.hidden_words.includes(w));
    if (added.length === 0) return setWord("");
    if (added.some((w) => w.length > 30)) return setError("Each hidden word can be at most 30 characters.");
    if (await save({ ...choices, hidden_words: [...choices.hidden_words, ...added] })) setWord("");
  }

  if (!choices) {
    return (
      <section className="mt-6 rounded-lg border border-line bg-surface shadow-card p-4 text-sm">
        {error ? (
          <p role="alert" className="text-err">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-muted" role="status">
            <Spinner /> Loading…
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <SettingsCard id="comments" icon="comment" title={t("settings.whoCanComment")}>
        <p className="mt-0.5 text-sm text-muted">Who may comment on your posts. You can always comment on your own.</p>
        <AudienceChoice name="allow-comments" value={choices.allow_comments_from} disabled={busy} onChange={(a) => save({ ...choices, allow_comments_from: a })} />
      </SettingsCard>
      <SettingsCard id="mentions" icon="user" title={t("settings.whoCanMention")}>
        <p className="mt-0.5 text-sm text-muted">Whose “@yourname” in a comment or caption sends you a notification.</p>
        <AudienceChoice name="allow-mentions" value={choices.allow_mentions_from} disabled={busy} onChange={(a) => save({ ...choices, allow_mentions_from: a })} />
      </SettingsCard>
      <SettingsCard id="hidden-words" icon="eyeOff" title={t("settings.hiddenWords")}>
        <p className="mt-0.5 text-sm text-muted">
          Comments on your posts that contain these words or emoji are hidden from everyone except you and the person who wrote them. Separate several with commas.
        </p>
        <form onSubmit={addWords} className="mt-3 flex gap-2">
          <label htmlFor="hidden-word" className="sr-only">
            Add hidden words
          </label>
          <input id="hidden-word" className={inputClass} value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. cheap, copy, spam" maxLength={300} />
          <Button type="submit" disabled={!word.trim() || busy} className="shrink-0">
            Add
          </Button>
        </form>
        {choices.hidden_words.length === 0 ? (
          <p className="mt-3 text-sm text-faint">No hidden words yet.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Hidden words">
            {choices.hidden_words.map((w) => (
              <li key={w}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save({ ...choices, hidden_words: choices.hidden_words.filter((x) => x !== w) })}
                  className="flex items-center gap-1 rounded-full border border-line-strong bg-surface py-0.5 pl-2.5 pr-1.5 text-xs hover:border-err/40 hover:text-err disabled:opacity-50"
                  aria-label={`Remove “${w}”`}
                >
                  {w}
                  <Icon name="close" className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      {error && (
        <p role="alert" className="mt-2 text-sm text-err">
          {error}
        </p>
      )}
    </>
  );
}
