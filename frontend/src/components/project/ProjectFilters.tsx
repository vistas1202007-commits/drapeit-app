"use client";

import { Icon } from "@/components/ui/Icon";
import { inputClass } from "@/components/ui/fields";
import { GARMENT_CATEGORIES } from "@/lib/format";

export function ProjectFilters({ search, onSearch, category, onCategory }: { search: string; onSearch: (v: string) => void; category: string; onCategory: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <label className="relative min-w-52 flex-1">
        <span className="sr-only">Search projects</span>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input type="search" className={`${inputClass} pl-9`} placeholder="Search by name or garment" value={search} onChange={(e) => onSearch(e.target.value)} />
      </label>
      <label>
        <span className="sr-only">Filter by garment type</span>
        <select className={`${inputClass} w-48`} value={category} onChange={(e) => onCategory(e.target.value)}>
          <option value="">All garment types</option>
          {GARMENT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
