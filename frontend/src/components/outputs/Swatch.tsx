import type { FabricRecommendation } from "@/lib/types";

// CSS patterns that suggest each weave/texture on a colour swatch.
const TEXTURES: Record<FabricRecommendation["texture"], string> = {
  plain: "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 3px)",
  twill: "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.10) 0 2px, transparent 2px 5px)",
  satin: "linear-gradient(115deg, rgb(255 255 255 / 0) 30%, rgb(255 255 255 / 0.35) 50%, rgb(255 255 255 / 0) 70%)",
  sheer: "linear-gradient(rgb(255 255 255 / 0.45), rgb(255 255 255 / 0.45)), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.04) 0 1px, transparent 1px 4px)",
  knit: "repeating-linear-gradient(60deg, rgb(0 0 0 / 0.07) 0 2px, transparent 2px 4px), repeating-linear-gradient(-60deg, rgb(0 0 0 / 0.07) 0 2px, transparent 2px 4px)",
  pile: "radial-gradient(circle at 30% 30%, rgb(255 255 255 / 0.18), transparent 60%), radial-gradient(circle at 70% 80%, rgb(0 0 0 / 0.25), transparent 55%)",
  slub: "repeating-linear-gradient(0deg, rgb(0 0 0 / 0.06) 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.2) 0 3px, transparent 3px 11px)",
  crepe: "radial-gradient(rgb(0 0 0 / 0.10) 1px, transparent 1.2px) 0 0 / 4px 4px",
};

export function Swatch({ colour, texture, className = "h-16 w-full" }: { colour: string; texture: FabricRecommendation["texture"]; className?: string }) {
  return <div aria-hidden className={`rounded-md border border-ink/10 ${className}`} style={{ backgroundColor: colour, backgroundImage: TEXTURES[texture] }} />;
}
