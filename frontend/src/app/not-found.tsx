import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="font-display text-3xl">Page not found</p>
      <p className="mt-2 text-sm text-muted">This page does not exist.</p>
      <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
        Back to dashboard
      </Link>
    </div>
  );
}
