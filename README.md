# Depositly web

A responsive web companion for Depositly Android: deposits, National Savings Certificates, interest and maturity schedules, received payments, ownership, and preferences. It uses the Android backup format and the same private Google Drive application folder. The website runs entirely in the browser and is ready for Vercel; no backend, database, client secret, or dependency installation is required.

## Preview and check

Requires Node.js 20 or newer for the development helpers. The deployed website does not require Node.js.

```powershell
npm run dev
# Open http://localhost:4173

npm test
npm run package
```

`npm run package` creates `dist/depositly-website-vercel.zip` containing the public site and setup instructions. Extract the archive and deploy the inner `depositly-website` folder. It excludes tests, scripts, Git history, local logs, and dependencies.

The Android source parity check runs when the sibling `Depositly/app/assets/index.html` is available; otherwise that one check is skipped. Set `DEPOSITLY_ANDROID_SOURCE` to the Android HTML file's absolute path to run it from another checkout. The remaining calculation, backup, cloud adapter, and browser-storage checks run without the Android repository.

## Enable Google sign-in

The supplied `config.js` contains the existing public **Web application** OAuth client ID documented in the Android repository. A client ID is public configuration; it is safe in browser code. Never put its client secret, access tokens, or downloaded credential JSON files in this project.

Use the same Google Cloud project as the Android app: **depositly**, project number **688859064258**. Using another project gives the website a different application-data folder, even if you use the same Google account.

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?project=depositly) and select the Web application client ending in `h97snetju0b3rts3jltgd210dobn75f1.apps.googleusercontent.com`. The Android client cannot be used by the website.
2. Add these **Authorized JavaScript origins** for local development: `http://localhost` and `http://localhost:4173`. If you change the port, add the new complete origin too. Open the site using `localhost`, rather than a file URL or an unregistered IP address.
3. After creating your Vercel deployment, add its exact HTTPS origin, for example `https://your-project.vercel.app`. Add your custom-domain origin separately when you use one. Origins contain the scheme, hostname, and optional port, with no path or trailing slash. Each preview deployment needs an authorized origin; prefer a stable production domain.
4. [Enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com?project=depositly). Under [Data Access](https://console.cloud.google.com/auth/scopes?project=depositly), include `openid`, profile, email, and `https://www.googleapis.com/auth/drive.appdata`.
5. If the OAuth app remains in Testing, add your Google account under [Audience → Test users](https://console.cloud.google.com/auth/audience?project=depositly). Complete Google's consent-screen and production requirements before allowing other accounts. Testing authorizations involving Drive can expire after seven days.
6. Confirm the public homepage, privacy, and terms URLs in [Branding](https://console.cloud.google.com/auth/branding?project=depositly). Use a domain you own for domain verification. Hosting a page does not itself complete Google verification.

If no Google window appears, open the site directly in a full browser, rather than an embedded preview. The website preloads Google’s sign-in library and opens the ready popup directly from your click. If the library was still loading, click **Continue with Google** once it is ready. Error dialogs distinguish a closed popup, a failed popup, and Google configuration errors; an unknown error does not necessarily mean popups are blocked.

The popup token flow does not use a server callback or require a client secret. If you replace the client, update `googleClientId` in `config.js`; `config.example.js` shows the format. Load `config.js` before the application module. Google Cloud settings have not been changed by this build.

Google controls account selection and permission consent. While connected, the header shows your full Google name, profile photo, and connection status; the sidebar and account page also show your email. Missing or unavailable photos fall back to initials. These profile details and tokens remain in page memory; reload or token expiry can require reconnecting, and the interface does not continue claiming an expired session is connected. The website requests only basic identity information and access to Depositly's hidden application-data folder. It does not request access to all files in Drive.

## Google sign-in works in Edge but not Chrome

If the same website URL connects successfully in Edge, that is evidence that its client ID and authorized origin work. A Chrome `popup_failed_to_open` error means Google could not open the sign-in window; it does not by itself identify an OAuth origin error. A `popup_closed` error means the window closed before Google returned a response. Google documents these as [popup errors handled separately from OAuth responses](https://developers.google.com/identity/oauth2/web/guides/error).

1. Try the same URL in Chrome's **Profile → Open Guest profile** and click **Connect Google**. This is a diagnostic session separate from your usual browser profile; no existing Depositly browser records are removed. Close it after testing, because [Guest site data is deleted when the Guest session ends](https://support.google.com/chrome/answer/6130773?hl=en).
2. In your regular Chrome profile, click **Connect Google** and look for the blocked-popup icon in the address bar. If it appears, allow pop-ups and redirects for the Depositly site, then retry. You can also open **Settings → Privacy and security → Site settings → Pop-ups and redirects** and add the exact Depositly origin to the allowed list. Keep this exception limited to Depositly. See [Chrome's site-specific popup controls](https://support.google.com/chrome/answer/95472?hl=en).
3. If Guest works but the regular profile still fails after the site permission is allowed, a profile setting or extension may be involved. Check popup/privacy extensions for a Depositly-specific exception or temporarily test the suspected extension on this site. Guest success alone does not identify which extension or setting caused the failure.

Keep the current Google Identity Services dialog flow. Google recommends it over the older manual client-side OAuth approach, and its [token model supports dialog UX only](https://developers.google.com/identity/oauth2/web/guides/use-token-model). A new token-in-URL redirect fallback is not part of this website's sign-in flow.

## Bring your phone records to the website

1. In the Android app, open **Settings → Account & cloud backup**, connect Google, and choose **Back up now**. Wait for **Backup saved to Google Drive**.
2. Open the website, connect the same Google account, and load the latest phone backup. When local records exist, review the restore or merge choice before applying it.
3. After a change on the phone, finish its backup, then refresh/check for new backups on the website. The website can check for newer snapshots while open and lets you review them before replacing local edits.
4. After editing on the website, explicitly save a backup to Google Drive. On a phone that already has data, use its restore or merge flow to import that backup. Download a JSON copy before replacing records on either device.

The current Android integration uploads complete snapshots; it does not continuously receive changes from another device. This website shares those snapshots and detects newer ones, but it cannot make a closed phone app update instantly. Keep one device's edits backed up before continuing on the other. Publishing from the website checks for a newer cloud backup and stops for a review when a conflict is detected. Google Drive does not offer an atomic compare-and-create transaction for this workflow, so simultaneous saves on two devices should still be avoided.

A full JSON file backup includes Self and Others investments, payment receipts and receipt snapshots, currency, number formatting, theme, and default deposit view. Downloads use Android's investment export format so they can be imported through the phone's regular data manager. Google Drive snapshots additionally retain Android's native reminder enabled/time preferences. Financial calculations follow Android's 360-day interest year, calendar-month payouts, tax deductions, and renewal projections. The website preserves and edits those reminder preferences for the next Drive restore; it does not deliver phone or browser notifications. Android notification delivery remains controlled by the phone and its permissions.

Institution logos come from the Android app: 68 extracted PNG assets and metadata for all 69 catalog entries. Their crop metadata preserves the original bank symbols in overview rows, deposit cards and tables, deposit details, and the form's bank picker. Jubilee Bank and unknown institutions use a generic fallback. Run `node scripts/extract-bank-assets.mjs` with the Android source available to reproduce the extracted assets. Desktop and mobile profile-photo display and initials fallback were checked with a labeled test profile; that visual check is separate from a real Google account authorization and phone backup round trip.

You can also import a full JSON backup without signing in. JSON is the complete backup format; CSV contains investment records and does not preserve receipt history. Local browser records stay in that browser profile and can be lost when site storage is cleared. Demo records are illustrative and are kept separate from real records.

## Deploy on Vercel

Import this repository into Vercel, or use the extracted archive as your static project. Set:

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | The folder containing `index.html` and `vercel.json` |
| Build Command | Leave empty |
| Output Directory | `.` (project root) |
| Install Command | Leave empty, or `npm install` (there are no dependencies) |
| Environment variables | None |

Do not select `dist` as the output directory: that directory holds the downloadable ZIP, not the website. This repository is located directly at `E:\Github\depositly-website`. Keep the Vercel Root Directory at the repository root; no nested project directory is needed.

`vercel.json` sets these static build values automatically. `.vercelignore` excludes development scripts, tests, and generated archives from repository deployments. After deployment, register the exact production origin in Google Cloud as described above. Check `/`, `/privacy/`, and `/terms/`, then perform a real round trip: back up one phone record and receipt, load it on the website, publish a small web change, and restore it on the phone. Real Google authorization and Android restoration require your account and device and are not proven by local automated tests.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Website shell |
| `assets/app.js`, `assets/web.css` | Application and responsive theme |
| `assets/account-ui.js` | Connected Google profile display and photo fallback |
| `assets/bank-ui.js`, `assets/bank-logos.js` | Bank picker, logo display, and crop metadata |
| `assets/banks/` | 68 bank logo PNGs extracted from the Android app |
| `assets/data-engine.js` | Android-compatible calculations and backups |
| `assets/cloud-sync.js` | Google Identity Services and Drive snapshot adapter |
| `config.js` | Public Web OAuth client ID |
| `privacy/`, `terms/` | Public policy pages |
| `vercel.json` | Static hosting and popup-compatible security headers |
| `tests/` | Financial parity and cloud adapter checks |
| `scripts/extract-bank-assets.mjs` | Reproduce bank assets from Android source |

Publisher: Greenstone Solutions LLC. Support: [air.expx2@gmail.com](mailto:air.expx2@gmail.com).

References: [Google Identity token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Web client setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid), [Drive application-data folders](https://developers.google.com/workspace/drive/api/guides/appdata), [OAuth authorization expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Vercel static configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vercel buildless projects](https://vercel.com/docs/builds/configure-a-build#skip-build-step).
