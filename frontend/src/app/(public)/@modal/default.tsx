// Parallel-route slot default: renders nothing on every public route
// where the intercepted (.)homes/[id] preview isn't active. Next
// requires this file for any @slot (same as (admin)/@modal/default.tsx).
export default function Default() {
  return null;
}
