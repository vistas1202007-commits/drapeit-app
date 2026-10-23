"use client";

import { useState, type FormEvent } from "react";
import { VideoCard } from "@/components/outputs/VideoCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { inputClass } from "@/components/ui/fields";
import { ApiError, api } from "@/lib/api";
import type { TutorialVideo } from "@/lib/types";

const SUGGESTIONS = ["anarkali kali cutting", "how to insert invisible zip", "blouse measurement", "zardozi embroidery basics"];

export function LibrarySearch() {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("any");
  const [results, setResults] = useState<TutorialVideo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ notConnected: boolean; text: string } | null>(null);

  async function search(q: string) {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await api.searchTutorials(q.trim(), language));
    } catch (e) {
      setResults(null);
      setError({ notConnected: e instanceof ApiError && e.status === 503, text: e instanceof Error ? e.message : "Search failed" });
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void search(query);
  }

  const youtubeSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;

  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={submit} className="rounded-lg border border-line bg-surface shadow-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tutorials, e.g. how to attach anarkali kalis" aria-label="Search tutorials" maxLength={120} />
          <select className={`${inputClass} sm:w-40`} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Video language">
            <option value="any">Any language</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
          <Button type="submit" variant="primary" loading={busy} disabled={query.trim().length < 2}>
            Search
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:border-wine hover:text-wine"
              onClick={() => {
                setQuery(s);
                void search(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {error?.notConnected && (
        <Notice tone="warn" title="Tutorial search is not connected">
          <p>{error.text}</p>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5">
            <li>Open console.cloud.google.com and create a project (free).</li>
            <li>In “APIs &amp; Services”, enable “YouTube Data API v3”.</li>
            <li>Go to Credentials → Create credentials → API key.</li>
            <li>
              Paste it into <code>backend/.env</code> as <code>YOUTUBE_API_KEY=…</code> and restart the backend.
            </li>
          </ol>
          {query.trim().length >= 2 && (
            <p className="mt-2">
              Meanwhile:{" "}
              <a href={youtubeSearch} target="_blank" rel="noopener noreferrer" className="text-wine hover:underline">
                search “{query.trim()}” on YouTube yourself ↗
              </a>
            </p>
          )}
        </Notice>
      )}
      {error && !error.notConnected && <Notice tone="err" title="Search failed">{error.text}</Notice>}

      {results && (
        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl">Results</h2>
            <Badge tone="ok">Real YouTube results</Badge>
          </div>
          {results.length === 0 ? (
            <p className="mt-2 text-sm text-muted">YouTube returned nothing suitable. Try other words or another language.</p>
          ) : (
            <ul className="mt-3 grid gap-3 lg:grid-cols-2">
              {results.map((v) => (
                <VideoCard key={v.video_id} video={v} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Titles, channels and thumbnails come from YouTube. The ticks are the app&apos;s reasons, worked out from each video&apos;s own title.</p>
        </section>
      )}
    </div>
  );
}
