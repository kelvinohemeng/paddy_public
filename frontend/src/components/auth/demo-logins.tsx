import { PaddyButton } from "@/components/paddy-button";

// The public demo accounts (contract C3; the backend's seed_demo_data
// creates them). The password is public on purpose: it's a portfolio
// demo with fake data. No NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD, no block.
// A staff demo account exists too, but isn't shown publicly.
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_ACCOUNT_PASSWORD;
const DEMO_ACCOUNTS = [
  { role: "renter", email: "renter+demo@paddy.dev" },
  { role: "landlord", email: "landlord+demo@paddy.dev" },
];

// One click signs in: the parent fills its own form and submits it, so
// the visitor sees exactly what was entered.
export function DemoLogins({
  onSignIn,
  disabled,
}: {
  onSignIn: (email: string, password: string) => void;
  disabled?: boolean;
}) {
  if (!DEMO_PASSWORD) return null;

  return (
    <section
      aria-labelledby="demo-logins-title"
      className="border-hairline mb-6 space-y-3 rounded-xl border p-4"
    >
      <div className="space-y-1">
        <h2 id="demo-logins-title" className="text-sm font-semibold text-[#111111]">
          Try the demo
        </h2>
        <p className="text-subtle-foreground font-label text-xs">
          Both accounts use the password{" "}
          <code className="font-mono text-[#111111]">{DEMO_PASSWORD}</code>.
        </p>
      </div>
      <ul className="space-y-2">
        {DEMO_ACCOUNTS.map(({ role, email }) => (
          <li key={email} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-sm break-all">{email}</span>
            <PaddyButton
              variant="secondary"
              size="sm"
              className="shrink-0"
              disabled={disabled}
              onClick={() => onSignIn(email, DEMO_PASSWORD)}
            >
              Sign in as {role}
            </PaddyButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
