"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/ui/Icon";

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/** A small "⋯" button that opens a list of actions. Closes on Escape or a click outside; follows the button
 * when the page scrolls.
 * The list is drawn at the end of the page (a portal), so dividers, animations and cards further down the page
 * can never cover it. */
export function MoreMenu({ items, label = "More actions", size = "md" }: { items: MenuItem[]; label?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Put the list under the button, or above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!button.current) return;
      const r = button.current.getBoundingClientRect();
      const height = list.current?.offsetHeight ?? items.length * 40 + 8;
      const right = Math.max(8, window.innerWidth - r.right);
      const below = r.bottom + 4 + height <= window.innerHeight;
      setPlace(below ? { top: r.bottom + 4, right } : { bottom: window.innerHeight - r.top + 4, right });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPlace(null);
          setOpen((v) => !v);
        }}
        className={`flex items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink ${size === "sm" ? "h-7 w-7" : "h-8 w-8 border border-line-strong"}`}
      >
        <Icon name="more" className="h-5 w-5" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            role="menu"
            aria-label={label}
            style={place ?? { top: 0, right: 0, visibility: "hidden" }}
            className="fixed z-50 min-w-48 overflow-hidden rounded-lg border border-line bg-surface shadow-card py-1 text-sm shadow-lg"
          >
            {items.map((item) => (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sunken ${item.danger ? "text-err" : "text-ink"}`}
                >
                  {item.icon && <Icon name={item.icon} className="h-4 w-4" />}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
