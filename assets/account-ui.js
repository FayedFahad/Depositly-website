/** Safe presentational helpers. The caller owns the verified connection state. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const profileText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

/** Plain display text; markup helpers escape this value before insertion. */
export function accountDisplayName(user) {
  const fullName = profileText(user?.name);
  const parts = [profileText(user?.given_name), profileText(user?.family_name)].filter(Boolean).join(' ');
  return fullName || parts || profileText(user?.email) || 'Google account';
}

function profilePicture(user) {
  if (typeof user?.picture !== 'string' || !user.picture.trim()) return '';
  try {
    const url = new URL(user.picture.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

/** The initials remain behind the image, ready for the delegated error fallback. */
export function accountAvatar(user, {size = 34} = {}) {
  const pixels = Number.isInteger(size) && size >= 16 && size <= 96 ? size : 34;
  const name = accountDisplayName(user);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('en');
  const picture = profilePicture(user);
  return `<span class="account-avatar" style="--account-avatar-size:${pixels}px" aria-hidden="true"><span class="account-avatar-initials">${escapeHTML(initials)}</span>${picture ? `<img class="account-photo" data-account-photo src="${escapeHTML(picture)}" width="${pixels}" height="${pixels}" alt="" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
}

/** Render only when the cloud adapter reports connected === true. */
export function accountButtonContent(user, {busy = false} = {}) {
  return `${accountAvatar(user)}<span class="account-info"><span class="account-name">${escapeHTML(accountDisplayName(user))}</span><span class="account-connected"><i aria-hidden="true"></i>Signed in${busy ? ' · Updating…' : ''}</span></span>`;
}
