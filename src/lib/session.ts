import { useEffect, useState } from "react";

/**
 * Prototype-only session. Deliberately framework-agnostic and stored in
 * localStorage so the production build can swap it for a real auth provider
 * without touching any screen.
 */
const KEY = "ab.session";

export interface Session {
  signedIn: boolean;
  company: string;
  accountNumber: string;
  contact: string;
  role: "Trade Account Admin" | "Trade Buyer" | "Trade Accounts User" | "Trade Read Only";
}

export const guest: Session = {
  signedIn: false,
  company: "",
  accountNumber: "",
  contact: "",
  role: "Trade Read Only",
};

export const demoTradeSession: Session = {
  signedIn: true,
  company: "ABC Motor Factors Ltd",
  accountNumber: "ABC001",
  contact: "Dan Reeves",
  role: "Trade Buyer",
};

const listeners = new Set<() => void>();

function read(): Session {
  if (typeof window === "undefined") return guest;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : guest;
  } catch {
    return guest;
  }
}

export function signIn(session: Session = demoTradeSession) {
  window.localStorage.setItem(KEY, JSON.stringify(session));
  listeners.forEach((l) => l());
}

export function signOut() {
  window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

/** Returns the guest session during SSR and the first client render. */
export function useSession(): Session {
  const [session, setSession] = useState<Session>(guest);

  useEffect(() => {
    const sync = () => setSession(read());
    sync();
    listeners.add(sync);
    window.addEventListener("storage", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return session;
}
