import type { SessionSummary } from "./SessionRecorder.js";

export interface ArchivedSession {
  id: string;
  exerciseId: string;
  exerciseName: string;
  finishedAt: number;
  score: number;
  beat: number;
  bestCombo: number;
  perfectFrames: number;
  avgDelta: number;
  riskHits: number;
  medalName: string;
  summary: SessionSummary;
}

const STORAGE_KEY = "kinex.sessions.v1";
const MAX_SESSIONS = 20;

/**
 * localStorage-backed history of finished sessions (newest first, capped at
 * 20). Powers the report page and the library's history stats. Best-effort:
 * any storage failure just means no history.
 */
export class SessionArchive {
  list(): ArchivedSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ArchivedSession[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  latest(): ArchivedSession | null {
    return this.list()[0] ?? null;
  }

  get(id: string): ArchivedSession | null {
    return this.list().find((session) => session.id === id) ?? null;
  }

  add(entry: ArchivedSession): void {
    const sessions = [entry, ...this.list().filter((s) => s.id !== entry.id)].slice(0, MAX_SESSIONS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // storage full or unavailable — history is best-effort
    }
  }

  /** Sessions played for one exercise, newest first. */
  forExercise(exerciseId: string): ArchivedSession[] {
    return this.list().filter((s) => s.exerciseId === exerciseId);
  }
}
