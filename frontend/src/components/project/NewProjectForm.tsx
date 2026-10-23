"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { GARMENT_CATEGORIES } from "@/lib/format";

export function NewProjectForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [idea, setIdea] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give your design a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const project = await api.createProject({ title: title.trim(), garment_category: category, idea: idea.trim() });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      // Keep everything the user typed so nothing is lost.
      setError(err instanceof Error ? err.message : "Could not create the project.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface shadow-card p-5">
      <h2 className="font-display text-xl">Start a new design</h2>
      <p className="mt-1 text-sm text-muted">Name it, describe the idea in your own words, then open the notebook.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="np-title" className={labelClass}>
            Design name
          </label>
          <input id="np-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Wine anarkali for Meera's wedding" maxLength={120} />
        </div>
        <div>
          <label htmlFor="np-cat" className={labelClass}>
            Garment type (optional)
          </label>
          <select id="np-cat" className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Not sure yet</option>
            {GARMENT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label htmlFor="np-idea" className={labelClass}>
          Your idea (optional)
        </label>
        <textarea
          id="np-idea"
          className={`${inputClass} min-h-20 resize-y`}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          maxLength={4000}
          placeholder="An embroidered wine-colour anarkali with full sleeves and a V-neck, for an evening wedding…"
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-err">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>
          Create and open notebook
        </Button>
      </div>
    </form>
  );
}
