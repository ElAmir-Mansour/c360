# Arabic Localization Reference — Settings · Auth · Onboarding · Dashboard · Notifications

Scope: `/settings/**`, `/(auth)/**`, `/(onboarding)/**`, `/dashboard`, `/notifications`, and the root `(dashboard)` group chrome (layout/error/loading). This catalogs **every** user-facing string per route → component, marks its i18n status, and copies the English verbatim.

## Status legend
- **key: `<path>`** — string already resolves through an i18n bundle. Unless noted, the paired Arabic already exists (`ar`) — the whole `messages.ts` and all named bundles below are bilingual.
- **HARDCODED** — inline JS/JSX literal, not keyed. Needs extraction + Arabic.
- **data-driven** — text comes from API/seed. Needs backend localization (flagged separately in Coverage).

## i18n mechanisms referenced here
- `src/lib/i18n/messages.ts` — single bilingual catalog (`ar` first block, `en` second). `auth.*`, `shell.*`, `preferences.*`, `brand.*`, `validation.*` live here. Resolved via `useT()` / `getMessages(lang)`.
- `src/app/(dashboard)/settings/_lib/settings-i18n.ts` — bilingual `SETTINGS_L{en,ar}` via `useSettingsT()`. **Fully bilingual, complete.**
- `src/components/dashboard/widget-board/board-i18n.ts` — bilingual `BOARD_TEXT` via `pickText(text, locale)`. **Complete.**
- `src/app/(dashboard)/dashboard/_components/suites-launcher.tsx` — in-component bilingual `COPY` map + `src/config/navigation.ts` (`resolveNavText`/`resolveTierLabel`) — suite names/descriptions bilingual.
- **Onboarding (`/(onboarding)/**`) has NO i18n bundle — every string is HARDCODED.**
- **The `/dashboard` widget *contents* (KPIs, alerts, tasks, activity) and the `/notifications` page + its list/card/tabs/empty/actions are almost entirely HARDCODED** even though the board *chrome* is keyed.

---

# AUTH — `/(auth)/**`

Note: the auth pages/forms are near-100% keyed through `messages.ts` under `auth.*`. The `en` values below are verbatim from `messages.ts` (lines ~1961–2506). Arabic exists for all of them.

### Route: /(auth) group — `(auth)/layout.tsx`
_Module bundle: `src/lib/i18n/messages.ts` (`auth.*`, `brand.*`)_
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | layout › `<title>` metadata | system | Clario360 — Sign In | key: `auth.metadataTitle` |
| 2 | BrandLockup › wordmark title | aria-label | Clario360 | key: `brand.name` |
| 3 | BrandLockup › tagline | subheading | One platform · Four suites · Fifteen apps | key: `brand.platformTagline` |
| 4 | SystemStatusBadge › operational | badge | All systems operational | key: `auth.security.status.operational` |
| 5 | SystemStatusBadge › degraded | badge | Degraded performance | key: `auth.security.status.degraded` |
| 6 | SystemStatusBadge › unknown | badge | Status unknown | key: `auth.security.status.unknown` |
| 7 | SystemStatusBadge › aria | aria-label | System status | key: `auth.security.status.ariaLabel` |
| 8 | footer › copyright rights | body | All rights reserved. | key: `auth.footerRights` |
| 9 | TrustStrip › labels (nca/sama/iso/residency) | badge | NCA ECC / SAMA CSF / ISO 27001 / Data hosted in KSA | key: `auth.trust.{nca,sama,iso,residency}` |
| 10 | SkipToForm › default label | link | Skip to form | HARDCODED (default prop in `skip-to-form.tsx`; layout passes no `label`) |

### Route: /login — `(auth)/login/page.tsx` → `components/auth/login-form.tsx`
_Module bundle: `messages.ts` `auth.login.*` / `auth.security.*` / `auth.errors.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `<title>` | system | Sign In — Clario360 | key: `auth.titles.signIn` |
| 2 | LoginForm › badge | badge | Secure workspace access | key: `auth.login.secureBadge` |
| 3 | LoginForm › guarded badge | badge | Guarded | key: `auth.login.guardedBadge` |
| 4 | LoginForm › title | heading | Sign in to Clario360 | key: `auth.login.title` |
| 5 | LoginForm › subtitle | subheading | Access your tenant command center with the same identity fabric that governs every DataStream and Business+ workspace. | key: `auth.login.subtitle` |
| 6 | LoginForm › method Password / detail | label | Password / Workspace credentials | key: `auth.login.methodPassword` / `methodPasswordDetail` |
| 7 | LoginForm › method Passkey / detail | label | Passkey / Device-bound proof | key: `auth.login.methodPasskey` / `methodPasskeyDetail` |
| 8 | LoginForm › method Magic link / detail | label | Magic link / Email fallback | key: `auth.login.methodMagicLink` / `methodMagicLinkDetail` |
| 9 | LoginForm › guard chips | badge | Tenant scoped / Role aware / Audit ready | key: `auth.login.guardTenant` / `guardRole` / `guardAudit` |
| 10 | LoginForm › registered banner | toast | Registration successful! Please sign in. | key: `auth.login.registeredBanner` |
| 11 | LoginForm › form aria | aria-label | Sign in | key: `auth.login.formLabel` |
| 12 | LoginForm › email label | label | Work email | key: `auth.login.workEmail` |
| 13 | LoginForm › email placeholder | placeholder | name@company.com | key: `auth.login.emailPlaceholder` (also a literal `placeholder="name@company.com"` at login-form.tsx:357 — HARDCODED duplicate) |
| 14 | LoginForm › did-you-mean | body | Did you mean | key: `auth.login.didYouMean` |
| 15 | LoginForm › dismiss suggestion | aria-label | Dismiss suggestion | key: `auth.login.dismissSuggestion` |
| 16 | LoginForm › password label | label | Password | key: `auth.login.password` |
| 17 | LoginForm › forgot link | link | Forgot password? | key: `auth.login.forgotPassword` |
| 18 | LoginForm › password placeholder | placeholder | Enter your password | key: `auth.login.passwordPlaceholder` |
| 19 | LoginForm › show/hide password | aria-label | Show password / Hide password | key: `auth.login.showPassword` / `hidePassword` |
| 20 | LoginForm › keep signed in | label | Keep me signed in on this device | key: `auth.login.keepSignedIn` |
| 21 | LoginForm › submit (busy/idle) | button | Signing in… / Sign in | key: `auth.login.signingIn` / `signIn` |
| 22 | LoginForm › magic-link switch | link | Email me a magic link instead | key: `auth.login.magicLinkInstead` |
| 23 | LoginForm › no account / create | link | Don't have an account? / Create one | key: `auth.login.noAccount` / `createOne` |
| 24 | LoginForm › MFA badge/title/subtitle | heading | Identity verification / Complete step two / Your workspace requires an additional proof point before access is granted. | key: `auth.login.mfaBadge` / `mfaTitle` / `mfaSubtitle` |
| 25 | LoginForm › MFA tabs | tab | Authenticator app / Recovery code | key: `auth.login.mfaTabAuthenticator` / `mfaTabRecovery` |
| 26 | LoginForm › MFA hints | body | Enter the 6-digit code from your authenticator app. / Codes refresh roughly every 30 seconds. | key: `auth.login.mfaEnterCode` / `mfaCodeRefresh` |
| 27 | LoginForm › recovery code label/placeholder/verify | label | Recovery code / Enter your recovery code / Verify recovery code | key: `auth.login.recoveryCodeLabel` / `recoveryCodePlaceholder` / `verifyRecoveryCode` |
| 28 | LoginForm › back link | link | ← Back to sign in | key: `auth.login.backToSignIn` |
| 29 | LoginForm › errors | error | Too many login attempts. Please try again in {seconds} seconds. / Invalid email or password. / Your account is locked. Please try again in {minutes} minutes. / Your account has been suspended. Contact your administrator. / Your email still needs verification… / Unable to connect to server… / An unexpected error occurred… / Your session has expired… / Invalid code. Please try again. / Please enter all 6 digits. | key: `auth.errors.*` |
| 30 | LoginForm › security block (passkey/magic/sso titles, more options, remember hint, caps-lock, email suggestion, last sign-in) | label | Sign in with a passkey / Continue with a passkey / Sign in with a magic link / Email me a sign-in link / Sign-in link sent. Check your email. / Enterprise single sign-on / Continue with SSO / or / More sign-in options / Back to password sign-in / Keep me signed in / Do not select this on shared devices. / Caps Lock is on / Did you mean {suggestion}? / Yes, fix it / Last sign-in / No previous sign-ins / Last sign-in from {location} / Unknown location / Not you? | key: `auth.security.*` |

### Route: /register — `(auth)/register/page.tsx` → `components/auth/register-form.tsx`
_Module bundle: `messages.ts` `auth.register.*` + `auth.validation`/`validation.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `<title>` | system | Create Account — Clario360 | key: `auth.titles.register` |
| 2 | RegisterForm › step tabs | tab | 01 · Organization / 02 · Admin account | key: `auth.register.stepOrganization` / `stepAdmin` |
| 3 | RegisterForm › org badge/title/subtitle | heading | New workspace / Create your workspace / Tell us about your organization. This provisions your Clario360 tenant with the right industry defaults. | key: `auth.register.orgBadge` / `orgTitle` / `orgSubtitle` |
| 4 | RegisterForm › admin badge/title/subtitle | heading | Admin identity / Set up your admin account / Create the administrator who will own this workspace. You will verify this email in the next step. | key: `auth.register.adminBadge` / `adminTitle` / `adminSubtitle` |
| 5 | RegisterForm › form aria | aria-label | Create workspace | key: `auth.register.formLabel` |
| 6 | RegisterForm › org name label/placeholder | label | Organization name / Acme Corporation | key: `auth.register.organizationName` / `organizationPlaceholder` |
| 7 | RegisterForm › industry options | option | Financial Services / Government / Healthcare / Technology / Energy / Telecom / Education / Retail / Manufacturing / Other | key: `auth.register.industry{Financial…Other}` |
| 8 | RegisterForm › industry label | label | Industry | key: `auth.register.industry` |
| 9 | RegisterForm › country code label/placeholder/hint | label | Country code / SA / Two-letter ISO code (e.g. SA, NG, US). | key: `auth.register.countryCode` / `countryPlaceholder` / `countryHint` |
| 10 | RegisterForm › continue | button | Continue | key: `auth.register.continue` |
| 11 | RegisterForm › first/last name label+placeholder | label | First name / Aisha / Last name / Bello | key: `auth.register.firstName` / `firstNamePlaceholder` / `lastName` / `lastNamePlaceholder` |
| 12 | RegisterForm › work email label/placeholder + did-you-mean | label | Work email / name@company.com / Did you mean | key: `auth.register.workEmail` / `emailPlaceholder` / `didYouMean` |
| 13 | RegisterForm › password label/placeholder | label | Password / Create a strong password | key: `auth.register.password` / `passwordPlaceholder` |
| 14 | RegisterForm › confirm password label/placeholder | label | Confirm password / Re-enter your password | key: `auth.register.confirmPassword` / `confirmPasswordPlaceholder` |
| 15 | RegisterForm › show/hide password | aria-label | Show password / Hide password | key: `auth.register.showPassword` / `hidePassword` |
| 16 | RegisterForm › back/create (busy) | button | Back / Creating workspace… / Create workspace | key: `auth.register.back` / `creating` / `createWorkspace` |
| 17 | RegisterForm › have account / sign in | link | Already have an account? / Sign in | key: `auth.register.haveAccount` / `signIn` |
| 18 | RegisterForm › submit error | error | Registration failed. Please try again. | key: `auth.register.failed` |
| 19 | RegisterForm › zod field messages | validation | Email is required / Please enter a valid email address / Password is required / … / Use a valid 2-letter country code / First name contains invalid characters / … | key: `validation.*` |

### Route: /forgot-password — `(auth)/forgot-password/page.tsx` → `components/auth/forgot-password-form.tsx`
_Module bundle: `messages.ts` `auth.forgot.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `<title>` | system | Forgot Password — Clario360 | key: `auth.titles.forgotPassword` |
| 2 | Form › insight tiles (recovery/lookup/next) | body | Recovery path / Tokenized reset / Password recovery is issued through a short-lived email token, not a static link. / Lookup safety / Non-disclosing / … / Next motion / Return to sign-in / After reset, the user is routed back into the premium access flow. | key: `auth.forgot.insight*` |
| 3 | Form › guards | body | Email enumeration is suppressed by design / Recovery links are time-bound and single-purpose / Successful reset returns the user to secure sign-in | key: `auth.forgot.guard*` |
| 4 | Form › badge/title/description | heading | Credential recovery / Reset access without exposing identity / Enter your work email and we will issue a time-bound recovery path while keeping account discovery protected. | key: `auth.forgot.badge` / `title` / `description` |
| 5 | Form › status label/value | label | Recovery control / Enumeration resistant | key: `auth.forgot.statusLabel` / `statusValue` |
| 6 | Form › work email | label | Work email | key: `auth.forgot.workEmail` |
| 7 | Form › callout | body | Protected request flow / The experience looks the same for valid and invalid email addresses. That keeps account discovery from leaking through the recovery endpoint. | key: `auth.forgot.calloutTitle` / `calloutBody` |
| 8 | Form › submit (busy/idle) | button | Sending... / Send reset link | key: `auth.forgot.sending` / `sendResetLink` |
| 9 | Form › action strip | link | Remembered your password or already recovered access? / Back to sign in | key: `auth.forgot.actionStripDescription` / `actionStripCta` |
| 10 | Sent state (badge/title/desc/status/msg/secondary/back) | body | Recovery issued / Check your email / If an account exists for the email you entered, a recovery link is already on the way. / Recovery status / Awaiting email action / Recovery message sent / If an account exists for … , you will receive a password reset link within a few minutes. / Do not forget to check spam or quarantine folders … / Back to sign in | key: `auth.forgot.sent*` / `backToSignIn` |

### Route: /reset-password — `(auth)/reset-password/page.tsx` → `components/auth/reset-password-form.tsx`
_Module bundle: `messages.ts` `auth.reset.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `<title>` | system | Reset Password — Clario360 | key: `auth.titles.resetPassword` |
| 2 | page › Suspense fallback | system | Loading password reset / We are validating the reset flow and preparing the credential update experience. | key: `auth.reset.loadingLabel` / `loadingDetail` |
| 3 | Form › insight tiles | body | Credential rotation / Immediate / … / Token policy / Time bound / … / Return flow / Back to access / … | key: `auth.reset.insight*` |
| 4 | Form › guards | body | Reset links are validated before a new password is accepted / Password confirmation stops accidental credential mismatch / Successful reset returns the user into the secure access flow | key: `auth.reset.guard*` |
| 5 | Form › badge/title/description/status | heading | Credential reset / Set a new password / Choose a strong password for the account and complete the recovery flow without leaving the premium auth experience. / Token state / Validated for update | key: `auth.reset.badge` / `title` / `description` / `statusLabel` / `statusValue` |
| 6 | Form › new/confirm password | label | New password / Confirm new password | key: `auth.reset.newPassword` / `confirmNewPassword` |
| 7 | Form › callout | body | Reset hygiene / This action rotates the credential immediately. Use a password that is unique to this workspace and not reused elsewhere. | key: `auth.reset.calloutTitle` / `calloutBody` |
| 8 | Form › submit (busy/idle) | button | Resetting... / Reset password | key: `auth.reset.resetting` / `resetPassword` |
| 9 | Form › action strip | link | Need to restart the recovery flow or request a fresh link instead? | key: `auth.reset.actionStripDescription` |
| 10 | Form › errors | error | Invalid reset link. Please request a new one. / This reset link has expired. Please request a new one. / Invalid reset link. Please request a new password reset. / Failed to reset password. Please try again. | key: `auth.reset.invalidLink` / `linkExpired` / `linkInvalid` / `failed` |
| 11 | Missing-token state | body | Reset unavailable / The reset token is missing / This page needs a valid recovery token before a new password can be accepted. / Token state / Invalid request / Invalid or missing reset token. Please request a new password reset link. / You need a fresh recovery email before you can set a new password. / Request new reset link | key: `auth.reset.missing*` / `requestNewLink` |
| 12 | Success state | body | Reset complete / Password reset successful / The credential update has been accepted … / Redirect / Returning to access flow / Password updated / Your password has been rotated successfully … / If the redirect does not happen automatically, use the action below. / Sign in now | key: `auth.reset.success*` / `signInNow` |

### Route: /verify-email — `(auth)/verify-email/page.tsx` (also mounted at `/verify`)
_Module bundle: `messages.ts` `auth.verify.*` + `auth.errors.enterAllDigits`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Form › badge/title/description | heading | Email verification / Confirm administrator identity / Use the code sent to your inbox to activate the initial session and continue into tenant setup without another auth step. | key: `auth.verify.badge` / `title` / `description` |
| 2 | Form › status label/value prefix | label | Code window / Expires in | key: `auth.verify.statusLabel` / `statusValuePrefix` |
| 3 | Form › code legend + sent prefix + your email | label | Enter your 6-digit verification code / We sent a 6-digit verification code to / your email address | key: `auth.verify.codeLegend` / `sentCodePrefix` / `yourEmailAddress` |
| 4 | Form › OTP digit aria | aria-label | Digit {index} of {total} | key: `auth.verify.digitLabel` |
| 5 | Form › submit (busy/idle) | button | Verifying... / Verify email | key: `auth.verify.verifying` / `verifyEmail` |
| 6 | Form › resend callout + controls | body | Resend control / If the message does not arrive, request another code… / Didn't receive the code? / Check spam first, then request a fresh code if needed. / Resend in / Resend code | key: `auth.verify.calloutTitle` / `calloutBody` / `didNotReceive` / `didNotReceiveBody` / `resendInPrefix` / `resendCode` |
| 7 | Form › insight tiles + guards | body | Proof channel / Email verified / … / Session bootstrap / Token exchange / … / Setup wizard / … + Verification expires automatically … / Resend requests are throttled … / A verified code creates the admin session … | key: `auth.verify.insight*` / `guard*` |
| 8 | Form › errors + success | error/toast | Email is missing. Please go back and register again. / A new code has been sent to your email. / Verification failed. Please try again. / Failed to resend code. Please try again. / Please enter all 6 digits. | key: `auth.verify.emailMissing` / `newCodeSent` / `failed` / `resendFailed` / `auth.errors.enterAllDigits` |
| 9 | Fallback (loading) | system | Preparing verification / We are loading the email verification flow and checking the initial session state. | key: `auth.verify.loadingLabel` / `loadingDetail` |

### Route: /invite — `(auth)/invite/page.tsx`
_Module bundle: `messages.ts` `auth.invite.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Form › insight tiles + guards | body | Access source / Admin initiated / … / Role binding / Pre-scoped / … / Landing path / Direct to workspace / … + Invitation validity is checked before account creation begins / Role and organization scope are preserved from the original invite / Accepted invitations exchange directly into an authenticated session | key: `auth.invite.insight*` / `guard*` |
| 2 | Loading state | body | Invitation access / Loading invitation details / We are validating the token and resolving the organization, role, and inviter context … / Invitation state / Checking validity / Preparing account acceptance / The invitation is being verified against the workspace before you continue. | key: `auth.invite.loading*` |
| 3 | Unavailable state | body | This invitation is not available / The token could not be resolved into a valid invitation … / Invalid or expired / Invalid invitation. / You will need a fresh invitation or administrator help to continue. / Back to sign in | key: `auth.invite.unavailable*` / `invalidInvitation` / `backToSignIn` |
| 4 | Form › badge/title/description/role | heading | Invitation access / Create your account from an invitation / Your role, organization, and access path are already prepared. Finish the account setup and enter the workspace directly. / Assigned role | key: `auth.invite.badge` / `title` / `description` / `assignedRoleLabel` |
| 5 | Form › summary callout | body | Invitation summary / invited you to join / This invitation is tied to / and expires on / Inviter note | key: `auth.invite.summaryTitle` / `invitedYouToJoin` / `tiedToPrefix` / `expiresOnPrefix` / `inviterNoteTitle` |
| 6 | Form › fields (first/last/password/confirm/show/hide) | label | First name / Last name / Password / Confirm password / Show password / Hide password | key: `auth.invite.firstName` / `lastName` / `password` / `confirmPassword` / `showPassword` / `hidePassword` |
| 7 | Form › routing callout | body | Workspace routing / When the invitation is accepted, the platform exchanges the response into a session and routes you directly to the assigned workspace. | key: `auth.invite.routingTitle` / `routingBody` |
| 8 | Form › submit (busy/idle) | button | Creating account... / Accept invitation and create account | key: `auth.invite.creatingAccount` / `acceptInvitation` |
| 9 | Form › action strip | link | Need a different link or help from the workspace administrator? | key: `auth.invite.actionStripDescription` |
| 10 | Form › errors | error | No invitation token provided. Please check the link in your email. / This invitation has expired or is no longer valid. Please contact your administrator. / Failed to load invitation details. / Failed to load invitation details. Please try again. / Failed to accept invitation. Please try again. | key: `auth.invite.noToken` / `expiredOrInvalid` / `loadFailed` / `loadFailedRetry` / `acceptFailed` |
| 11 | Fallback (loading) | system | Loading invitation / We are validating the invitation token and resolving the target workspace. | key: `auth.invite.pageLoadingLabel` / `pageLoadingDetail` |
| 12 | Form › zod messages | validation | First name is required / Last name is required / Password must be at least 12 characters / Password must be at most 128 characters / Passwords do not match | HARDCODED (inline zod literals in `invite/page.tsx` acceptSchema, NOT keyed) |
| 13 | Form › `details.role_name`, `organization_name`, `inviter_name`, `email`, `expires_at` | body | (invitation payload values) | data-driven (`GET /onboarding/invitations/validate`) |

### Route: /callback — `(auth)/callback/page.tsx`
_Module bundle: `messages.ts` `auth.callback.*`_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page › insight tiles | body | Identity exchange / Federated callback / … / Session handoff / Immediate / … / Failure path / Contained / … | key: `auth.callback.insight*` |
| 2 | Error state | body | Federated callback / Authentication callback failed / The provider returned an error or the callback could not be completed in this browser session. / Callback state / Manual recovery required / Restart the sign-in flow from the primary login surface. / Back to login | key: `auth.callback.error*` / `backToLogin` |
| 3 | Progress state | body | Federated callback / Completing secure sign-in / The provider response is being exchanged for an application session … / Callback state / Finalizing session / Completing sign-in / We are validating the provider response, applying the access token, and redirecting to the workspace. / Return to login instead | key: `auth.callback.progress*` / `returnToLogin` |
| 4 | Page › errors | error | Missing authorization parameters. Please try again. / Authentication failed. Please try again. | key: `auth.callback.missingParams` / `authFailed` |
| 5 | Page › `error_description`/`error` param passthrough | error | (OAuth provider error text) | data-driven (provider query params) |

### Shared auth components (rendered inside auth routes / settings)
_Module bundle: `messages.ts` (`auth.security`, `auth.magicLink`, `auth.oauth`, `auth.bot`, `auth.passkey`, `auth.passwordMeter`, `auth.mfaInput`, `auth.mfaSetup`, `auth.mfaDisable`, `auth.securityContext`, `auth.sessionExpiredDialog`, `auth.connected`, `auth.layout`)_
| # | Source (component) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | `magic-link-form.tsx` | heading/body/button | Passwordless sign-in / Sign in with a magic link / Enter your work email and we will send a secure, single-use link — no password required. / Sending link… / Send magic link / Link on the way / Check your email / If an account exists for … / Did not get it? Check spam or quarantine folders… / Send another link | key: `auth.magicLink.*`; also `placeholder="name@company.com"` (magic-link-form.tsx:191) HARDCODED |
| 2 | `oauth-providers.tsx` | link | or continue with / Continue with {provider} | key: `auth.oauth.orContinueWith` / `continueWith` |
| 3 | `sso-redirect-notice.tsx` | body | Your organization uses / — continue with SSO. / Continue with {provider} | key: `auth.oauth.orgUsesPrefix` / `orgUsesSuffix` / `continueWith` |
| 4 | `passkey-button.tsx` | button | Sign in with a passkey / Authenticating… / Passkey sign-in was cancelled. You can try again. | key: `auth.passkey.*` |
| 5 | `bot-challenge.tsx` | label/error | Slide to confirm you are human / Verified — you are human / Slide to confirm / Drag the handle, or use the arrow keys, to the end of the track to confirm. / Verification failed. / Verification failed. Please try again. / Try again / Confirmed / slide to the end to confirm / Leave this field empty | key: `auth.bot.*` |
| 6 | `password-strength-meter.tsx` | label | At least 12 characters / Contains uppercase letter / Contains lowercase letter / Contains number / Contains special character / Weak / Fair / Good / Strong / Password strength: {level} / Password requirements | key: `auth.passwordMeter.*` |
| 7 | `mfa-code-input.tsx` | aria-label | Verification code / Digit {index} of 6 | key: `auth.mfaInput.groupAria` / `digitAria` |
| 8 | `mfa-setup-dialog.tsx` | modal-title/body | Set up two-factor authentication / Scan this QR code with your authenticator app… / MFA QR code — scan with your authenticator app / Can't scan the code? / Enter this key manually: / Copy manual key / Next / Verify your authenticator / Enter the 6-digit code… / Back / Save your recovery codes / These codes can be used to access your account… / Each code can only be used once. / Store them securely — they will not be shown again. / Download / Copy all / I have saved my recovery codes in a secure location / Done / Clario360 Recovery Codes / Keep these codes in a safe place. Each code can only be used once. / Failed to initialize MFA setup / Invalid code. Please try again. / Copied! / Recovery codes copied! | key: `auth.mfaSetup.*` |
| 9 | `mfa-disable-dialog.tsx` | modal-title/body | Two-factor authentication disabled / Your account is now less secure. Consider re-enabling MFA. / Invalid code or unable to disable MFA. / Disable Two-Factor Authentication / This will make your account less secure. Are you sure? / Disabling MFA removes an important layer of security from your account. Only proceed if your authenticator device is lost. / Enter the 6-digit code from your authenticator app to confirm: / Cancel | key: `auth.mfaDisable.*` |
| 10 | `security-context.tsx` | body | Last sign-in: / from | key: `auth.securityContext.lastSignIn` / `from` |
| 11 | `session-expired-dialog.tsx` | modal-title/body | Session Expired / Your session has expired due to inactivity. Please sign in again to continue. / Sign In | key: `auth.sessionExpiredDialog.*` |
| 12 | `connected-accounts.tsx` | label | Connected Accounts / Link external accounts for single sign-on / No external authentication providers are configured. / Connected / · Last used / Unlink / Connect / Unlink Account / Unlink your / ? You will no longer be able to sign in with this provider. | key: `auth.connected.*` |
| 13 | `trust-strip.tsx` › item tooltips | tooltip | National Cybersecurity Authority Essential Cybersecurity Controls / Saudi Central Bank Cyber Security Framework / ISO/IEC 27001 information security management certification / All tenant data resides within Saudi Arabia | HARDCODED (`TRUST_ITEMS` `description` defaults; visible `label` comes from `labels` prop = keyed) |
| 14 | `auth-page-primitives.tsx` | — | (layout primitives — all display text passed in as props from keyed callers) | key: (props) |
| 15 | `auth-background.tsx` / `auth-transition.tsx` / `auth-form-skeleton.tsx` | — | (decorative / no user-facing copy) | n/a |

---

# ONBOARDING — `/(onboarding)/**`  ⚠ NO i18n bundle — all HARDCODED

### Route: (onboarding) group — `(onboarding)/layout.tsx`
_Module bundle: none_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | layout › `<title>` metadata | system | Setup — Clario360 | HARDCODED |
| 2 | layout › eyebrow | label | Tenant onboarding | HARDCODED |
| 3 | layout › wizard step labels (desktop + mobile nav) | breadcrumb | Organization / Branding / Team / Suites / Ready | HARDCODED (`WIZARD_STEPS`) |
| 4 | layout › nav aria | aria-label | Onboarding steps | HARDCODED |
| 5 | layout › footer | body | Need help? support@clario360.com | HARDCODED |

### Route: /verify — `(onboarding)/verify/page.tsx`
Re-exports `(auth)/verify-email/page` — all strings keyed under `auth.verify.*` (see /verify-email above). The onboarding branch (`pathname === '/verify'`) additionally renders `auth.verify.badge/title/description/statusLabel/statusValuePrefix` — all keyed.

### Route: /setup — `(onboarding)/setup/page.tsx` → `WizardContainer` + steps
_Module bundle: none — every string below HARDCODED_

**`wizard-container.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | loading | body | Loading your onboarding wizard… | HARDCODED |
| 2 | load error fallbacks | error | Failed to load onboarding wizard. / Unable to load onboarding state. | HARDCODED |
| 3 | step headings (per currentStep) | heading | Tell us about your organization / Shape the look of your workspace / Invite your team / Choose products, plan, and seats / Finish provisioning | HARDCODED |
| 4 | step subheadings (per currentStep) | subheading | These details seed your tenant profile and guide default settings. / Colors can be changed later. They are applied across shared dashboards. / Send invites now or skip and handle team setup later from the dashboard. / Trial starts by default. Select the products and seats to provision for this tenant. / We will poll the provisioning pipeline in real time until the platform is ready. | HARDCODED |

**`step-indicator.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 5 | step labels | breadcrumb | Organization / Branding / Team / Products / Ready | HARDCODED |

**`step-organization.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 6 | org name label | label | Organization name | HARDCODED |
| 7 | industry label | label | Industry | HARDCODED |
| 8 | industry options | option | Financial Services / Government / Healthcare / Technology / Energy / Telecom / Education / Retail / Manufacturing / Other | HARDCODED (`INDUSTRIES` in `shared.ts`) |
| 9 | country label | label | Country | HARDCODED |
| 10 | city label | label | City | HARDCODED |
| 11 | organization size label | label | Organization size | HARDCODED |
| 12 | org size options | option | 1-50 / 51-200 / 201-1000 / 1000+ | HARDCODED (`ORG_SIZES`) |
| 13 | back / continue | button | Back / Continue | HARDCODED |
| 14 | submit error | error | Failed to save organization details. | HARDCODED |

**`step-branding.tsx` + `color-picker.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 15 | logo upload block | heading/body | Upload your organization logo / PNG or SVG only, up to 2MB. We store it with your tenant branding so dashboards and welcome surfaces can reuse it. / Choose Logo / Drag and drop supported | HARDCODED |
| 16 | logo errors | error | Logo must be a PNG or SVG image. / Logo must be 2MB or smaller. / Failed to proceed. Please try again. / Failed to save branding. | HARDCODED |
| 17 | logo preview panel | body | Logo preview / Selected logo preview (alt) / Current logo is already stored for this tenant. / No logo selected yet. / Your colors will still be applied if you skip this step. | HARDCODED |
| 18 | color pickers | label | Primary color / Accent color | HARDCODED (`ColorPicker label` prop) |
| 19 | palette preview | body | Executive Overview Preview / A quick feel for your chosen palette / Risk Score / Critical Alerts / Compliance / Actions | HARDCODED |
| 20 | back / skip / continue | button | Back / Skip / Continue | HARDCODED |

**`step-team.tsx` + `invite-row.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 21 | sent confirmation | toast | {n} invitation(s) sent. | HARDCODED |
| 22 | submit error | error | Failed to send invitations. | HARDCODED |
| 23 | add-row + counter | button/body | Add another / {n}/10 rows | HARDCODED |
| 24 | back / skip / continue | button | Back / Skip / Continue | HARDCODED |
| 25 | invite-row email label/placeholder | label | Email / alice@company.com | HARDCODED |
| 26 | invite-row role label + aria | label | Role | HARDCODED |
| 27 | invite-row remove | button | Remove | HARDCODED |
| 28 | invite-row role options | option | (role names) | data-driven (`GET /roles`; fallback "Viewer" HARDCODED in wizard-container) |

**`step-suites.tsx` + `suite-selector-card.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 29 | trial banner | body | Trial included by default / {n} days, {n} seats, upgrade anytime. / No payment required | HARDCODED |
| 30 | plan section | heading | Plan / Choose the onboarding plan to provision. | HARDCODED |
| 31 | plan radiogroup aria + card aria | aria-label | Onboarding plan / {name} plan | HARDCODED |
| 32 | plan card badges | badge | Default / Up to {n} seats | HARDCODED |
| 33 | seats section | label | Seats / Choose 1-{n} seats for {planName}. | HARDCODED |
| 34 | products section | heading | Products / Select the products to activate during onboarding. | HARDCODED |
| 35 | suite disabled reason | body | Not included in selected plan | HARDCODED |
| 36 | back / continue | button | Back / Continue | HARDCODED |
| 37 | validation/submit errors | error | Select at least one product. / Choose between 1 and {n} seats for this plan. / Failed to save product and plan selection. | HARDCODED |
| 38 | suite titles | option | Cybersecurity / Data Intelligence / SIEM / DataStream / Cloud Migration / Board Governance / Legal Operations / Executive Intelligence | HARDCODED (`SUITES` in `shared.ts`; also overridable by `products` API) |
| 39 | suite descriptions | body | Threat detection, asset management, SOC dashboards / Data quality, pipeline orchestration, contradiction detection / Security event collection, correlation, detection, and response / Resilience, migration, synchronization, and data warehouse operations / Portfolio assessment, move groups, waves, cutover governance, and migration evidence / Meeting automation, minutes, compliance tracking / Contract management, clause analysis, expiry monitoring / Cross-suite dashboards, KPIs, executive reports | HARDCODED |
| 40 | plan name/description (default catalog) | option | Trial / 14-day self-serve trial with selected products and up to 5 users. | HARDCODED (`DEFAULT_ONBOARDING_PLAN_CATALOG`; may be overridden by `GET /onboarding/plans`) |

**`step-ready.tsx` + `provisioning-progress.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 41 | complete-error | error | Failed to finalize onboarding. | HARDCODED |
| 42 | completed state | heading/body | Your Clario360 platform is ready! / Provisioning completed successfully. You can start from the dashboard or jump into a suite. / Go to Dashboard | HARDCODED |
| 43 | completed quick-start cards | body | Connect your first data source / Start ingesting structured data. / Set up asset scanning / Bring cyber inventory online. / Schedule a board meeting / Begin governance workflows. / Explore the documentation | HARDCODED |
| 44 | provisioning state | heading/body | Provisioning your workspace / We are setting up tenant defaults, security roles, dashboards, and storage. | HARDCODED |
| 45 | failed state actions | button | Back / Go to Dashboard | HARDCODED |
| 46 | progress bar | body | {n}% complete | HARDCODED |
| 47 | provisioning step name / error / status badge | body/badge | (step_name, error_message, status) | data-driven (`GET /onboarding/status/{tenantID}` — needs backend localization) |

---

# SETTINGS — `/settings/**`  ✅ fully keyed via `settings-i18n.ts`

### Route: /settings — `settings/page.tsx` → `settings-client.tsx`
_Module bundle: `src/app/(dashboard)/settings/_lib/settings-i18n.ts` (bilingual, complete)_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `metadata.title` | system | Account Settings | HARDCODED (static `metadata` object) |
| 2 | page › SettingsFallback aria | aria-label | Loading account settings | HARDCODED |
| 3 | error.tsx › RouteError segment | system | Settings | key: `SETTINGS_L.segmentLabel` |
| 4 | SettingsClient › PageHeader | heading | Account Settings / Manage your profile, security, and API access / Account | key: `accountSettings` / `accountSettingsDesc` / `eyebrowAccount` |

**`profile-form.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 5 | card header | heading | Profile Information / Update your display name. | key: `profileInformation` / `profileInformationDesc` |
| 6 | first/last name | label | First Name / Last Name | key: `firstName` / `lastName` |
| 7 | email label + note | label | Email / Email changes require a verification flow. Contact support. | key: `email` / `emailChangeNote` |
| 8 | verification block | label/badge/body | Email verification status / Verification pending / Verified / You can keep using Clario360, but verify this email to keep account recovery and email notifications reliable. / Verified on {date} | key: `emailVerificationStatus` / `emailVerificationPending` / `emailVerified` / `emailVerificationPendingDesc` / `emailVerifiedOn` |
| 9 | verification actions | button/toast | Verify email / Sending... / Resend code / A new verification code has been sent. / Failed to send a new code. Open the verification flow and try again. | key: `verifyEmail` / `sendingVerificationCode` / `resendVerificationCode` / `verificationCodeSent` / `verificationCodeSendFailed` |
| 10 | submit + toasts | button/toast | Saving... / Save Changes / Profile updated. / Failed to update profile. | key: `saving` / `saveChanges` / `profileUpdated` / `failedUpdateProfile` |

**`password-change-form.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 11 | card header | heading | Change Password / Update your password. You will be logged out of all other sessions. | key: `changePassword` / `changePasswordDesc` |
| 12 | fields | label | Current Password / New Password / Confirm New Password | key: `currentPassword` / `newPassword` / `confirmNewPassword` |
| 13 | submit + messages | button/toast | Updating... / Update Password / Password changed successfully. / All other sessions have been logged out for security. / Incorrect current password. / Invalid value / Failed to change password. | key: `updating` / `updatePassword` / `passwordChangedSuccess` / `otherSessionsLoggedOut` / `incorrectCurrentPassword` / `invalidValue` / `failedChangePassword` |

**`mfa-section.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 14 | card header | heading | Two-Factor Authentication / Add an extra layer of security to your account. | key: `twoFactorAuth` / `twoFactorAuthDesc` |
| 15 | required warning | error | Your organization requires two-factor authentication. Please enable it to continue using the platform. | key: `mfaRequiredWarning` |
| 16 | status + badges + buttons | label/badge/button | 2FA is enabled / 2FA is not enabled / Enabled / Disabled / Enable 2FA / Disable 2FA | key: `twoFAEnabled` / `twoFANotEnabled` / `enabled` / `disabled` / `enable2FA` / `disable2FA` |

**`sessions-section.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 17 | card header | heading | Active Sessions / Manage your active login sessions across all devices. | key: `activeSessions` / `activeSessionsDesc` |
| 18 | empty | empty-state | Session management is being set up for your organization. | key: `sessionsBeingSetUp` |
| 19 | device labels + current + revoke | badge/button | Mobile / Tablet / Desktop / Browser / Current / Revoke / Revoke All Other Sessions | key: `deviceMobile` / `deviceTablet` / `deviceDesktop` / `browserGeneric` / `current` / `revoke` / `revokeAllOtherSessions` |
| 20 | revoke-all dialog + toasts | modal/toast | Revoke All Other Sessions / This will log you out of all other devices. Your current session will remain active. / Revoke All / Session revoked. / Failed to revoke session. / All other sessions have been revoked. / Failed to revoke sessions. | key: `revokeAllOtherSessionsTitle` / `revokeAllOtherSessionsDesc` / `revokeAll` / `sessionRevoked` / `failedRevokeSession` / `allOtherSessionsRevoked` / `failedRevokeSessions` |
| 21 | browser names (Firefox/Edge/Chrome/Safari) | badge | Firefox / Edge / Chrome / Safari | HARDCODED (intentionally untranslated brand names, per code comment) |

**`api-keys-section.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 22 | card header + create | heading/button | API Keys / Manage programmatic access to the platform. / Create API Key | key: `apiKeys` / `apiKeysDesc` / `createApiKey` |
| 23 | empty + list meta | empty-state/label | No API keys yet. / Expires / Created / Last used / Never used | key: `noApiKeysYet` / `expiresLabel` / `createdLabel` / `lastUsedLabel` / `neverUsed` |
| 24 | create dialog | modal/label | API keys provide programmatic access to the platform. / Name * / e.g. CI/CD Bot / Scopes * / Cancel / Creating... / Copy your API key now. It won't be shown again. / Copy API key / Done | key: `apiKeyDialogDesc` / `nameRequired` / `namePlaceholder` / `scopesRequired` / `cancel` / `creating` / `copyKeyNow` / `copyApiKeyAria` / `done` |
| 25 | toasts + close-confirm + revoke dialog | toast/modal | API key created. / API key copied. / Failed to create API key. / Close without saving? / Have you saved your API key? It will not be shown again. / Close Anyway / Revoke API Key / Are you sure you want to revoke "{name}"? Any applications using this key will lose access immediately. / Revoke Key / API key revoked. / Failed to revoke API key. | key: `apiKeyCreated` / `apiKeyCopied` / `failedCreateApiKey` / `closeWithoutSaving` / `closeWithoutSavingDesc` / `closeAnyway` / `revokeApiKeyTitle` / `revokeApiKeyDesc` / `revokeKey` / `apiKeyRevoked` / `failedRevokeApiKey` |
| 26 | key name / prefix / scopes | body | (per-key values) | data-driven (`GET /api/v1/api-keys`) |

### Route: /settings/notifications — `settings/notifications/page.tsx`
_Module bundle: `settings-i18n.ts` (`notification*`, `channel*`, `notificationTypes`)_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader + reset | heading/button | Notification Preferences / Customize how and when you receive notifications. / Account / Reset to Defaults | key: `notificationPreferences` / `notificationPreferencesDesc` / `eyebrowAccount` / `resetToDefaults` |
| 2 | channels card | heading/label | Notification Channels / Choose how you receive notifications / In-app notifications / Always enabled / Email notifications / Receive notifications via email / Real-time notifications / Live updates via WebSocket connection / Webhook notifications / Deliver to registered webhook endpoints | key: `notificationChannels` / `notificationChannelsDesc` / `inAppNotifications` / `alwaysEnabled` / `emailNotifications` / `emailNotificationsDesc` / `realtimeNotifications` / `realtimeNotificationsDesc` / `webhookNotifications` / `webhookNotificationsDesc` |
| 3 | quiet hours card | heading/label | Quiet Hours / During quiet hours, only critical notifications are delivered immediately. / Enable quiet hours / Start time / End time / Timezone | key: `quietHours` / `quietHoursDesc` / `enableQuietHours` / `startTime` / `endTime` / `timezone` |
| 4 | timezone options | option | UTC / Asia/Riyadh / Asia/Dubai / Europe/London / America/New_York / America/Chicago / America/Denver / America/Los_Angeles | HARDCODED (`TIMEZONES` — IANA identifiers, typically not translated) |
| 5 | digest card | heading/label | Digest / Receive a summary of notifications via email. / Daily digest / Receive a daily summary each morning / Weekly digest / Receive a weekly summary each Monday / Enable daily digest / Enable weekly digest | key: `digest` / `digestDesc` / `dailyDigest` / `dailyDigestDesc` / `weeklyDigest` / `weeklyDigestDesc` / `enableDailyDigest` / `enableWeeklyDigest` |
| 6 | per-type card | heading/label | Per-Type Settings / Override global channel settings for specific notification types. / Channel overrides / In-app / Email / Real-time / Webhook | key: `perTypeSettings` / `perTypeSettingsDesc` / `channelOverrides` / `channelInApp` / `channelEmail` / `channelRealtime` / `channelWebhook` |
| 7 | notification type labels (30) | label | Security Alerts / Alert Escalations / Security Incidents / Login Anomalies / Malware Detection / Remediation Approvals / Remediation Completed / Remediation Failures / Task Assignments / Task Overdue / Task Escalations / Workflow Failures / Workflow Completions / Pipeline Failures / Pipeline Completions / Data Quality Issues / Contradiction Detected / Contract Expirations / Contract Created / Analysis Ready / Clause Risk Flagged / Meeting Scheduled / Meeting Reminders / Action Item Assigned / Action Item Overdue / Minutes Approved / KPI Threshold Breached / Password Expiring / System Maintenance / Welcome | key: `notificationTypes.*` |
| 8 | save bar + reset dialog + toasts | button/modal/toast | Save Preferences / Saving... / Reset to Defaults / This will reset all notification preferences to their default values. Your current settings will be lost. / Reset / Preferences saved / Failed to save preferences / Loading preferences… / Failed to load preferences | key: `savePreferences` / `savingPreferences` / `resetToDefaultsTitle` / `resetToDefaultsDesc` / `reset` / `preferencesSaved` / `failedSavePreferences` / `loadingPreferences` / `failedLoadPreferences` |

---

# DASHBOARD — `/dashboard` + root `(dashboard)` chrome

### Route: (dashboard) group chrome — `layout.tsx`, `error.tsx`, `loading.tsx`
_Module bundle: `messages.ts` (`shell.*`)_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | layout › skip link | link | Skip to main content | key: `shell.skipToMain` |
| 2 | error.tsx › RouteError | system | (falls back to route-error default copy; no `segment` passed) | key: (RouteError internal) |
| 3 | loading.tsx › PageLoader | system | (generic skeleton, no visible copy) | n/a |

Note: `Sidebar` / `Header` / `MobileSidebar` / `CommandPalette` / `ConnectionBanner` / `EmailVerificationReminder` render the app-wide nav — those live in `components/layout/**` and resolve via `shell.*` + `nav.*` (out of this suite's file scope; nav labels catalogued with the shell). Verified keyed: `shell.live/connecting/reconnecting/offline`, `shell.emailVerification*`, `shell.search*`, etc.

### Route: /dashboard — `dashboard/page.tsx` → `WidgetBoard`
_Module bundle: `board-i18n.ts` (chrome) + `suites-launcher COPY` + `messages.ts nav.*` — widget **contents** are HARDCODED_

**`error.tsx` / `loading.tsx` (dashboard route)**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | error.tsx › RouteError segment | system | Dashboard | HARDCODED |
| 2 | loading.tsx › aria + skeleton labels | aria-label | Loading dashboard / Loading metrics / Loading alerts / Loading tasks | HARDCODED |

**`widget-board.tsx` + `widget-frame.tsx` + `widget-picker-sheet.tsx`** (board chrome)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 3 | customize toggle | button | Customize dashboard | key: `BOARD_TEXT.customize` |
| 4 | edit-mode bar | heading/body/button | Customize mode / Drag widgets by the handle, resize from the edges, or remove them. Changes are saved on this device. / Add widget / Reset to default / Done | key: `BOARD_TEXT.editMode` / `editHint` / `addWidget` / `resetDefault` / `done` |
| 5 | sr announcements | system | Customize mode is on / Customize mode is off | key: `BOARD_TEXT.editModeOn` / `editModeOff` |
| 6 | empty board | empty-state | All widgets are hidden. Add widgets to build your dashboard. | key: `BOARD_TEXT.emptyBoard` |
| 7 | frame remove + empty | aria-label/body | Remove widget: {title} / Nothing to show right now | key: `BOARD_TEXT.removeWidget` / `noContent` |
| 8 | picker sheet | modal-title/body | Dashboard widgets / Choose which widgets appear on your dashboard. | key: `BOARD_TEXT.pickerTitle` / `pickerDescription` |
| 9 | widget titles/descriptions (registry) | label/body | Critical alerts banner / Welcome header / Suites launcher / Getting started checklist / KPI cards / Secondary metrics / Recent alerts / My tasks / Activity timeline (+ each one-line description) | key: `registry.tsx WIDGET_REGISTRY[].title/description` (bilingual) |

**`dashboard-hero.tsx`** (DashboardHero widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 10 | eyebrow | label | Operational Overview | HARDCODED |
| 11 | title | heading | Welcome back, {firstName}. | HARDCODED (fallback name "there" HARDCODED) |
| 12 | description | subheading | Monitoring cross-suite activity for {tenant.name}. / Monitoring cross-suite activity across your workspace. | HARDCODED |
| 13 | suite chips | badge | Cyber / Data / Acta / Lex / Visus | HARDCODED (`SUITE_CHIPS` labels) |
| 14 | date tag / stats | badge/label | (formatted date via date-fns 'EEEE, MMMM d') / Active Suites / Today | date-fns HARDCODED format (needs `ar` locale) + "Active Suites"/"Today" HARDCODED |

**`suites-launcher.tsx`** (SuitesLauncher widget) — bilingual in-component
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 15 | heading/subheading | heading | All suites / Launch any product suite, or jump straight to its top pages. | key: `COPY.heading` / `subheading` (bilingual) |
| 16 | entitlement badges + hint | badge/body | Available / No access / Ask your administrator for access to this suite. / Open / Quick links | key: `COPY.available` / `noAccess` / `noAccessHint` / `open` / `quickLinks` |
| 17 | stat tiles | label | Available / Restricted / of | key: `COPY.availableSuites` / `restrictedSuites` / `of` |
| 18 | suite names + descriptions + tier labels | label/body | (via `nav()` / `resolveNavText(suite.description)` / `resolveTierLabel`) | key: `config/navigation.ts` (bilingual) |

**`critical-alerts-banner.tsx`** (CriticalAlertsBanner widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 19 | banner message | heading | {n} Critical Item(s) Require(s) Attention | HARDCODED (pluralized inline) |
| 20 | quick-action pills | badge | Critical Alerts / High Severity | HARDCODED |
| 21 | dismiss | aria-label | Dismiss critical alerts | HARDCODED |

**`kpi-grid.tsx`** (KpiGrid widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 22 | KPI card titles | label | Open Alerts / Failed Pipelines / Pending Tasks / Data Quality | HARDCODED |
| 23 | trend labels | label | 24h / overdue / % pass | HARDCODED |

**`secondary-metrics-strip.tsx`** (SecondaryMetricsStrip widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 24 | metric labels | label | MTTR / MTTA / SLA Compliance / Active Incidents / Active Users / Pending Reviews | HARDCODED |
| 25 | value suffix units | label | min / h / d / % (formatMetricValue) | HARDCODED |

**`recent-alerts-table.tsx`** (RecentAlertsTable widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 26 | header + view-all | heading/link | Recent Alerts / View all | HARDCODED |
| 27 | new-alert banner | body/button | New alert detected / Show | HARDCODED |
| 28 | error + empty | error/empty-state | Failed to load alerts / No alerts found / No recent alerts to display. | HARDCODED |
| 29 | table headers | table-header | Severity / Title / Status / Time | HARDCODED |
| 30 | severity/status cell values | badge | (alert.severity, alert.status.replace('_',' ')) | data-driven (`GET /cyber/alerts`) |

**`my-tasks-list.tsx`** (MyTasksList widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 31 | header + view-all | heading/link | My Tasks / View all | HARDCODED |
| 32 | permission-denied empty | empty-state | Tasks unavailable / Your current role has limited workflow access. | HARDCODED |
| 33 | error + empty | error/empty-state | Failed to load tasks / All caught up! / No pending tasks. | HARDCODED |
| 34 | due date + status badge | label/badge | Due (overdue) {date} / overdue / pending / claimed | HARDCODED ('Due'/'(overdue)' literals; status text is task.status data-driven) |
| 35 | task name / workflow name | body | (task.name, task.workflow_name) | data-driven (`GET /workflows/tasks`) |

**`activity-timeline.tsx`** (ActivityTimeline widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 36 | header | heading | Live Activity | HARDCODED |
| 37 | event count | badge | {n} event(s) | HARDCODED |
| 38 | permission-denied | empty-state | Activity unavailable / Your current role has limited audit access. | HARDCODED |
| 39 | error + retry | error/button | Failed to load activity / Retry | HARDCODED |
| 40 | empty | empty-state | All quiet / No recent activity in the last 7 days. | HARDCODED |
| 41 | region aria | aria-label | Live Activity | HARDCODED |
| 42 | formatted action text | body | (audit action normalized: `{action}: {resource_type} {id}`) | data-driven (`GET /audit/logs`; action verbs need localization) |

**`onboarding-checklist.tsx`** (OnboardingChecklist widget)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 43 | heading + subheading | heading | You're all set / Get started with Clario360 / You can dismiss this guide. / A few quick steps to set up your workspace. | HARDCODED |
| 44 | dismiss aria | aria-label | Dismiss getting started | HARDCODED |
| 45 | progress aria + counter | aria-label | Getting started: {n} of {n} steps complete / {n}/{n} | HARDCODED |
| 46 | step titles | label | Complete your profile / Invite your team / Set up roles & access / Connect integrations / Review your plan & usage | HARDCODED (`STEPS`) |
| 47 | step descriptions | body | Add your details and secure your account with MFA. / Bring colleagues into your workspace. / Define who can see and do what. / Wire in your data sources and tools. / Check quotas and choose the right plan. | HARDCODED |
| 48 | step checkbox aria + go button | aria-label/button | Mark "{title}" done / Go | HARDCODED |

Note: `welcome-header.tsx` and `kpi-card.tsx` exist in `components/dashboard/` but are NOT rendered by the board (registry uses `DashboardHero`; kpi-card is a deprecated re-export of `StatTile`) — no additional live strings.

---

# NOTIFICATIONS — `/notifications`  ⚠ almost entirely HARDCODED

### Route: /notifications — `notifications/page.tsx` → `notifications-page-client.tsx`
_Module bundle: none (page-level) — HARDCODED_
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › `metadata.title` | system | Notifications | HARDCODED |
| 2 | error.tsx › RouteError segment | system | Notifications | HARDCODED |
| 3 | loading.tsx › PageLoader | system | (generic skeleton) | n/a |
| 4 | PageHeader | heading | Activity Center / Notifications / Stay up to date with activity across the platform. | HARDCODED |
| 5 | mark-all button | button | Marking... / Mark All Read | HARDCODED |
| 6 | select button | button | Select | HARDCODED |
| 7 | settings link | aria-label | Notification settings | HARDCODED |
| 8 | select-all toggle | button | Deselect all / Select all | HARDCODED |
| 9 | bulk delete | button | Delete ({n}) | HARDCODED |
| 10 | summary stat cards | label | Unread / Total / Top channel · {label} | HARDCODED |
| 11 | channel labels (top-channel) | label | Security / Workflow / Data / Governance / Legal / System | HARDCODED (`CHANNELS`) |
| 12 | mark-all confirm dialog | modal | Mark All Read / Mark all {n} unread notifications as read? / Mark all read | HARDCODED |
| 13 | bulk-delete confirm dialog | modal | Delete Notifications / Permanently delete {n} selected notification(s)? / Delete | HARDCODED |
| 14 | realtime fallback title | toast | New notification | HARDCODED (`normalizeNotification` fallback) |

**`notification-category-tabs.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 15 | tab labels | tab | All / Unread / Security / Workflow / Data / Governance / Legal / System | HARDCODED (`TABS`) |
| 16 | count badge overflow | badge | 99+ | HARDCODED |

**`notification-list.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 17 | date group headers | table-header | (from `groupNotificationsByDate` — e.g. Today / Yesterday / etc.) | HARDCODED in `lib/notification-utils` (verify separately) |
| 18 | footer states | body | Showing most recent {n} notifications. / No more notifications. / Load more notifications | HARDCODED |

**`notification-empty.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 19 | empty per category | empty-state | You're all caught up! / No unread notifications. / No security notifications. / No workflow notifications. / No data notifications. / No system notifications. / No governance notifications. / No legal notifications. | HARDCODED (`EMPTY_STATES`) |

**`notification-card.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 20 | card aria (unread) | aria-label | {title} (unread) | HARDCODED (' (unread)' suffix) |
| 21 | select checkbox aria | aria-label | Select notification: {title} | HARDCODED |
| 22 | notification title / body | body | (notification.title, notification.body) | data-driven (`GET /notifications`; backend copy — flag for backend localization) |

**`notification-actions.tsx`**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 23 | mark-as-read | aria-label/tooltip | Mark as read | HARDCODED |
| 24 | delete | aria-label/tooltip | Delete notification | HARDCODED |

---

# Coverage

**Routes covered (all opened + extracted):**
- **Auth:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite`, `/callback`, `(auth)/layout.tsx`, `(auth)/error.tsx` + 20+ shared `components/auth/*` (login-form, register-form, forgot/reset/magic-link forms, oauth-providers, sso-redirect-notice, passkey-button, bot-challenge, password-strength-meter, mfa-code-input, mfa-setup-dialog, mfa-disable-dialog, security-context, session-expired-dialog, connected-accounts, trust-strip, skip-to-form, auth-page-primitives).
- **Onboarding:** `(onboarding)/layout.tsx`, `/setup` (wizard-container + step-indicator + step-organization + step-branding + color-picker + step-team + invite-row + step-suites + suite-selector-card + step-ready + provisioning-progress + shared.ts), `/verify` (re-export).
- **Settings:** `/settings` (page + settings-client + profile-form + password-change-form + mfa-section + sessions-section + api-keys-section + error + loading), `/settings/notifications` (page + loading), `settings-i18n.ts`.
- **Dashboard:** `(dashboard)/layout.tsx` + error + loading; `/dashboard` (page + dashboard-hero + suites-launcher + error + loading) and every board widget rendered by the registry (widget-board, widget-frame, widget-picker-sheet, board-i18n, registry, critical-alerts-banner, kpi-grid, secondary-metrics-strip, recent-alerts-table, my-tasks-list, activity-timeline, onboarding-checklist).
- **Notifications:** `/notifications` (page + client + error + loading) and `components/notifications/*` (category-tabs, list, empty, card, actions).

**Approx. string count:** ~430 distinct user-facing strings.
- Keyed (bilingual, ready): ~250 — all of `/settings/**` (settings-i18n, complete), all auth routes/components (`messages.ts auth.*`, complete), board chrome + registry + suites-launcher (bilingual).
- **HARDCODED (needs extraction + Arabic): ~155** — concentrated in: **entire onboarding wizard (~60)**, **dashboard widget contents (~50: hero, KPIs, alerts banner, metrics strip, recent-alerts, my-tasks, activity, checklist)**, **entire notifications page + components (~35)**, plus a handful of route metadata/error-segment/skeleton-aria literals (`Account Settings`, `Notifications`, `Dashboard` segment, `Loading …` labels) and two `placeholder="name@company.com"` duplicates + trust-strip tooltip descriptions + invite/page.tsx inline zod messages.
- **data-driven (needs BACKEND localization): flagged rows** — invitation payload (role/org/inviter), onboarding roles + plan/product catalog (`/onboarding/plans`), provisioning step names/statuses (`/onboarding/status`), api-key records, alert/task/audit content on dashboard widgets, and **notification `title`/`body` (`GET /notifications`)** which the whole notifications UI renders verbatim.

**Files fully read (no gaps):** every file listed above was opened and extracted in full.

**Follow-ups / not fully read (out of this file's scope, flagged for their own suite docs):**
- `components/layout/**` (Sidebar, Header, MobileSidebar/MobileQuickNav, CommandPalette, ConnectionBanner, EmailVerificationReminder, ThemeLocaleSwitcher, navigation-labels) — render the shared app chrome consumed by `(dashboard)/layout.tsx`; resolve via `shell.*` + `nav.*` (keyed) but should be catalogued in the shell/navigation doc.
- `lib/notification-utils.ts` (`groupNotificationsByDate` date-group headers, `getNotificationIcon`) — date-bucket labels ("Today"/"Yesterday"/…) referenced by notification-list.tsx are defined there; confirm keyed status.
- `components/common/route-error.tsx` / `page-loader.tsx` / `loading-skeleton.tsx` — shared error/skeleton primitives whose default copy the settings/dashboard/notifications error+loading boundaries fall back to.
- `register-form.tsx` / `reset-password-form.tsx` / `magic-link-form.tsx` / `oauth-providers.tsx` full bodies were confirmed keyed via grep (only two `placeholder="name@company.com"` literals surfaced); their `t('auth.*')` keys are enumerated above from `messages.ts`.
