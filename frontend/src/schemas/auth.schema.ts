

import { z } from "zod";

const emailSchema = z.email({ error: "Enter a valid email" })

const passwordSchema = z.string().min(8, { error: "Must be at least 8 characters" }).regex(/[A-Z]/, { message: "Must contain at least one uppercase letter" }).regex(/[0-9]/, { message: "Must contain at least one number" }).regex(/[^a-zA-Z0-9]/, { message: "Must contain at least one special character" })


export const signUpSchema = z.object({
    firstName: z.string().min(1, { error: "First name is required" }),
    lastName: z.string().min(1, { error: "Last name is required" }),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, { error: "Please confirm your password" }),
    role: z.union([z.enum(["landlord", "renter"]), z.literal("")]).refine((val) => val !== "", {
        error: "Please select your account type, this choice is permanent",
    }),
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