# Depositly website

Simple static website for Vercel. No package installation or build command is needed.

## Deploy
1. Extract this ZIP.
2. Open https://vercel.com/drop and sign in.
3. Drag the extracted depositly-website folder onto the page.
4. Choose your project name and deploy. For a framework setting, choose Other; no build command is needed. The folder contains index.html at its root.
5. Open the production homepage, /privacy/ and /terms/ while signed out to confirm public access.

You can instead upload these files to a GitHub repository and import it in Vercel. Keep index.html at the repository root. Choose Other, leave Build Command empty and use the root as the output directory.

## Google verification
For public branding verification, use a custom domain you own and can verify in Google Search Console. A deployment subdomain under vercel.app does not give you ownership of vercel.app.
Add your custom domain in Vercel project Settings > Domains and follow Vercel's DNS instructions.
Then enter:
- Homepage: https://YOUR-DOMAIN/
- Privacy policy: https://YOUR-DOMAIN/privacy/
- Terms: https://YOUR-DOMAIN/terms/
- Authorized domain: YOUR-DOMAIN (domain only)
The YOUR-DOMAIN values are instructions, not live URLs.
Verify domain ownership, save Branding, then follow Google's Audience/Verification Center prompts. Creating this site does not itself approve Google verification.

## Content
Publisher: Greenstone Solutions LLC, as named in the supplied app.
Support: air.expx2@gmail.com, as shown in the supplied Cloud Branding screenshot.
No analytics, sign-in forms, tracking scripts, external fonts or investment data collection are added to this website.
The supplied Depositly 1.0.5 source has local storage and manual exports but no Google Drive integration. Privacy text therefore describes Drive as optional in supported versions. Before submitting a newer app for verification, confirm that the privacy policy matches the actual release's permissions, data access, deletion controls and backup retention. Update it when behavior changes.
