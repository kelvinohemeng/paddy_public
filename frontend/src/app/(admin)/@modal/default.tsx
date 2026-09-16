// Parallel route slots (like @modal) REQUIRE a default.tsx — this is
// what Next.js renders for the @modal slot on every route where the
// intercepted (.)listings/create path is NOT currently active (i.e.
// almost everywhere in the app). Returning null means "render
// nothing here" — the modal slot is simply empty/invisible until the
// URL actually matches the intercepted route above.
//
// Without this file, Next.js throws a build error the moment you add
// a parallel route slot without a matching default — it needs an
// explicit answer for "what shows here otherwise," it won't assume
// null on its own.

export default function Default() {
  return null;
}
