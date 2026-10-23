"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Avatar } from "@/components/social/Avatar";
import { useMyProfile } from "@/components/social/MyProfile";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import type { MessageKey } from "@/lib/i18n";
import { INTEREST_CHOICES, nextStep, ONBOARDING_STEPS, toggleChoice } from "@/lib/onboarding";
import { cleanUsername, ROLE_LABEL, ROLES, usernameProblem } from "@/lib/social";
import type { Interests, OnboardingStep, Role, SuggestedPerson } from "@/lib/types";

type Step = Exclude<OnboardingStep, "done">;

function StepFooter({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          <Icon name="chevronLeft" />
          {t("onboarding.back")}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function ProfileStep({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { profile, setProfile } = useMyProfile();
  const [username, setUsername] = useState(profile?.username ?? "");
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [role, setRole] = useState<Role>(profile?.role ?? "designer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = usernameProblem(username);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      setProfile(await api.saveProfile({ username: cleanUsername(username), display_name: displayName.trim(), bio: profile?.bio ?? "", role }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="text-sm text-muted">This is how people find you and see your designs. You can change it later in Settings.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ob-username" className={labelClass}>
            Username
          </label>
          <div className="flex items-center rounded-md border border-line-strong bg-surface focus-within:border-wine focus-within:ring-2 focus-within:ring-wine/15">
            <span className="pl-3 text-sm text-muted">@</span>
            <input
              id="ob-username"
              required
              autoComplete="username"
              className="w-full bg-transparent px-1 py-2 text-sm focus:outline-none"
              value={username}
              onChange={(e) => setUsername(cleanUsername(e.target.value))}
              placeholder="your.studio"
            />
          </div>
        </div>
        <div>
          <label htmlFor="ob-name" className={labelClass}>
            Display name
          </label>
          <input id="ob-name" className={inputClass} maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Meera Shah" />
        </div>
      </div>
      <fieldset className="mt-4">
        <legend className={labelClass}>What do you do?</legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <label key={r.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${role === r.id ? "border-wine bg-wine-soft text-wine" : "border-line-strong hover:bg-sunken"}`}>
              <input type="radio" name="ob-role" className="sr-only" checked={role === r.id} onChange={() => setRole(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <div className="mt-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <StepFooter>
        <Button type="submit" variant="primary" loading={busy}>
          {t("onboarding.next")}
          <Icon name="chevronRight" />
        </Button>
      </StepFooter>
    </form>
  );
}

function AvatarStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { t } = useT();
  const { profile, setProfile } = useMyProfile();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setProfile(await api.uploadAvatar(file, file.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">A face or your logo helps people recognise you. PNG, JPEG or WebP. You can skip this.</p>
      <div className="mt-5 flex flex-col items-center gap-3">
        {profile ? <Avatar person={profile} size="lg" /> : <span className="h-24 w-24 rounded-full bg-sunken" />}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        <Button onClick={() => input.current?.click()} loading={busy} disabled={!profile}>
          <Icon name="upload" />
          {profile?.has_avatar ? "Choose another picture" : "Choose a picture"}
        </Button>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <StepFooter onBack={onBack}>
        <Button variant="primary" onClick={onDone}>
          {t("onboarding.next")}
          <Icon name="chevronRight" />
        </Button>
      </StepFooter>
    </div>
  );
}

const INTEREST_GROUPS: { key: keyof Interests; title: string }[] = [
  { key: "garments", title: "Garments" },
  { key: "fabrics", title: "Fabrics" },
  { key: "styles", title: "Styles" },
];

function InterestsStep({ interests, onBack, onDone }: { interests: Interests; onBack: () => void; onDone: (i: Interests) => void }) {
  const { t } = useT();
  const [chosen, setChosen] = useState<Interests>(interests);
  return (
    <div>
      <p className="text-sm text-muted">Pick a few. We use them to suggest designers and posts you may like.</p>
      {INTEREST_GROUPS.map((g) => (
        <fieldset key={g.key} className="mt-4">
          <legend className={labelClass}>{g.title}</legend>
          <div className="flex flex-wrap gap-1.5">
            {INTEREST_CHOICES[g.key].map((choice) => {
              const on = chosen[g.key].includes(choice);
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen((c) => ({ ...c, [g.key]: toggleChoice(c[g.key], choice) }))}
                  className={`rounded-full border px-3 py-1 text-sm ${on ? "border-wine bg-wine text-on-wine" : "border-line-strong bg-surface hover:bg-sunken"}`}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <StepFooter onBack={onBack}>
        <Button variant="primary" onClick={() => onDone(chosen)}>
          {t("onboarding.next")}
          <Icon name="chevronRight" />
        </Button>
      </StepFooter>
    </div>
  );
}

function FollowStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { t } = useT();
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);
  const [done, setDone] = useState<Record<string, "following" | "requested">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .suggestions()
      .then(setPeople)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load suggestions.");
        setPeople([]);
      });
  }, []);

  async function follow(p: SuggestedPerson) {
    setBusy(p.username);
    setError(null);
    try {
      const detail = await api.follow(p.username, true);
      setDone((d) => ({ ...d, [p.username]: detail.follow_status === "requested" ? "requested" : "following" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-muted">Designers, tailors and boutiques on Drapeit. Their new posts will show in your Home Feed.</p>
      {error && (
        <div className="mt-3">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      {people === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Finding people…
        </p>
      ) : people.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No suggestions yet">Drapeit is new; find people later in Explore.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {people.map((p) => (
            <li key={p.user_id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar person={p} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {p.display_name || p.username} <VerifiedBadge person={p} />
                </span>
                <span className="block truncate text-xs text-muted">
                  @{p.username} · {ROLE_LABEL[p.role]} · {p.follower_count} followers
                </span>
              </span>
              {done[p.username] ? (
                <span className="text-xs text-ok">{done[p.username] === "requested" ? "Requested" : "Following"}</span>
              ) : (
                <Button size="sm" variant="primary" loading={busy === p.username} onClick={() => follow(p)}>
                  {p.is_private ? "Request" : "Follow"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <StepFooter onBack={onBack}>
        <Button variant="primary" onClick={onDone}>
          {t("onboarding.next")}
          <Icon name="chevronRight" />
        </Button>
      </StepFooter>
    </div>
  );
}

const TOUR: { icon: IconName; title: string; text: string }[] = [
  { icon: "notebook", title: "Notebook", text: "Start a design by writing your idea in plain words. Generate a concept, sketch, fabric advice, materials, cost and a tailor sheet, all saved as versions you can go back to." },
  { icon: "pen", title: "Design Studio", text: "Draw over sketches with layers, pens and shapes, import reference pictures, and undo anything. Your drawing is saved with the design." },
  { icon: "send", title: "Publish", text: "Share a design as a post: choose the pictures, colours and fabric to show and who can see it. Measurements, notes and client photos are never published." },
];

function TourStep({ onBack, onDone, busy }: { onBack: () => void; onDone: () => void; busy: boolean }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  const slide = TOUR[i];
  return (
    <div>
      <div className="flex flex-col items-center px-2 py-4 text-center" aria-live="polite">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-wine-soft text-wine">
          <Icon name={slide.icon} className="h-8 w-8" />
        </span>
        <h3 className="mt-4 font-display text-2xl">{slide.title}</h3>
        <p className="mt-2 max-w-md text-sm text-muted">{slide.text}</p>
        <div className="mt-4 flex gap-1.5" aria-hidden>
          {TOUR.map((s, n) => (
            <span key={s.title} className={`h-1.5 w-6 rounded-full ${n === i ? "bg-wine" : "bg-line-strong"}`} />
          ))}
        </div>
        <p className="sr-only">
          Screen {i + 1} of {TOUR.length}
        </p>
      </div>
      <StepFooter onBack={i === 0 ? onBack : () => setI(i - 1)}>
        {i < TOUR.length - 1 ? (
          <Button variant="primary" onClick={() => setI(i + 1)}>
            {t("onboarding.next")}
            <Icon name="chevronRight" />
          </Button>
        ) : (
          <Button variant="primary" onClick={onDone} loading={busy}>
            {t("onboarding.finish")}
          </Button>
        )}
      </StepFooter>
    </div>
  );
}

const STEP_TITLES: Record<Step, MessageKey> = {
  profile: "onboarding.step.profile",
  avatar: "onboarding.step.avatar",
  interests: "onboarding.step.interests",
  follow: "onboarding.step.follow",
  tour: "onboarding.step.tour",
};

/** /welcome: five short, skippable steps. Progress is saved, so it continues where you left off. */
export function Welcome() {
  const { t } = useT();
  const router = useRouter();
  const { profile } = useMyProfile();
  const [step, setStep] = useState<Step | null>(null);
  const [interests, setInterests] = useState<Interests>({ garments: [], fabrics: [], styles: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .onboarding()
      .then((o) => {
        setInterests(o.interests);
        setStep(o.step === "done" ? "profile" : o.step);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load your progress.");
        setStep("profile");
      });
  }, []);

  async function go(next: OnboardingStep, chosen?: Interests) {
    setBusy(true);
    setError(null);
    try {
      await api.saveOnboarding({ step: next, ...(chosen ? { interests: chosen } : {}) });
      if (chosen) setInterests(chosen);
      if (next === "done") router.push("/");
      else setStep(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your progress.");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api.skipOnboarding();
    } catch {
      /* skipping must never trap anyone */
    }
    router.push("/");
  }

  if (step === null) {
    return (
      <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted" role="status">
        <Spinner /> {t("common.loading")}
      </p>
    );
  }
  const index = ONBOARDING_STEPS.indexOf(step);
  const back = () => setStep(nextStep(step, -1) as Step);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("onboarding.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("onboarding.subtitle")}</p>
        </div>
        <Button variant="ghost" onClick={skip} disabled={busy}>
          {t("onboarding.skip")}
        </Button>
      </div>
      <ol className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Steps">
        {ONBOARDING_STEPS.map((s, n) => (
          <li key={s} className="min-w-0">
            <span className={`block h-1.5 rounded-full ${n <= index ? "bg-wine" : "bg-line-strong"}`} />
            <span className={`mt-1 hidden truncate text-[11px] sm:block ${n === index ? "font-medium text-wine" : "text-muted"}`}>{t(STEP_TITLES[s])}</span>
          </li>
        ))}
      </ol>
      <section className="mt-5 rounded-xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="font-display text-xl">
          {index + 1}. {t(STEP_TITLES[step])}
        </h2>
        {error && (
          <div className="mt-3">
            <Notice tone="err">{error}</Notice>
          </div>
        )}
        <div className="mt-2">
          {step === "profile" && <ProfileStep onDone={() => go("avatar")} />}
          {step === "avatar" && <AvatarStep onBack={back} onDone={() => go("interests")} />}
          {step === "interests" && <InterestsStep interests={interests} onBack={back} onDone={(i) => go("follow", i)} />}
          {step === "follow" && <FollowStep onBack={back} onDone={() => go("tour")} />}
          {step === "tour" && <TourStep onBack={back} onDone={() => go("done")} busy={busy} />}
        </div>
      </section>
      {profile === null && step !== "profile" && (
        <p className="mt-3 text-xs text-muted">
          No profile yet.{" "}
          <button type="button" className="text-wine hover:underline" onClick={() => setStep("profile")}>
            Go back to step 1
          </button>{" "}
          or <Link href="/" className="text-wine hover:underline">continue later</Link>.
        </p>
      )}
    </div>
  );
}
