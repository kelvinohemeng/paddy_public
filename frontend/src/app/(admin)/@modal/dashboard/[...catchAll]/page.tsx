// Closes the dashboard drawer when the app navigates AWAY from it with
// router.push / <Link> (e.g. the listing form stepper landing back on
// /dashboard/[user]/listings after a save).
//
// Why this file is needed: on a client-side (soft) navigation, a
// parallel-route slot that has no match for the new URL keeps showing
// whatever it showed before (Next.js docs, parallel routes → "Closing the
// modal"). So pushing to the listings page from the create drawer left
// the drawer open on top of it. A catch-all that renders nothing gives
// the @modal slot a match for every other dashboard URL, which empties it.
//
// Scoped to dashboard/… on purpose: a catch-all at the slot's root made
// the (admin) layout match EVERY URL, so unknown public pages answered
// 200 instead of 404. Under dashboard/ the same thing costs little: an
// unknown dashboard URL still shows the 404 page, just with status 200
// (logged-out visitors are sent to login first), and the dashboard is
// private, so no search engine ever sees it.
//
// Client-side navigation to create / preview / edit is still caught by
// the intercepting routes under (.)dashboard/…; default.tsx still covers
// hard loads.

export default function CloseModal() {
  return null;
}
