export type Handle = unknown;
export interface Scheduler {
  schedule: (fn: () => void, ms: number) => Handle;
  cancel: (h: Handle) => void;
}

export interface TimerScope {
  epoch: number;
  turnId: string | null;
}

export type TimerName =
  | "resume"
  | "thinkSlow"
  | "thinkTimeout"
  | "orb"
  | "backupProbe"
  | "sessionWarning"
  | "sessionLimit"
  | "readHold";

/**
 * Named timers scoped to an epoch and a turn (arch §4.6). Setting a name replaces the old timer.
 * A timer fires only if its scope is still current when it runs.
 */
export class Timers {
  private active = new Map<TimerName, { handle: Handle; scope: TimerScope }>();

  constructor(
    private scheduler: Scheduler,
    private isCurrent: (scope: TimerScope) => boolean,
  ) {}

  set(name: TimerName, ms: number, scope: TimerScope, fn: () => void) {
    this.clear(name);
    const handle = this.scheduler.schedule(() => {
      const t = this.active.get(name);
      if (!t || t.handle !== handle) return;
      this.active.delete(name);
      if (this.isCurrent(scope)) fn();
    }, ms);
    this.active.set(name, { handle, scope });
  }

  has(name: TimerName) {
    return this.active.has(name);
  }

  clear(...names: TimerName[]) {
    for (const name of names) {
      const t = this.active.get(name);
      if (!t) continue;
      this.scheduler.cancel(t.handle);
      this.active.delete(name);
    }
  }

  /** Clears every timer belonging to a turn (or to the given epoch when turnId is omitted). */
  clearScope(match: Partial<TimerScope>) {
    for (const [name, t] of [...this.active]) {
      const epochMatch = match.epoch === undefined || t.scope.epoch === match.epoch;
      const turnMatch = match.turnId === undefined || t.scope.turnId === match.turnId;
      if (epochMatch && turnMatch) this.clear(name);
    }
  }

  clearAll() {
    this.clear(...this.active.keys());
  }

  get size() {
    return this.active.size;
  }
}
