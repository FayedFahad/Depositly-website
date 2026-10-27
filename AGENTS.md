# Website deployment workflow

Use `codex/theme-preview` for the planned theme changes. Push changes to that branch so Vercel creates Preview deployments. Keep `main` as the production branch.

Do not push theme changes to `main`, merge them into `main`, or promote a Preview deployment to Production without the user's explicit approval.

For visual testing, open the preview URL with `?demo=1` to use the sample workspace. Google sign-in on a separate preview origin requires its own matching preview environment and OAuth callback configuration.

# Working files

Use `Z:\WORK DIRECTORY` for drafts, screenshots, temporary files, downloaded tools and build caches.
