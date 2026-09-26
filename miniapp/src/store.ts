/** Простейшее хранилище сессии (без внешних зависимостей). */
import { useEffect, useState } from "react";

export interface Session {
  /** id ученика, если mini-app открыт по контексту родителя (?startapp=<student_id>) */
  studentId: number | null;
  role: "teacher" | "parent";
}

let session: Session = { studentId: null, role: "teacher" };
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
