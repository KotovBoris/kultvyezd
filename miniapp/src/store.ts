import { useEffect, useState } from "react";

export interface Session {
  role: "parent" | "teacher";
  userId: number | null;
  studentId: number | null;
}

let session: Session = { role: "parent", userId: null, studentId: null };
const listeners = new Set<() => void>();

export function getSession(): Session {
  return session;
}

export function setSession(next: Partial<Session>): void {
  session = { ...session, ...next };
  listeners.forEach((fn) => fn());
}

export function useSession(): Session {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return session;
}
