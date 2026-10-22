import {BANK_LOGO_DATA} from './bank-logos.js';

const escapeAttribute = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const normalized = value => typeof value === 'string' ? value.trim().toLocaleLowerCase('en').replace(/[’']/g, '').replace(/[.,]/g, '').replace(/[\s-]+/g, ' ') : '';
export const BankLogoCatalog = Object.freeze(BANK_LOGO_DATA.map(bank => Object.freeze({
  ...bank,
  aliases: Object.freeze([...bank.aliases]),
  logoSize: bank.logoSize ? Object.freeze([...bank.logoSize]) : null,
  symbolBox: bank.symbolBox ? Object.freeze([...bank.symbolBox]) : null,
  symbolClip: bank.symbolClip ? Object.freeze(bank.symbolClip.map(point => Object.freeze([...point]))) : null
})));
const byId = new Map(BankLogoCatalog.map(bank => [bank.id, bank]));
const byName = new Map();
for (const bank of BankLogoCatalog) for (const name of [bank.name, ...bank.aliases]) byName.set(normalized(name), bank);
let symbolSequence = 0;

/** Resolve stable Android bank ids, with exact names and aliases for older files. */
export function resolveBankLogo(asset) {
  if (typeof asset === 'string') return byId.get(asset) || byName.get(normalized(asset)) || null;
  if (!asset || typeof asset !== 'object') return null;
  return byId.get(asset.bankId) || byName.get(normalized(asset.bankName)) || null;
}

/**
 * Return an original bank mark cropped exactly as Android, or a generic bank icon.
 * Logos are decorative by default because the adjacent institution name labels it.
 * Set {decorative:false} when the logo is shown without a visible institution name.
 * All image paths are fixed local files; investment strings cannot become URLs.
 */
export function bankLogoMarkup(asset, {decorative = true} = {}) {
  const bank = resolveBankLogo(asset);
  const accessibility = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${escapeAttribute(bank?.name || (typeof asset === 'object' && asset?.bankName) || 'Bank / institution')}"`;
  if (!bank?.src || !bank.logoSize) {
    return `<svg class="bank-logo bank-logo--fallback" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${accessibility} focusable="false"><path d="m3 9 9-6 9 6M3 21h18M4 9h16M6 9v12M12 9v12M18 9v12"/></svg>`;
  }
  const box = bank.symbolBox || [0, 0, ...bank.logoSize];
  const [x, y, width, height] = box;
  const clipId = `depositly-bank-symbol-${++symbolSequence}`;
  const shape = bank.symbolClip ? `<polygon points="${bank.symbolClip.map(point => point.join(',')).join(' ')}"/>` : `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`;
  return `<svg class="bank-logo${bank.symbolBox ? '' : ' bank-logo--wordmark'}" xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" preserveAspectRatio="xMidYMid meet" ${accessibility} focusable="false"><defs><clipPath id="${clipId}">${shape}</clipPath></defs><image clip-path="url(#${clipId})" href="${escapeAttribute(bank.src)}" width="${bank.logoSize[0]}" height="${bank.logoSize[1]}"/></svg>`;
}

export const institutionIcon = bankLogoMarkup;
