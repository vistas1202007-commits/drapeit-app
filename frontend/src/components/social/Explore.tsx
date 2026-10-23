"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { activeFilterCount, hashtag, NO_FILTERS } from "@/lib/social";
import type { ExploreFilterChoice, ExploreFilters, FilterOption, SearchResults } from "@/lib/types";
import { PeopleLoading, PersonRow } from "./PeopleList";
import { LoadingPosts, LoadMore, PostGrid, usePostPages } from "./PostList";

type Mode = "latest" | "trending";

const FILTER_FIELDS: { key: keyof ExploreFilterChoice; label: string; all: string; options: (f: ExploreFilters) => FilterOption[] }[] = [
  { key: "garment", label: "Garment", all: "All garments", options: (f) => f.garments },
  { key: "occasion", label: "Occasion", all: "All occasions", options: (f) => f.occasions },
  { key: "colour", label: "Colour", all: "All colours", options: (f) => f.colours },
  { key: "fabric", label: "Fabric", all: "All fabrics", options: (f) => f.fabrics },
];

function ExploreGrid({ mode, filters }: { mode: Mode; filters: ExploreFilterChoice }) {
  const { garment, occasion, colour, fabric } = filters;
  const load = useCallback(
    (cursor: string | null) => {
      const choice = { garment, occasion, colour, fabric };
      return mode === "trending" ? api.trending(choice) : api.explore(choice, cursor);
    },
    [mode, garment, occasion, colour, fabric],
  );
  const list = usePostPages(load);
  if (list.posts === null) return <LoadingPosts />;
  const filtered = activeFilterCount(filters) > 0;
  return (
    <div className="space-y-4">
      {list.posts.length === 0 && !list.error && (
        <EmptyState title={mode === "trending" ? "Nothing trending yet" : filtered ? "No designs match these filters" : "No public designs yet"}>
          {mode === "trending"
            ? "Trending shows the Public designs with the most likes and saves in the last 7 days."
            : filtered
              ? "Try fewer filters, or clear them."
              : "Explore shows Public posts from public accounts. Publish a design as Public to see it here."}
        </EmptyState>
      )}
      {list.posts.length > 0 && <PostGrid posts={list.posts} />}
      <LoadMore list={list} />
    </div>
  );
}

function Filters({ value, onChange }: { value: ExploreFilterChoice; onChange: (v: ExploreFilterChoice) => void }) {
  const [options, setOptions] = useState<ExploreFilters | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .exploreFilters()
      .then(setOptions)
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="text-xs text-muted">Filters could not be loaded. The grid below still works.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {FILTER_FIELDS.map((f) => {
        const choices = options ? f.options(options) : [];
        const current = value[f.key];
        return (
          <div key={f.key}>
            <label htmlFor={`filter-${f.key}`} className={labelClass}>
              {f.label}
            </label>
            <select id={`filter-${f.key}`} className={inputClass} value={current} disabled={!options} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}>
              <option value="">{options ? f.all : "Loading…"}</option>
              {current && !choices.some((c) => c.value.toLowerCase() === current.toLowerCase()) && <option value={current}>{current}</option>}
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} ({c.count})
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function SearchView({ query, onTag }: { query: string; onTag: (kind: keyof ExploreFilterChoice, value: string) => void }) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setError(null);
      api
        .search(query)
        .then((r) => !cancelled && setResults(r))
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 300);
    // Remember the search (Settings -> Your activity) once the person stops typing.
    const remember = setTimeout(() => api.saveSearch(query.trim()).catch(() => {}), 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(remember);
    };
  }, [query]);

  if (error) return <Notice tone="err" title="Search did not work">{error}</Notice>;
  if (!results) return <PeopleLoading />;
  const nothing = results.people.length === 0 && results.tags.length === 0 && results.posts.length === 0;
  if (nothing) {
    return <EmptyState title={`Nothing found for “${query}”`}>Try a username, a garment (anarkali, lehenga), a fabric or an occasion.</EmptyState>;
  }
  return (
    <div className="space-y-6">
      {results.people.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">People</h2>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface shadow-card px-4">
            {results.people.map((p) => (
              <PersonRow key={p.user_id} person={p} />
            ))}
          </ul>
        </section>
      )}
      {results.tags.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Tags</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {results.tags.map((t) => (
              <li key={`${t.kind}-${t.value}`}>
                <button type="button" onClick={() => onTag(t.kind, t.value)} className="rounded-full bg-wine-soft px-3 py-1 text-sm text-wine hover:bg-wine hover:text-on-wine">
                  {hashtag(t.value)} <span className="text-xs opacity-75">· {t.kind} · {t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results.posts.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Posts</h2>
          <div className="mt-2">
            <PostGrid posts={results.posts} />
          </div>
        </section>
      )}
    </div>
  );
}

export function ExploreView() {
  const [mode, setMode] = useState<Mode>("latest");
  const [filters, setFilters] = useState<ExploreFilterChoice>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const searching = query.trim().length >= 2;

  useEffect(() => {
    // Opened from Search history (/explore?q=...).
    const q = new URLSearchParams(window.location.search).get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only known in the browser
    if (q) setQuery(q.slice(0, 60));
  }, []);
  const count = activeFilterCount(filters);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="font-display text-3xl">Explore</h1>
      <p className="mt-1 text-sm text-muted">Public designs from public accounts on Drapeit. Find people, garments, fabrics and colours.</p>

      <div className="mt-5 flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 focus-within:border-wine focus-within:ring-2 focus-within:ring-wine/15">
        <Icon name="search" className="h-4 w-4 text-muted" />
        <input
          type="search"
          aria-label="Search people, posts and tags"
          className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-faint"
          placeholder="Search people, posts and tags"
          value={query}
          maxLength={60}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="rounded p-1 text-muted hover:text-ink">
            <Icon name="close" className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-6">
        {searching ? (
          <SearchView
            query={query.trim()}
            onTag={(kind, value) => {
              setFilters({ ...NO_FILTERS, [kind]: value });
              setMode("latest");
              setQuery("");
            }}
          />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Explore" className="flex gap-1 rounded-lg border border-line bg-surface shadow-card p-1">
                {(["latest", "trending"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-wine-soft font-medium text-wine" : "text-muted hover:text-ink"}`}
                  >
                    {m === "latest" ? "Latest" : "Trending (7 days)"}
                  </button>
                ))}
              </div>
              {count > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
                  Clear {count === 1 ? "filter" : `${count} filters`}
                </Button>
              )}
            </div>
            <Filters value={filters} onChange={setFilters} />
            <ExploreGrid key={`${mode}-${JSON.stringify(filters)}`} mode={mode} filters={filters} />
          </div>
        )}
      </div>
    </div>
  );
}
