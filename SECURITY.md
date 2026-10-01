# Security Policy

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull
requests.**

Report them privately through GitHub's private vulnerability reporting instead:
open the repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- what the problem is and where it is (file, endpoint or page);
- the steps to reproduce it;
- the impact you think it has (for example: data exposure, payment bypass,
  account takeover).

You'll get an acknowledgement as soon as possible. Please give us reasonable time
to fix the issue before telling anyone else about it.

## Scope

In scope: this repository's code, meaning the Django backend (`backend/`) and the
Next.js frontend (`frontend/`).

Out of scope: third-party services the project uses (Paystack, Google, Cloudflare,
Resend). Please report problems with those services to the provider directly.

## Please don't

- access, change or delete other people's data;
- run automated scans or load tests against live paddy services;
- make real payments or try to get around payments on live services.

Testing against your own local copy of the project is the safest way to
investigate.
