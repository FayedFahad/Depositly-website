export function createDownloadPage({document, fetchImpl = fetch}) {
  const status = document.getElementById('download-status'), button = document.getElementById('download-apk'), retry = document.getElementById('download-retry');
  let generation = 0;
  async function load() {
    const current = ++generation;
    status.textContent = 'Checking the latest release…';
    button.hidden = true;
    button.removeAttribute('href');
    retry.hidden = true;
    document.getElementById('release-details').hidden = true;
    document.getElementById('release-notes').textContent = 'Release notes appear after the latest version is checked.';
    try {
      const response = await fetchImpl('/api/app-update', {cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw Error();
      const release = await response.json();
      if (current !== generation) return;
      const version = /^(\d+\.\d+(?:\.\d+)?) Build ([1-9]\d*)$/.exec(release.versionName);
      if (!version || release.package !== 'app.depositly.mobile' || !Number.isSafeInteger(release.apkSize) || release.apkSize < 1) throw Error();
      const slug = `${version[1]}-build-${version[2]}`;
      if (release.apkUrl !== `https://github.com/FayedFahad/Depositly/releases/download/v${slug}/Depositly-${slug}.apk` || typeof release.releaseNotes !== 'string') throw Error();
      document.getElementById('release-version').textContent = release.versionName;
      document.getElementById('release-size').textContent = `${(release.apkSize / 1024 / 1024).toFixed(1)} MB · Android 8.0 or later`;
      document.getElementById('release-notes').textContent = release.releaseNotes || 'The latest signed Depositly release.';
      document.getElementById('release-details').hidden = false;
      status.textContent = 'The latest version is ready to download.';
      button.href = release.apkUrl;
      button.hidden = false;
    } catch {
      if (current !== generation) return;
      status.textContent = 'The latest download is temporarily unavailable. Check your connection and try again.';
      retry.hidden = false;
    }
  }
  retry.addEventListener('click', load);
  return {load};
}

if (typeof document !== 'undefined' && document.getElementById('download-status')) createDownloadPage({document}).load();
