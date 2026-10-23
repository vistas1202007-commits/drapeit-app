/* eslint-disable @next/next/no-img-element -- images come from our own API, next/image optimisation is not needed */
import { api } from "@/lib/api";

export function ProjectThumbnail({ assetId, title, className = "" }: { assetId: string | null; title: string; className?: string }) {
  if (assetId) {
    return <img src={api.assetUrl(assetId)} alt={`Sketch for ${title}`} className={`h-full w-full object-contain ${className}`} />;
  }
  return (
    <div className={`flex h-full w-full items-center justify-center bg-sunken ${className}`} aria-hidden>
      <svg viewBox="0 0 60 80" className="h-16 w-12 text-line-strong" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M24 6 L16 9 L18 22 L20 34 L10 74 Q30 78 50 74 L40 34 L42 22 L44 9 L36 6 Q30 14 24 6 Z" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
