

import { z } from "zod";

const emailSchema = z.email({ error: "Enter a valid email" })

const passwordSchema = z.string().min(8, { error: "Must be at least 8 characters" }).regex(/[A-Z]/, { message: "Must contain at least one uppercase letter" }).regex(/[0-9]/, { message: "Must contain at least one number" }).regex(/[^a-zA-Z0-9]/, { message: "Must contain at least one special character" })


export const signUpSchema = z.object({
    firstName: z.string().min(1, { error: "First name is required" }),
    lastName: z.string().min(1, { error: "Last name is required" }),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, { error: "Please confirm your password" }),
    // No `role` field: role selection moved out of signup to the
    // post-auth /onboarding screen (POST /accounts/onboarding/), and
    // the backend now accepts registration without a role. Keeping a
    // required role here would fail validation on every submit since
    // the form no longer renders a role picker.
}).refine((data) => data.password === data.confirmPassword, {
    error: "Passwords don't match",
    path: ["confirmPassword"],
})

export type SignUpFormValues = z.input<typeof signUpSchema>

export const signInSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, { error: "Password is required" }),
    // Deliberately NOT passwordSchema (the signup complexity rules) —
    // login should only check "something was typed," never re-enforce
    // uppercase/number/special-character rules. A real password
    // created before a rule existed (or a superuser created via
    // `createsuperuser`, which enforces no complexity at all) must
    // still be able to log in — this was flagged as a risk when
    // signInSchema was first written, and it reused passwordSchema
    // anyway; this is that bug actually surfacing.
    rememberMe: z.boolean().optional()
})

export type SignInFormValue = z.infer<typeof signInSchema>

// Request-reset step (/reset-password without ?uid&?token):
// email only. Backend always returns 200, never leaks existence.
export const resetPasswordSchema = z.object({
    email: emailSchema,
})

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

// Confirm-reset step (/reset-password?uid=<uid>&token=<token>):
// mirrors signup's password + confirm pattern. Complexity reuses
// passwordSchema for signup-consistent client feedback; the backend
// re-validates server-side (Django AUTH_PASSWORD_VALIDATORS) anyway.
export const confirmResetPasswordSchema = z.object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, { error: "Please confirm your password" }),
}).refine((data) => data.newPassword === data.confirmPassword, {
    error: "Passwords don't match",
    path: ["confirmPassword"],
})

export type ConfirmResetPasswordFormValues = z.infer<typeof confirmResetPasswordSchema>

// Post-auth onboarding (/onboarding): one-time role pick for every
// auth path. Required — the form blocks submit until a card is picked
// (RoleCard writes "landlord" | "renter" via Controller).
export const onboardingSchema = z.object({
    role: z.enum(["renter", "landlord"], {
        error: "Pick how you'll use paddy",
    }),
})

export type OnboardingFormValues = z.infer<typeof onboardingSchema>