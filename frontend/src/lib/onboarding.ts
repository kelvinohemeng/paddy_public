// The ONE rule for "has this account finished onboarding?", shared by
// /dashboard (app/(admin)/dashboard/page.tsx), which sends unfinished
// accounts to /onboarding, and /onboarding (app/onboarding/page.tsx),
// which sends finished ones back. The two pages must agree exactly, or
// they bounce the browser between each other forever. That happened
// when /dashboard checked `!username` and /onboarding checked
// `username !== null`: against a backend that doesn't send `username`
// at all (one running code from before usernames), the value is
// undefined, which the first check counts as missing and the second as
// present.
//
// Anything falsy (null, undefined, "") counts as missing.

type OnboardingState = {
  role?: string | null;
  username?: string | null;
};

export function needsRole(user: OnboardingState): boolean {
  return !user.role;
}

export function needsUsername(user: OnboardingState): boolean {
  return !user.username;
}

export function needsOnboarding(user: OnboardingState): boolean {
  return needsRole(user) || needsUsername(user);
}
