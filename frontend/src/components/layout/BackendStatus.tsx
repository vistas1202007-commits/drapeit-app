"use client";

import { useEffect, useState } from "react";
import { api, API_URL } from "@/lib/api";

/** Shows a clear banner when the Python backend is not running. */
export function BackendStatus() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .health()
        .then(() => !cancelled && setOffline(false))
        .catch(() => !cancelled && setOffline(true));
    check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!offline) return null;
  const local = /localhost|127\.0\.0\.1/.test(API_URL);
  return (
    <div role="alert" className="no-print border-b border-err/25 bg-err-soft px-4 py-2.5 text-sm text-ink sm:px-8">
      <span className="font-medium">The server is not reachable at {API_URL}.</span>{" "}
      {local ? (
        <span className="text-muted">
          Start it in a terminal: <code className="rounded bg-surface px-1 py-0.5 text-[12px]">cd backend</code> then{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-[12px]">uvicorn app.main:build --factory --reload --port 8000</code>
        </span>
      ) : (
        <span className="text-muted">If it was asleep it can take up to a minute to wake up; this message goes away by itself. Your work is saved.</span>
      )}
    </div>
  );
}
