import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

export type LegalDoc = "terms" | "privacy" | "guidelines";

const TITLES: Record<LegalDoc, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  guidelines: "Community Guidelines",
};

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-7 font-display text-xl">{children}</h2>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-ink/90">{children}</p>;
}

function L({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/90">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Terms() {
  return (
    <>
      <H>1. What Drapeit is</H>
      <P>Drapeit by Vistas Atelier is a design notebook for clothing ideas, with optional AI tools and a community where you can share designs, comment and message.</P>
      <H>2. Your account</H>
      <L
        items={[
          "You need an email address and a password. Keep your password secret; you are responsible for what happens in your account.",
          "Give true information and use only one account per person unless we agree otherwise.",
          "You can download your data, deactivate your account or delete it at any time in Settings → Account. Deletion becomes final 30 days after you ask.",
        ]}
      />
      <H>3. Your designs and posts</H>
      <L
        items={[
          "You keep the rights to what you create and upload. By publishing a post you allow other users to view it as your visibility choice allows, and allow us to store and show it to them.",
          "Only publish things you have the right to share. Do not post other people's designs as your own.",
          "Follow the Community Guidelines. We may hide or remove content, or limit an account, that breaks them or the law.",
        ]}
      />
      <H>4. AI tools</H>
      <L
        items={[
          "AI results are suggestions and may be wrong. Check measurements, fabric amounts, prices and instructions before cutting fabric or quoting a customer.",
          "When real AI is switched on, the parts of your design needed for a task are sent to the AI provider to create the result.",
          "Paid AI may stop for the day when the daily spending limit is reached.",
        ]}
      />
      <H>5. Things you must not do</H>
      <L items={["Break the law or other people's rights.", "Harass, threaten, scam or spam people.", "Try to break, overload or get around the security of the service.", "Collect other users' data without permission."]} />
      <H>6. Availability and changes</H>
      <P>The service is provided “as is”. It may change, pause or have mistakes. We will tell you about important changes to these terms in the app.</P>
      <H>7. Liability</H>
      <P>To the extent the law allows, we are not responsible for indirect losses, such as lost fabric, lost orders or lost profits, arising from using the service or its AI suggestions.</P>
      <H>8. Contact</H>
      <P>
        Use <Link href="/help#report" className="text-wine hover:underline">Help → Report a problem</Link>.
      </P>
    </>
  );
}

function Privacy() {
  return (
    <>
      <H>What we collect</H>
      <L
        items={[
          "Account: your email address and a protected (hashed) password, handled by our sign-in provider, Supabase Auth.",
          "What you create: designs, versions, notes, sketches, pictures you upload, measurements and cost details you type in.",
          "What you share: your profile, posts, comments, likes, saves, follows, messages and reports.",
          "Activity: your Explore search history, roughly how long the app was open each day, and notification and privacy settings.",
          "Appearance: your app theme, your profile theme and any custom theme colours. Other signed-in people see only your profile theme.",
          "Help: problem reports you send, with an optional screenshot and your browser name.",
        ]}
      />
      <H>Why we use it</H>
      <L items={["To run the app and show you your own work.", "To show your shared content to the people you chose.", "To keep the community safe (blocks, reports, limits).", "To fix problems you report."]} />
      <H>Who else handles it</H>
      <L
        items={[
          "Supabase: database, sign-in and file storage.",
          "Our hosting providers for the website and the server.",
          "AI providers (Anthropic, Google or OpenAI) only when real AI is switched on, and only the design details needed for the task you asked for.",
          "YouTube (Google) for tutorial search, which receives the search words, not your account.",
        ]}
      />
      <P>We do not sell your data. Measurements, budget, notes and reference photos are never published in posts.</P>
      <H>How long we keep it</H>
      <P>As long as your account exists. Deleted posts are kept for 30 days in Recently deleted. When you delete your account, it is hidden at once and everything, including files, is removed after 30 days.</P>
      <H>Your choices and rights</H>
      <L
        items={[
          "See and change your settings in Settings.",
          "Download a copy of your data: Settings → Account → Download your data.",
          "Deactivate or delete your account: Settings → Account.",
          "Clear your search history: Settings → Your activity.",
        ]}
      />
      <H>Cookies and storage in your browser</H>
      <P>We keep your sign-in session, your language choice and your app theme in your browser&apos;s local storage. We do not use advertising cookies.</P>
      <H>Contact</H>
      <P>
        Use <Link href="/help#report" className="text-wine hover:underline">Help → Report a problem</Link>.
      </P>
    </>
  );
}

function Guidelines() {
  return (
    <>
      <P>Drapeit is a place to learn, share and grow as a designer or tailor. Please help keep it kind and useful.</P>
      <H>Do</H>
      <L items={["Share your own work, and credit others when you are inspired by them (reposts always credit the designer).", "Give honest, respectful feedback.", "Protect your clients: never post their photos, names or measurements without permission."]} />
      <H>Don&apos;t</H>
      <L
        items={[
          "Copy someone's design and post it as yours.",
          "Harass, bully, threaten or shame anyone, including about body size or shape.",
          "Post hate, violence, nudity or sexual content.",
          "Spam, scam, or sell fake or stolen goods.",
          "Share false information that could hurt people.",
        ]}
      />
      <H>If something is wrong</H>
      <P>Use ⋯ → Report on a post, comment or profile. You can also mute, restrict or block people, limit who can message, comment or mention you, and add hidden words in Settings → Privacy & safety. Reports are private: the person is not told who reported them.</P>
      <H>What we may do</H>
      <P>We may hide or remove content, and limit or close accounts, that break these guidelines.</P>
    </>
  );
}

/** /legal/terms, /legal/privacy, /legal/guidelines - open without signing in. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/90 px-4 py-4 backdrop-blur sm:px-8">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
        <nav aria-label="Legal pages" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {(Object.keys(TITLES) as LegalDoc[]).map((d) => (
            <Link key={d} href={`/legal/${d}`} aria-current={d === doc ? "page" : undefined} className={d === doc ? "font-medium text-wine" : "text-muted hover:text-wine"}>
              {TITLES[d]}
            </Link>
          ))}
          <Link href="/settings" className="ml-auto text-muted hover:text-wine">
            ← Settings
          </Link>
        </nav>
        <h1 className="mt-4 font-display text-3xl">{TITLES[doc]}</h1>
        <p role="note" className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
          <span className="font-semibold">Draft – needs legal review.</span> This is a plain-language starting point written for this app, not legal advice. Have a
          lawyer review it before the app is opened to the public.
        </p>
        <p className="mt-3 text-xs text-muted">Last updated: 23 October 2026</p>
        {doc === "terms" ? <Terms /> : doc === "privacy" ? <Privacy /> : <Guidelines />}
      </main>
    </div>
  );
}
