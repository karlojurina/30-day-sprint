// Same interval logic as the real src/lib/call-gate.ts, minus the telemetry
// fetch (which would need a network). Module-level state, like the real one.
export interface CallGate { allow(trigger: string): boolean }
export function createCallGate(_name: string, minIntervalMs: number): CallGate {
  let lastRunAt = 0;
  return {
    allow(_trigger: string): boolean {
      const now = Date.now();
      if (now - lastRunAt < minIntervalMs) return false;
      lastRunAt = now;
      return true;
    },
  };
}
