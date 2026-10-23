"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";

interface MyProfileValue {
  /** undefined while loading, null when the user has not set up a profile yet. */
  profile: Profile | null | undefined;
  setProfile: (p: Profile | null) => void;
  reload: () => Promise<void>;
}

const MyProfileContext = createContext<MyProfileValue | null>(null);

/** The signed-in user's own public profile, shared by the menu, publishing and profile pages. */
export function MyProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      setProfile(await api.myProfile());
    } catch {
      setProfile((p) => (p === undefined ? null : p));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once after sign-in
    void reload();
  }, [reload]);
  return <MyProfileContext.Provider value={{ profile, setProfile, reload }}>{children}</MyProfileContext.Provider>;
}

export function useMyProfile(): MyProfileValue {
  const ctx = useContext(MyProfileContext);
  if (!ctx) throw new Error("useMyProfile must be used inside <MyProfileProvider>");
  return ctx;
}
