# Depositly

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who track fixed deposits and National Savings Certificates, including existing Depositly Android users who open their records on a larger screen.

## Product Purpose

Keep the deposit tracker as the homepage. Help users inspect their principal, check payment schedules, record receipts, and manage their deposits. The user confirmed this scope on 24 October 2026.

## Operating Context

Users enter records in the browser or transfer Android-compatible backups through JSON files and automatic Google Drive synchronization. Google sign-in opens an account-specific workspace. The app separates Self deposits from Others deposits; only Self deposits contribute to financial totals, while the calendar includes both.

## Capabilities and Constraints

- Preserve deposits, receipts, calendar, exports, import review, account isolation, and preferences.
- Bank information supports an offline bank dropdown and logos, account title, account number, branch, routing number, optional free-text account type, editing/deletion, and text sharing. Full JSON and Google backups share these records with Android; deposit-only imports preserve them.
- Group saved accounts by bank. Provide Cards and Grid layouts with a saved selection shared with Android, and exact-text copy controls beside account/routing numbers in records and forms. Bank Information titles use a capital I.
- Match Android calculations: calendar cycles use months / 12, day cycles use exact days / 360, and TDS applies to interest. Compound deposits capitalize net interest only at renewal maturity; savings certificates never renew. Preserve receipts when repairing legacy schedules.
- Keep Forecast out of website navigation and Settings; old Forecast links return to Dashboard. Bank selection leaves Investment Name for manual input.
- Deposits may optionally link to any saved receiving bank account independently of their issuing institution. Preserve immutable receiving-account identity on new receipts, keep legacy receipts unattributed, and prevent deleting a currently linked account until its deposits are reassigned or unlinked.
- Marking payments received asks for amount and optional note; presentation and month filtering use scheduled payout dates. Keep historical stored receipt dates for backup compatibility.
- Preserve the Vercel Node API and same-origin Google authentication. Do not substitute static-only hosting.
- A connected Google account uses one shared registry. Saved edits synchronize quietly, including offline retries, without backup review prompts. Keep dated versions available for explicit restore. Background timing remains subject to connectivity and OS scheduling.
- Rename Overview to Dashboard. Keep existing overview links working.
- Keep the existing vanilla JavaScript, HTML, and CSS architecture.

## Brand Commitments

Preserve the Depositly name and supplied logo, Greenstone Solutions LLC publisher credit, support contact, and legal facts. Replace the existing visual design across the site. Use clear, specific interface copy.

## Evidence on Hand

README.md documents the product and hosting. assets/data-engine.js contains the financial rules. assets/logo.png and assets/banks/ contain the original artwork. The app supplies fictional demo records, which must remain identified as demo data. No customer quotes or adoption statistics have been supplied.

## Product Principles

- Put current balances and upcoming payments within reach.
- Keep account identity and backup state explicit.
- Preserve data when users review imports or switch accounts.
- Keep controls usable on phones and with a keyboard.
