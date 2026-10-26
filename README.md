# Depositly web

A responsive companion for Depositly Android: deposits, National Savings Certificates, payment schedules, receipts, ownership, and preferences. Google sign-in opens your personal tracker workspace and the same private Google Drive backups as the phone app. It does not create a bank account or a separate financial database.

Open **Bank Information** in the sidebar (or mobile navigation menu) to add, edit or delete saved bank accounts. Choose a bank from the offline catalog, enter the account title, account number, branch and routing number, and optionally enter an account type. Cards show the bank logo and include **Share**; browsers without system sharing offer the same five-line text with **Copy details**. Account and routing numbers stay as text to preserve leading zeros. These records use the active account’s workspace and synchronize with the Android app through full JSON and Google backups. Deposit CSV files and selected-deposit JSON exports exclude bank information; replacing from those files preserves saved bank accounts. Import the phone’s bank-only backup using **Merge records** to retain existing deposits and receipts.

Accounts are grouped by bank, including recognized legacy names and aliases. **Cards** and **Grid** views use the same saved `bankInformationView` preference as Android. The choice is retained across navigation, reloads and full backups; deposit-only imports keep it. Retired Compact preferences fall back to Cards. Copy icons beside account and routing numbers copy their exact text, including unsaved form values. Grid records have an options button for sharing, editing and deletion.

FDRs and savings certificates can optionally link to any saved interest-receiving bank account, independently of their issuing institution. Choose the account while adding or editing a deposit. Deposit and payment details show the receiving account, and Bank Information lists its linked deposits. Reassign or unlink those deposits before deleting the account. New receipts retain the receiving account's title, bank and number; later edits never rewrite that recorded identity, and legacy receipts are not assigned an account automatically.

Marking a payment received asks for the amount and an optional note. Payment lists and month filters use the scheduled payout date. Historical stored receipt dates remain in backups for compatibility. Linked deposits or recorded account identities require reader version 7. Full JSON and Google backups preserve the connection and recorded identity; selected-deposit JSON removes the private account snapshot while retaining its ID, and CSV retains the ID without bank-account details. An unresolved partial import can be linked to an available saved account later.

The website uses static frontend assets plus Node.js API functions on Vercel. Google OAuth credentials and tokens are handled by the server and are not exposed to page JavaScript. A persistent encrypted, HttpOnly session cookie carries the opaque session needed to restore your connection after reopening the page. Local browser copies are separated by Google account; shared phone and web records synchronize through immutable Google Drive versions.

## Configure Google and Vercel

Use the Android app's Google Cloud project: **depositly**, project number **688859064258**. Its Web application OAuth client is `688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com`. Both OAuth clients must belong to this project to access the same hidden Drive application-data folder.

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?project=depositly) and select that **Web application** client. Keep the Android client unchanged.
2. Add this exact **Authorized redirect URI**: `https://depositly.vercel.app/api/auth/callback`. If you use another production hostname, register its exact callback URL too and set `APP_ORIGIN` to that hostname's origin. Origin entries alone do not authorize an OAuth callback.
3. [Enable Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com?project=depositly). The consent screen needs basic identity scopes (`openid`, profile, email) and `https://www.googleapis.com/auth/drive.appdata`. Under [Audience](https://console.cloud.google.com/auth/audience?project=depositly), add test users while the OAuth app remains in Testing.
4. In **Vercel → Project settings → Environment variables**, set the four values below for the deployment environments you use. Copy the Web client's secret from Google Cloud directly into Vercel. Never put it in `config.js`, a Git commit, a screenshot, or a message.
5. Redeploy after setting the environment variables. Open `/api/auth/config` to check configuration status: it reports missing variable names, never secret values. Complete a real Google sign-in to verify the registered callback and consent settings.

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | `688859064258-h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | The private secret for that Web OAuth client |
| `SESSION_SECRET` | A newly generated random secret of at least 32 bytes; keep it stable across deployments |
| `APP_ORIGIN` | `https://depositly.vercel.app` (or your exact HTTPS production origin, without a path or trailing slash) |

Generate `SESSION_SECRET` on your own computer and paste the result directly into Vercel:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

`.env.example` lists the variable names and public defaults; its secret fields are intentionally empty. Actual `.env` files are ignored by Git and excluded from the deployment archive and static build. The public `config.js` may contain a client ID, but must never contain a client secret, session secret, or user tokens. Google Cloud and Vercel credentials have not been configured automatically by this build.

Google's [authorization code flow](https://developers.google.com/identity/protocols/oauth2/web-server) handles account selection and consent, then returns to the server callback. The server exchanges the code and refreshes Google access as needed. Sign-in uses normal page navigation rather than relying on a popup window. OAuth apps in Testing can lose refresh authorization after seven days when Drive access is requested; see [Google's expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Staying signed in and switching accounts

The website checks the server session when it opens and restores the connected account while its session and Google authorization remain valid. The encrypted HttpOnly session cookie renews when used, with a maximum cookie lifetime of 400 days. The separate sign-out protection cookie expires 400 days after the last Google sign-in, so another sign-in is required by then even with regular use. Reopening or reloading does not itself require another Google login. Signing out ends the local website session and prevents it being silently reopened by an older in-flight response.

Browser cookie deletion or restrictions, a long inactive period, revoked Google access, OAuth testing expiry, or a changed server session secret can require reconnecting. Keep `SESSION_SECRET` unchanged when redeploying unless you intend to invalidate all existing website sessions. Signing out of Depositly does not sign out of Google in other websites or delete Drive backups.

Each connected Google account uses a separate browser workspace and its own private Drive data. Signing out shows the separate guest workspace; the account's local cache is kept for the next verified sign-in with that same account. Another account does not automatically inherit it. Records from the old single-workspace format migrate automatically when their owner matches the verified account. Unassigned records require an explicit choice before linking, and the original is retained as a recovery copy. These are local browser caches rather than encrypted storage, so protect access to the browser profile.

The header shows your full Google name, photo, and connection status; the sidebar and account page also show your email. Missing photos fall back to initials. The interface uses a verified active session rather than a saved display name to decide whether you are connected.

If the same URL connects in Edge but fails in your regular Chrome profile, try Chrome's **Profile → Open Guest profile** as a diagnostic. Existing regular-profile records stay untouched; Guest site data disappears when that session closes. A successful Guest test suggests a profile setting or extension may be involved. Check only the relevant site's permission or extension access; no browser-data clearing is needed. See [Chrome Guest profiles](https://support.google.com/chrome/answer/6130773?hl=en). The current sign-in flow does not require globally allowing popups or disabling browser protections.

## Bring phone records to the website

1. Connect Google on Android and sign in to the website with the same account. Both use the same private registry.
2. Saved edits sync automatically, with a short debounce on the website. Each side pulls on opening/resuming and checks every 15 seconds while active. Routine sync has no review prompts or success notifications.
3. Offline edits remain local and retry when connectivity returns. Android also schedules persisted network jobs and a periodic refresh; the OS controls background timing. A closed website cannot run sync, and a force-stopped or offline phone cannot update instantly.
4. Open **Backup versions** on either platform to restore a dated version. Restoration creates a new latest revision, preserving previous history. Explicit file imports still have their own review screen.

Versions are immutable full JSON files named with UTC timestamps in Drive's private app-data folder. Field revisions merge independent edits, deletion markers prevent stale devices from reviving removed records, and concurrent uploads remain separate heads until merged. Conflicting changes to the same field resolve deterministically by revision timestamp/counter/device identity. Versions are retained without automatic deletion; Google storage limits still apply. Use the updated app and website together: older clients do not understand this sync protocol.

Full JSON downloads use Android's investment export format and preserve Self and Others deposits, receipt history and snapshots, currency, number format, theme, and default deposit view. Google Drive snapshots additionally retain the phone's native reminder enabled/time preferences. The website can preserve and edit these preferences for the next Android restore; it does not deliver phone or browser notifications. CSV exports contain investment records, not the complete receipt history.

Calculations match the phone app: month cycles use months / 12 and day cycles use exact days / 360, with integer-paisa arithmetic and TDS. A 100-day FDR pays on its exact 100th day; calendar cycles retain their original day anchor across renewals. Simple interest pays separately. Compound FDRs add net interest to principal at renewal maturity, and pay accumulated principal plus final interest when renewal stops. Savings certificates return principal with final interest at maturity and do not renew. Legacy receipts retain their recorded values and reduce any remaining corrected term interest.

Deposits include a Simple / Compound interest selector; bank selection leaves Investment Name for manual input. Forecast charts show projected net interest and the interest/TDS breakdown using current balances and rates. Compound backups require reader version 6 and round-trip between the updated website and phone app, including explicit tenure metadata. Older clients must update before reading compound backups.

Institution logos use 68 PNG assets extracted from the Android app, with metadata for all 69 catalog entries; Jubilee Bank and unknown institutions use a generic fallback.

Local JSON import supports backups up to the application's 20 MB validation limit. The server-backed Drive transfer uses gzip and a 4,000,000-byte compressed transfer limit to stay below [Vercel's 4.5 MB function payload limit](https://vercel.com/docs/functions/limitations#request-body-size). Decompressed content is bounded and validated too. If a snapshot cannot fit that cloud-transfer limit, use a downloaded JSON file instead; the previous backup remains available.

## Develop, test, and package

Use Node.js 20 or newer. There are no third-party runtime dependencies.

```powershell
# Copy the example once, then fill in secrets only in the ignored local file.
Copy-Item .env.example .env.local
# In .env.local, use APP_ORIGIN=http://localhost:4173

npm run dev
# Open http://localhost:4173

npm test
npm run build
npm run package
```

For local Google sign-in, add the exact redirect URI `http://localhost:4173/api/auth/callback` to the same Web OAuth client. The development server reads `.env.local` without overwriting environment variables already set in the process and without printing their values. It serves only public frontend inputs and the explicit API routes; it does not expose `.env.local` or server source files.

The Android parity test runs when the sibling `Depositly/app/assets/index.html` exists. Otherwise that one test is skipped; set `DEPOSITLY_ANDROID_SOURCE` to its absolute path to run it from another checkout. Other tests run without the Android source. Real authorization, durable browser sessions, and a phone backup round trip still need the configured deployment and your account/device; mocks do not prove those external settings.

`npm run build` bundles the official Vercel Web Analytics and Speed Insights browser SDKs with esbuild and creates the generated `public/` directory from **only** `index.html`, `config.js`, `assets/`, `privacy/`, and `terms/`. API functions and `server/` libraries remain outside the public output. `npm run package` creates `dist/depositly-website-vercel.zip` containing the complete Vercel project, including API/server source and build scripts, plus an empty-secret `.env.example`. It excludes actual environment files, tests, Git history, logs, temporary files, and generated output. Deploy the extracted project's root, not the generated archive directory.

## Vercel project settings

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | Repository root at `E:\Github\depositly-website` |
| Build Command | `node scripts/build.mjs` |
| Output Directory | `public` |
| Install Command | `npm ci --include=dev` |
| Environment variables | The four server values listed above |

`vercel.json` sets the build values. `.vercelignore` keeps secrets, tests, and generated directories out of deployment inputs while retaining the build scripts and server source. Do not deploy only `public/` or upload this as a static-only site: persistent authentication requires the Node.js API functions. Keep homepage, privacy, and terms URLs current in Google's consent-screen branding.

## Project files

| File | Purpose |
| --- | --- |
| `index.html`, `assets/app.js`, `assets/web.css` | Application and functional component styles |
| `assets/redesign.css` | Responsive blue and ink visual system, dark theme, and reduced-motion-aware animation |
| `assets/account-ui.js` | Connected Google profile and photo fallback |
| `assets/bank-ui.js`, `assets/bank-logos.js`, `assets/banks/` | Bank picker, original logos, and crop metadata |
| `assets/data-engine.js` | Android-compatible calculations and backups |
| `assets/cloud-sync.js` | Browser connection to the authenticated server API |
| `api/auth/[action].js` | Sign-in, callback, session, sign-out, and configuration endpoints |
| `api/drive/[action].js` | Account-authenticated Drive backup endpoints |
| `server/` | Server-only OAuth/session and Drive implementation |
| `.env.example` | Variable names and empty secret fields for setup |
| `config.js` | Public browser configuration; never secrets |
| `scripts/build.mjs` | Generate the safe public output |
| `scripts/serve.mjs` | Local frontend and API preview |
| `scripts/package.mjs` | Package deployable sources without local secrets |
| `scripts/extract-bank-assets.mjs` | Reproduce bank images from Android source |
| `privacy/`, `terms/` | Public policy pages |

Publisher: Greenstone Solutions LLC. Support: [air.expx2@gmail.com](mailto:air.expx2@gmail.com).

## Web Analytics and Speed Insights

The website loads `@vercel/analytics` and `@vercel/speed-insights` through their vanilla JavaScript entry points. The site uses static HTML and JavaScript rather than Next.js. SDK imports are bundled into `/assets/observability.js`; the same bundle is served by the local preview. Only HTTPS pages outside localhost initialize telemetry. Dashboard sections use fixed route names; URL queries, arbitrary fragments, API routes, and custom events are excluded. Investment records and Google identity fields are not passed to either SDK.

Vercel must provision the corresponding project features for its collection endpoints to accept data. SDK installation and deployment alone do not confirm that dashboard-side activation is complete. See the [Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart) and [Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart).
