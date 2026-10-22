/**
 * Presentation-only motion for the Depositly workspace.
 *
 * The approach follows the Greenstone Solutions design system: blur-up scroll
 * reveals, word-by-word headlines, tilt + spotlight cards, a pointer glow,
 * a scroll progress bar and a header that condenses on scroll.
 *
 * Rendering never depends on any of this. Every helper is a no-op when the
 * browser lacks the API it needs, and anything that moves on its own is
 * skipped when the person prefers reduced motion.
 */
const canUseDOM = root => typeof root?.querySelectorAll === 'function';
const media = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
const reducedMotion = () => media('(prefers-reduced-motion: reduce)');
const finePointer = () => media('(hover: hover) and (pointer: fine)');
const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

/** Things that rise into view as the page scrolls. */
const REVEAL_SELECTOR = '.marquee-wrap, .section-head, .page-body > .card, .page-body .card:not(.stat-card), .toolbar, .site-footer .footer-grid > *';
let observer = null;

function revealObserver() {
  if (observer || typeof IntersectionObserver !== 'function') return observer;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, {threshold: 0.12, rootMargin: '0px 0px -30px 0px'});
  return observer;
}

/** Count a number up to its final value; the final text is always restored. */
function countUp(node, format, duration = 1100) {
  const [kind, raw] = String(node.dataset.count || '').split(':');
  const target = Number(raw), formatter = format[kind];
  if (!Number.isFinite(target) || typeof formatter !== 'function' || !frame) return;
  const finalText = node.textContent, start = now();
  const tick = time => {
    if (!node.isConnected) return;
    const progress = Math.min(1, (time - start) / duration), eased = 1 - Math.pow(1 - progress, 4);
    node.textContent = progress < 1 ? formatter(Math.round(target * eased)) : finalText;
    if (progress < 1) frame(tick);
  };
  frame(tick);
}

/** Scroll-linked chrome lives on <html>, so it survives each re-render of #app. */
function syncScroll(doc) {
  const html = doc.documentElement, y = window.scrollY || 0;
  const max = Math.max(1, (html.scrollHeight || 0) - (window.innerHeight || 0));
  html.style.setProperty('--scroll-progress', String(Math.min(1, y / max)));
  html.classList.toggle('is-scrolled', y > 16);
  html.classList.toggle('show-top', y > 520);
}

/**
 * Called after every render. Ambient loops (grid drift, orbs, particles,
 * marquee) read `--clock` as a negative delay so they continue in phase
 * instead of restarting whenever the markup is replaced.
 * Entrance animations only run when a page is newly opened (`entering`).
 */
export function enhanceView(root, {entering = false, format = {}} = {}) {
  if (!canUseDOM(root) || typeof document === 'undefined' || !document.documentElement) return;
  // The app replaces its view markup; release removed reveal targets on each render.
  observer?.disconnect();
  document.documentElement.style.setProperty('--clock', `${(-now() / 1000).toFixed(3)}s`);
  syncScroll(document);
  if (!entering || reducedMotion()) return;
  root.querySelector('.view')?.classList.add('is-entering');
  const io = revealObserver();
  if (io) {
    [...root.querySelectorAll(REVEAL_SELECTOR)].forEach((item, index) => {
      item.setAttribute('data-reveal', '');
      item.style.setProperty('--reveal-delay', `${(index % 4) * 70}ms`);
      io.observe(item);
    });
  }
  root.querySelectorAll('[data-count]').forEach(node => countUp(node, format));
}

/** Wire the page-level interactions once. */
export function installMotion(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.documentElement || typeof doc.addEventListener !== 'function' || typeof window?.matchMedia !== 'function') return;
  const html = doc.documentElement;
  let scrollQueued = false;
  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    (frame || setTimeout)(() => { scrollQueued = false; syncScroll(doc); });
  };
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', onScroll, {passive: true});
  syncScroll(doc);

  doc.addEventListener('click', event => {
    if (!event.target?.closest?.('[data-scroll-top]')) return;
    window.scrollTo({top: 0, behavior: reducedMotion() ? 'auto' : 'smooth'});
    doc.getElementById('main')?.focus({preventScroll: true});
  });

  if (!finePointer() || reducedMotion()) return;
  let pointer = null;
  const paint = () => {
    const event = pointer;
    pointer = null;
    if (!event) return;
    html.style.setProperty('--mouse-x', `${event.clientX}px`);
    html.style.setProperty('--mouse-y', `${event.clientY}px`);
    const target = event.target?.closest ? event.target : null;
    const card = target?.closest('.tilt-card');
    if (card) {
      const box = card.getBoundingClientRect();
      const nx = (event.clientX - box.left) / box.width, ny = (event.clientY - box.top) / box.height;
      card.style.setProperty('--rx', `${((0.5 - ny) * 6.5).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${((nx - 0.5) * 6.5).toFixed(2)}deg`);
      card.style.setProperty('--spot-x', `${(nx * 100).toFixed(1)}%`);
      card.style.setProperty('--spot-y', `${(ny * 100).toFixed(1)}%`);
    }
    const hero = target?.closest('.page-hero');
    const visual = hero?.querySelector('.hero-visual');
    if (visual) {
      const box = hero.getBoundingClientRect();
      visual.style.setProperty('--hero-x', `${(((event.clientX - box.left) / box.width - 0.5) * 12).toFixed(1)}px`);
      visual.style.setProperty('--hero-y', `${(((event.clientY - box.top) / box.height - 0.5) * 9).toFixed(1)}px`);
    }
  };
  doc.addEventListener('pointermove', event => {
    if (!pointer && frame) frame(paint);
    pointer = event;
  }, {passive: true});
  doc.addEventListener('pointerout', event => {
    const card = event.target?.closest?.('.tilt-card');
    if (card && !card.contains(event.relatedTarget)) { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); }
    const hero = event.target?.closest?.('.page-hero');
    if (hero && !hero.contains(event.relatedTarget)) {
      const visual = hero.querySelector('.hero-visual');
      visual?.style.setProperty('--hero-x', '0px');
      visual?.style.setProperty('--hero-y', '0px');
    }
  }, {passive: true});
  html.classList.add('has-pointer-glow');
}
