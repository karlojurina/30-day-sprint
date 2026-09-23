// Records every rpc call and replies with whatever the test scripted.
export interface RpcCall { fn: string; args: Record<string, unknown> }
export const calls: RpcCall[] = [];
let nextResponse: (args: Record<string, unknown>, n: number) => unknown = () => ({
  accepted: true, max_position_seconds: 0, watched_seconds: 0,
  threshold_met: false, threshold_crossed: false,
});
export function setResponder(fn: (args: Record<string, unknown>, n: number) => unknown) {
  nextResponse = fn;
}
export function reset() { calls.length = 0; }
export function createClient() {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: nextResponse(args, calls.length), error: null });
    },
  };
}
