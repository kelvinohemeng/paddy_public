"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FormProvider, useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Loader2, MailWarning } from "lucide-react";

import { PaddyBadge } from "@/components/paddy-badge";
import { PaddyButton } from "@/components/paddy-button";
import { useSideDrawerActionsSlot } from "@/components/side-drawer";
import { useApiCreate, useApiInvalidate, useApiOne, useApiUpdate } from "@/hooks/use-api";
import { useMe } from "@/hooks/use-auth";
import { useMySubscription } from "@/hooks/use-subscription";
import { useSubmitForReview, type SubmitForReviewResult } from "@/hooks/use-submit-for-review";
import { authedFetch, errorMessage } from "@/lib/api";
import { apiPost, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ManagedPhoto } from "./photo-manager";
import { AMENITY_FIELDS, AmenitiesSection } from "./listing-form/amenities-section";
import { BASICS_FIELDS, BasicsSection } from "./listing-form/basics-section";
import { SectionHeading } from "./listing-form/form-parts";
import { LOCATION_FIELDS, LocationSection } from "./listing-form/location-section";
import { PhotosSection } from "./listing-form/photos-section";
import { PRICING_FIELDS, PricingSection } from "./listing-form/pricing-section";
import { ReviewStep } from "./listing-form/review-step";
import {
  EMPTY_LISTING_FORM,
  listingFormSchema,
  listingToFormValues,
  toPayload,
  type ListingFieldName,
  type ListingFormOutput,
  type ListingFormValues,
} from "./listing-form/schema";
import { StepIndicator } from "./listing-form/step-indicator";
import { TOUR_FIELDS, TourSection } from "./listing-form/tour-section";

// The listing form, as a 5-step stepper (Kelvin, 2026-09-28) instead of
// Figma 288:8254's one long form (which stays in git history as
// listing-create-form.tsx):
//   1 Basics (photos, title, description, rooms, amenities)
//   2 Location (address, paste coordinates, map pin)
//   3 Pricing & type (monthly price, advance rent period)
//   4 Others (360° tour URL)
//   5 Review (everything, with Edit links back)
//
// ONE component for create AND edit, switched by `listingId` — the same
// contract the old ListingCreateForm had, so all six create/preview/edit
// routes (the three pages and their @modal drawers) keep working, and
// the inline edit toggle on listings/[id]/page.tsx keeps its onSuccess /
// onCancel.
//
// How it saves:
// - Nothing is sent until the final step. Every value lives in one
//   react-hook-form instance across the steps (every step stays mounted,
//   just hidden), and picked photos wait in state. The backend needs the
//   address and location to save a listing at all, so there are no
//   drafts between steps.
// - Next validates only the current step's fields (each section exports
//   its field names) and blocks while they're invalid.
// - Create: "Save as draft" = POST, then upload photos. "Submit for
//   review" = the same, then POST /listings/<id>/submit-for-review/.
//   If the landlord's live slots are all used, Submit becomes "Upgrade to
//   submit": save the draft, then go to the plan card (Kelvin chose this
//   over a plain link, which would throw the whole form away).
// - Edit: every step is already valid, so the step row is clickable, and
//   step 5's "Save changes" does a PUT, then uploads any new photos.
//
// Limits (backend PR #34, payments/limits.py), read from
// GET /payments/subscription/:
// - Free total limit (10) reached → a message BEFORE step 1, instead of
//   letting the landlord fill in a form that can't be saved.
// - Live limit reached → "Upgrade to submit" on step 5.
// The numbers can change between loading and clicking, so the server's
// own refusals are handled too (listing_total_limit_reached on create,
// listing_limit_reached on submit, email_not_verified on either) — always
// with a friendly message, never the raw error.

type StepConfig = { label: string; fields: readonly ListingFieldName[] };

const STEPS: StepConfig[] = [
  { label: "Basics", fields: [...BASICS_FIELDS, ...AMENITY_FIELDS] },
  { label: "Location", fields: LOCATION_FIELDS },
  { label: "Pricing & type", fields: PRICING_FIELDS },
  { label: "Others", fields: TOUR_FIELDS },
  { label: "Review", fields: [] },
];
const REVIEW_STEP = STEPS.length - 1;

type ListingFormStepperProps = {
  // Edit mode when set: prefills from GET /listings/<id>/ and saves with
  // PUT. Omitted = create.
  listingId?: string | number;
  // Called INSTEAD of the internal navigation after a successful save —
  // the inline edit toggle on listings/[id]/page.tsx flips straight back
  // to its preview, since its URL never changed.
  onSuccess?: (listingId?: string | number) => void;
  // Called INSTEAD of router.back() on Cancel — same inline-toggle case.
  onCancel?: () => void;
};

export function ListingFormStepper({
  listingId,
  onSuccess,
  onCancel,
}: ListingFormStepperProps) {
  const isEdit = listingId !== undefined && listingId !== null;
  const record = useApiOne("listings", isEdit ? listingId : undefined);
  // Only a new listing is gated by the plan (edit never submits).
  const subscription = useMySubscription({ enabled: !isEdit });

  // The "Free total limit reached" check is decided ONCE, when the
  // subscription first arrives. Saving invalidates the subscription
  // query; if a later refetch flipped this screen on, it would throw
  // away whatever the form was showing (e.g. a "saved, but not
  // submitted" message).
  const [gate, setGate] = useState<"pending" | "open" | "blocked">(
    isEdit ? "open" : "pending",
  );
  if (gate === "pending" && (subscription.isSuccess || subscription.isError)) {
    const s = subscription.data;
    const blocked = Boolean(
      s &&
        s.listing_total_cap !== null &&
        s.listings_total !== null &&
        s.listings_total >= s.listing_total_cap,
    );
    // Setting state while rendering is React's pattern for "derive once
    // from data that arrived" — it re-renders immediately, no effect.
    setGate(blocked ? "blocked" : "open");
  }

  if (isEdit && record.isError) {
    return (
      <p className="text-destructive py-16 text-center text-sm">
        Couldn&apos;t load this listing. Close and try again.
      </p>
    );
  }
  if ((isEdit && !record.data) || gate === "pending") {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-black/40" aria-label="Loading" />
      </div>
    );
  }
  if (gate === "blocked") {
    return (
      <TotalLimitScreen
        total={subscription.data?.listings_total ?? 0}
        cap={subscription.data?.listing_total_cap ?? 0}
        onCancel={onCancel}
      />
    );
  }

  return (
    <StepperForm
      // Remount (fresh form) if the same drawer ever switches listing.
      key={isEdit ? String(listingId) : "new"}
      listingId={isEdit ? listingId : undefined}
      initialValues={isEdit ? listingToFormValues(record.data) : EMPTY_LISTING_FORM}
      // Live, not a snapshot: PhotoManager's cover/reorder/delete refetch
      // the listing, and the gallery should follow.
      existingPhotos={isEdit ? ((record.data?.photos as ManagedPhoto[] | undefined) ?? []) : []}
      liveLimit={
        subscription.data && subscription.data.listing_cap !== null
          ? { used: subscription.data.listings_used, cap: subscription.data.listing_cap }
          : null
      }
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
}

// What happened when a save got part-way: the listing exists (so the form
// must NOT offer to create it again), but something after the POST didn't.
type Outcome = {
  listingId: string | number;
  title: string;
  message: string;
  showPlans: boolean;
};

function StepperForm({
  listingId,
  initialValues,
  existingPhotos,
  liveLimit,
  onSuccess,
  onCancel,
}: {
  listingId?: string | number;
  initialValues: ListingFormValues;
  existingPhotos: ManagedPhoto[];
  liveLimit: { used: number; cap: number } | null;
  onSuccess?: (listingId?: string | number) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const params = useParams<{ user: string }>();
  const userId = params.user;
  const isEdit = listingId !== undefined;
  const { data: me } = useMe();
  const emailUnverified = me?.is_verified === false;

  const form = useForm<ListingFormValues, unknown, ListingFormOutput>({
    resolver: zodResolver(listingFormSchema),
    defaultValues: initialValues,
    // Check a field when it loses focus, then live as it's corrected —
    // so an error from Next disappears the moment it's fixed.
    mode: "onTouched",
  });

  const [step, setStep] = useState(0);
  // Furthest step reached — in create mode the step row only lets you
  // jump back to steps you've already been through.
  const [maxReached, setMaxReached] = useState(isEdit ? REVIEW_STEP : 0);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<null | "draft" | "submit" | "upgrade" | "save">(null);
  const [saveError, setSaveError] = useState<ReactNode>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Once the POST has created the listing, never create it again (a
  // retry after a failed photo upload or submit must reuse this id).
  const createdIdRef = useRef<string | number | null>(null);

  const createMutation = useApiCreate("listings");
  const updateMutation = useApiUpdate("listings");
  const invalidate = useApiInvalidate();
  const { submit: submitForReview } = useSubmitForReview();

  const liveLimitReached = liveLimit !== null && liveLimit.used >= liveLimit.cap;

  // --- Step movement -------------------------------------------------

  const topRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // New step: back to the top of the drawer/page, and move focus to the
    // step's heading so keyboard and screen-reader users land on it.
    topRef.current?.scrollIntoView({ block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function goTo(target: number) {
    setStep(target);
    setMaxReached((m) => Math.max(m, target));
    setSaveError(null);
  }

  async function validateStep(index: number, focus: boolean) {
    const fields = STEPS[index].fields;
    if (fields.length === 0) return true;
    const valid = await form.trigger(fields as ListingFieldName[], { shouldFocus: focus });
    if (!valid) {
      // In "onTouched" mode react-hook-form only re-checks a field as it
      // changes once it has been touched (blurred). Errors raised here by
      // Next would otherwise sit there, stale, until the landlord leaves
      // the field — even after picking "1 year" or typing the city. So
      // mark the step's fields touched: from now on they re-check live.
      for (const name of fields) {
        form.setValue(name, form.getValues(name), { shouldTouch: true });
      }
    }
    return valid;
  }

  async function next() {
    if (await validateStep(step, true)) goTo(step + 1);
  }

  // Jumping forward validates every step on the way and stops at the
  // first one with a problem; jumping back is always allowed.
  async function jumpTo(target: number) {
    if (target <= step) {
      goTo(target);
      return;
    }
    for (let s = step; s < target; s++) {
      if (!(await validateStep(s, s === step))) {
        goTo(s);
        return;
      }
    }
    goTo(target);
  }

  function cancel() {
    if (onCancel) onCancel();
    // Closes the drawer by returning to the page underneath it (the
    // drawer only exists because the URL changed client-side), or acts
    // as a normal Back on the full-page fallback.
    else router.back();
  }

  function finish(savedId: string | number) {
    if (onSuccess) {
      onSuccess(savedId);
      return;
    }
    router.push(
      isEdit
        ? `/dashboard/${userId}/listings/${savedId}`
        : `/dashboard/${userId}/listings`,
    );
  }

  // --- Saving --------------------------------------------------------

  // Final-step buttons. handleSubmit validates EVERYTHING first; if a
  // step has a problem (e.g. edited back to empty), jump to it.
  function save(intent: "draft" | "submit" | "upgrade" | "save") {
    return form.handleSubmit(
      (values) => runSave(intent, values),
      (errors: FieldErrors<ListingFormValues>) => {
        const firstBad = STEPS.findIndex((s) => s.fields.some((f) => f in errors));
        if (firstBad >= 0) {
          goTo(firstBad);
          // Wait for the step to show before focusing its first error.
          window.setTimeout(() => {
            const field = STEPS[firstBad].fields.find((f) => f in errors);
            if (field) form.setFocus(field);
          }, 0);
        }
      },
    )();
  }

  async function runSave(
    intent: "draft" | "submit" | "upgrade" | "save",
    values: ListingFormOutput,
  ) {
    setBusy(intent);
    setSaveError(null);
    const payload = toPayload(values);

    try {
      if (isEdit) {
        try {
          await updateMutation.mutateAsync({ id: listingId, ...payload });
        } catch (err) {
          setSaveError(saveErrorText(err, "update"));
          return;
        }
        const photos = await uploadPhotos(listingId, files);
        void invalidate(["listings"]);
        if (!photos.ok) {
          setSaveError(
            `Your changes are saved, but the new photos didn't upload: ${photos.message} Save again to retry them.`,
          );
          return;
        }
        toast.success("Changes saved");
        finish(listingId);
        return;
      }

      // CREATE — POST once, even if this is a retry.
      let id = createdIdRef.current;
      if (id === null) {
        try {
          const saved = await createMutation.mutateAsync(payload);
          id = (saved as { id: string | number }).id;
          createdIdRef.current = id;
        } catch (err) {
          setSaveError(saveErrorText(err, "create", userId));
          return;
        }
      }

      const photos = await uploadPhotos(id, files);
      if (photos.ok) setFiles([]);
      // The grid and the plan card's numbers both changed.
      void invalidate(["listings", "payments"]);

      if (!photos.ok) {
        setOutcome({
          listingId: id,
          title: "Saved as a draft",
          message:
            intent === "submit"
              ? `Your photos didn't upload (${photos.message}), so it wasn't submitted for review. Add the photos from the listing, then submit it.`
              : `Your photos didn't upload (${photos.message}). Add them from the listing's edit form.`,
          showPlans: false,
        });
        return;
      }

      if (intent === "draft") {
        toast.success("Saved as a draft", {
          description: "Submit it for review whenever it's ready.",
        });
        finish(id);
        return;
      }

      if (intent === "upgrade") {
        toast.success("Saved as a draft", {
          description: "Upgrade your plan, then submit it for review from the listing.",
        });
        router.push(`/dashboard/${userId}/listings#subscription`);
        return;
      }

      // intent === "submit"
      const result = await submitForReview(id);
      if (result.ok) {
        toast.success("Submitted for review", {
          description: "paddy staff will visit and verify it before it goes live.",
        });
        finish(id);
        return;
      }
      setOutcome({
        listingId: id,
        title: "Saved as a draft, not submitted",
        message: submitFailureText(result),
        showPlans: result.code === "listing_limit_reached",
      });
    } finally {
      setBusy(null);
    }
  }

  // --- Render --------------------------------------------------------

  if (outcome) {
    return (
      <OutcomePanel
        outcome={outcome}
        onOpenListing={() => router.push(`/dashboard/${userId}/listings/${outcome.listingId}`)}
        onPlans={() => router.push(`/dashboard/${userId}/listings#subscription`)}
        onDone={() => finish(outcome.listingId)}
      />
    );
  }

  const actions = (
    <StepperActions
      step={step}
      isEdit={isEdit}
      busy={busy}
      liveLimitReached={liveLimitReached}
      onBack={() => goTo(step - 1)}
      onCancel={cancel}
      onNext={next}
      onSave={save}
    />
  );

  return (
    <FormProvider {...form}>
      <div ref={topRef} className="scroll-mt-20" />
      <DesktopActions>{actions}</DesktopActions>

      <form
        // Nothing submits this form directly — Enter in a field would
        // otherwise try to. Saving is only ever the final step's buttons.
        onSubmit={(e) => e.preventDefault()}
        noValidate
        className="flex flex-col gap-8"
      >
        <StepIndicator
          steps={STEPS}
          current={step}
          canVisit={(i) => i <= maxReached}
          onSelect={(i) => void jumpTo(i)}
        />

        {emailUnverified && !isEdit && <VerifyEmailNotice />}

        <div className="flex flex-col gap-8">
          <SectionHeading>
            <span ref={headingRef} tabIndex={-1} className="outline-none">
              {STEPS[step].label}
            </span>
          </SectionHeading>

          {/* Every step stays mounted (hidden when not current) so typed
              values, picked-photo previews and the Google map all survive
              Back/Next. */}
          <div hidden={step !== 0} className="flex flex-col gap-8">
            <PhotosSection
              files={files}
              onFilesChange={setFiles}
              listingId={listingId}
              existingPhotos={existingPhotos}
            />
            <BasicsSection />
            <AmenitiesSection />
          </div>
          <div hidden={step !== 1}>
            <LocationSection active={step === 1} />
          </div>
          <div hidden={step !== 2}>
            <PricingSection />
          </div>
          <div hidden={step !== 3}>
            <TourSection />
          </div>
          {step === REVIEW_STEP && (
            <div className="flex flex-col gap-6">
              {!isEdit && liveLimitReached && liveLimit && (
                <Notice tone="warning">
                  You&apos;re using all {liveLimit.cap} live listings on your plan
                  (published or in review), so this one can&apos;t be submitted yet.{" "}
                  <strong>Upgrade to submit</strong> saves it as a draft and takes you
                  to your plan options.
                </Notice>
              )}
              <ReviewStep
                files={files}
                existingPhotoUrls={existingPhotos
                  .map((p) => p.image)
                  .filter((u): u is string => Boolean(u))}
                onEditStep={(i) => goTo(i)}
              />
            </div>
          )}

          {saveError && (
            <Notice tone="error" role="alert">
              {saveError}
            </Notice>
          )}
        </div>

        {/* Phones: the actions stay reachable at the bottom of the screen. */}
        <div className="border-hairline sticky bottom-0 z-10 flex items-center gap-2 border-t bg-white py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          {actions}
        </div>
      </form>
    </FormProvider>
  );
}

// Desktop: into the drawer's header row (next to close/expand, where
// Figma 288:8254 puts its buttons), or — on the full-page fallback, where
// there's no drawer — a bar pinned under the dashboard's sticky header.
function DesktopActions({ children }: { children: ReactNode }) {
  const slot = useSideDrawerActionsSlot();
  const bar = <div className="hidden items-center gap-2 md:flex">{children}</div>;
  if (slot) return createPortal(bar, slot);
  return (
    <div className="sticky top-16 z-10 -mt-2 mb-6 hidden justify-end bg-white py-2 md:flex">
      {bar}
    </div>
  );
}

function StepperActions({
  step,
  isEdit,
  busy,
  liveLimitReached,
  onBack,
  onCancel,
  onNext,
  onSave,
}: {
  step: number;
  isEdit: boolean;
  busy: null | "draft" | "submit" | "upgrade" | "save";
  liveLimitReached: boolean;
  onBack: () => void;
  onCancel: () => void;
  onNext: () => void;
  onSave: (intent: "draft" | "submit" | "upgrade" | "save") => void;
}) {
  const saving = busy !== null;
  const isReview = step === REVIEW_STEP;

  return (
    <>
      {step === 0 ? (
        <PaddyButton variant="secondary" size="xl" onClick={onCancel} disabled={saving}>
          Cancel
        </PaddyButton>
      ) : (
        <PaddyButton
          variant="secondary"
          size="xl"
          leftIcon={ArrowLeft}
          onClick={onBack}
          disabled={saving}
          aria-label="Back"
          // Phones on the last step: icon only, so three buttons fit.
          className={cn(isReview && !isEdit && "max-md:[&>span>span]:sr-only max-md:px-3")}
        >
          <span>Back</span>
        </PaddyButton>
      )}

      {!isReview && (
        <PaddyButton
          size="xl"
          rightIcon={ArrowRight}
          onClick={onNext}
          className="max-md:flex-1"
        >
          Next
        </PaddyButton>
      )}

      {isReview && isEdit && (
        <PaddyButton
          size="xl"
          isLoading={busy === "save"}
          onClick={() => onSave("save")}
          className="max-md:flex-1"
        >
          Save changes
        </PaddyButton>
      )}

      {isReview && !isEdit && (
        <>
          <PaddyButton
            variant="secondary"
            size="xl"
            isLoading={busy === "draft"}
            disabled={saving && busy !== "draft"}
            onClick={() => onSave("draft")}
            className="max-md:flex-1"
          >
            Save as draft
          </PaddyButton>
          {liveLimitReached ? (
            <PaddyButton
              size="xl"
              isLoading={busy === "upgrade"}
              disabled={saving && busy !== "upgrade"}
              onClick={() => onSave("upgrade")}
              className="max-md:flex-1"
            >
              Upgrade to submit
            </PaddyButton>
          ) : (
            <PaddyButton
              size="xl"
              isLoading={busy === "submit"}
              disabled={saving && busy !== "submit"}
              onClick={() => onSave("submit")}
              className="max-md:flex-1"
            >
              Submit for review
            </PaddyButton>
          )}
        </>
      )}
    </>
  );
}

// Shown instead of step 1 when a Free landlord already holds 10 listings
// (the backend would refuse the POST with listing_total_limit_reached).
function TotalLimitScreen({
  total,
  cap,
  onCancel,
}: {
  total: number;
  cap: number;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const params = useParams<{ user: string }>();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <PaddyBadge state="warning" rounded>
        {total} of {cap} listings
      </PaddyBadge>
      <SectionHeading>You&apos;ve reached the Free plan&apos;s listing limit</SectionHeading>
      <p className="text-subtle-foreground text-sm leading-6">
        The Free plan holds {cap} listings in total — drafts, rejected and paused
        listings count; archived and leased ones don&apos;t. Archive a listing you
        no longer need, or upgrade your plan to add more.
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <PaddyButton
          variant="secondary"
          size="xl"
          onClick={() => (onCancel ? onCancel() : router.back())}
        >
          Back to listings
        </PaddyButton>
        <PaddyButton
          size="xl"
          onClick={() => router.push(`/dashboard/${params.user}/listings#subscription`)}
        >
          See plans
        </PaddyButton>
      </div>
    </div>
  );
}

function OutcomePanel({
  outcome,
  onOpenListing,
  onPlans,
  onDone,
}: {
  outcome: Outcome;
  onOpenListing: () => void;
  onPlans: () => void;
  onDone: () => void;
}) {
  return (
    <div role="status" className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
      <PaddyBadge state="neutral" rounded>
        Draft
      </PaddyBadge>
      <SectionHeading>{outcome.title}</SectionHeading>
      <p className="text-subtle-foreground text-sm leading-6">{outcome.message}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <PaddyButton variant="secondary" size="xl" onClick={onOpenListing}>
          Open listing
        </PaddyButton>
        {outcome.showPlans ? (
          <PaddyButton size="xl" onClick={onPlans}>
            See plans
          </PaddyButton>
        ) : (
          <PaddyButton size="xl" onClick={onDone}>
            Done
          </PaddyButton>
        )}
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
  role,
}: {
  tone: "warning" | "error";
  children: ReactNode;
  role?: "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "rounded-lg border px-4 py-3 text-[13px] leading-5",
        tone === "warning"
          ? "border-paddy-yellow-200 bg-paddy-yellow-50 text-paddy-yellow-900"
          : "border-paddy-red-100 bg-paddy-red-50 text-paddy-red-800",
      )}
    >
      {children}
    </div>
  );
}

// Creating a listing needs a verified email (backend
// accounts/permissions.py). The dashboard's own banner is hidden behind
// the drawer, so say it here — before the landlord fills in five steps.
function VerifyEmailNotice() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function resend() {
    setState("sending");
    try {
      await apiPost("/accounts/verify-email/resend/");
      setState("sent");
    } catch (err) {
      setState("idle");
      toast.error(errorMessage(err, "Could not send the email. Try again shortly."));
    }
  }
  return (
    <Notice tone="warning">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MailWarning className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Verify your email to save this listing. You can fill it in now — we
          sent you a link.
        </span>
        <PaddyButton
          size="sm"
          variant="secondary"
          onClick={resend}
          isLoading={state === "sending"}
          disabled={state === "sent"}
        >
          {state === "sent" ? "Email sent" : "Resend email"}
        </PaddyButton>
      </span>
    </Notice>
  );
}

// --- Helpers ---------------------------------------------------------

// POST /listings/<id>/photos/ with every picked file under "images"
// (request.FILES.getlist('images') on the backend). authedFetch sends
// FormData with NO Content-Type, so the browser writes the multipart
// boundary itself, and refreshes an expired token once.
async function uploadPhotos(
  listingId: string | number,
  files: File[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (files.length === 0) return { ok: true };
  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));
  try {
    const res = await authedFetch(`/listings/${listingId}/photos/`, {
      method: "POST",
      formData,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: body.error ?? `upload failed (HTTP ${res.status}).` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: errorMessage(err, "a network error.") };
  }
}

function saveErrorText(err: unknown, action: "create" | "update", userId?: string): ReactNode {
  if (err instanceof ApiError) {
    if (err.code === "email_not_verified") {
      return "Verify your email first — use Resend email at the top of the form if the link hasn't arrived. Your details are still here.";
    }
    if (err.code === "listing_total_limit_reached") {
      return (
        <>
          The Free plan holds 10 listings in total, and you&apos;re at the limit, so
          this one wasn&apos;t saved. Archive a listing you no longer need, or{" "}
          <a className="font-medium underline" href={`/dashboard/${userId}/listings#subscription`}>
            upgrade your plan
          </a>
          .
        </>
      );
    }
    if (err.statusCode === 400) {
      return `Something in the form wasn't accepted: ${err.message}`;
    }
  }
  return action === "create"
    ? `Couldn't save the listing: ${errorMessage(err, "please try again.")}`
    : `Couldn't save your changes: ${errorMessage(err, "please try again.")}`;
}

function submitFailureText(result: Extract<SubmitForReviewResult, { ok: false }>): string {
  if (result.code === "listing_limit_reached") {
    const cap = result.listingCap;
    return `Your plan allows ${cap ?? "a limited number of"} live listings (published or in review), and they're all in use. Upgrade your plan or archive a live listing, then submit this one from its preview.`;
  }
  if (result.code === "email_not_verified") {
    return "Verify your email first, then submit it for review from the listing's preview.";
  }
  return `It couldn't be submitted for review (${result.message}). You can submit it from the listing's preview.`;
}
