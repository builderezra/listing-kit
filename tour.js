/* Listing Kit — guided feature tour.
 *
 * A lightweight spotlight/coachmark walkthrough launched from the "?" button.
 * Each step highlights a real element, opening any collapsed section it lives
 * in, and shows a card explaining what the feature does. No dependencies. */
const Tour = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const STEPS = [
    { sel: '#brandSection summary', open: 'brandSection', title: '1 · Set up your brand — once',
      text: 'Your name, agency, colours, logo, headshot and an optional AI key live here. It’s saved on this device and reused on every listing, so you only do it once.' },
    { sel: '#listingSection summary', open: 'listingSection', title: '2 · Add the listing',
      text: 'Paste a reiwa.com.au (or agency) link to auto-fill the address, price, beds/baths and the whole photo gallery — or just type the details in yourself.' },
    { sel: '#photoSection summary', open: 'photoSection', title: '3 · Photos',
      text: 'Drag photos in, paste them, or pull them from the listing link. They’re processed in your browser and never uploaded.' },
    { sel: '#generateBtn', title: 'Generate everything',
      text: 'One click builds your social graphics, a print-ready flyer, the listing / Instagram / Facebook / email copy, and runs the fair-housing language check.' },
    { sel: '#tabs', title: 'Your marketing kit',
      text: 'Flip between Graphics, the print Flyer, and the Listing / Instagram / Facebook / Email copy here. Each copy tab has Undo/Redo, ✨ Polish, and a one-click “Open in…” button.' },
    { sel: '.compliance-tab', title: '⚖️ Compliance check',
      text: 'Every output is scanned for discriminatory / fair-housing-risk language. A red dot means there’s something to review before you publish.' },
    { sel: '#studioLaunch', title: '✏️ Design Studio',
      text: 'The full editor: drag layers, recolour, add photos and gradients, save your own templates — or hit ✨ AI design to auto-compose a whole layout from your details.' },
    { sel: '#infoBtn', title: 'That’s the tour!',
      text: 'Privacy, the compliance disclaimer and the version live behind this “i”. Re-run this walkthrough any time from the “?”. Happy listing!' },
  ];

  let steps = [], i = 0, wired = false;
  const target = (s) => (s && document.querySelector(s.sel)) || null;

  const position = (step, t) => {
    const r = t.getBoundingClientRect(), pad = 6;
    const hole = $('tourHole');
    hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourProg').textContent = (i + 1) + ' / ' + steps.length;
    $('tourBack').disabled = i === 0;
    $('tourNext').textContent = i === steps.length - 1 ? 'Done ✓' : 'Next →';
    const card = $('tourCard');
    card.style.visibility = 'hidden';
    const ch = card.offsetHeight, cw = card.offsetWidth;
    let top = r.bottom + 12;
    if (top + ch > window.innerHeight - 12) top = Math.max(12, r.top - ch - 12);
    let left = Math.min(Math.max(12, r.left), window.innerWidth - cw - 12);
    card.style.top = top + 'px'; card.style.left = left + 'px'; card.style.visibility = 'visible';
  };

  const layout = () => {
    const step = steps[i];
    if (step.open) { const d = $(step.open); if (d && !d.open) d.open = true; }
    const t = target(step);
    if (!t) { if (i < steps.length - 1) { i++; layout(); } else stop(); return; }
    t.scrollIntoView({ block: 'center' });
    position(step, t);                                  // set content immediately (no rAF dependency)
    setTimeout(() => { const el = target(step); if (el) position(step, el); }, 70);   // refine after scroll settles
  };
  const next = () => { if (i >= steps.length - 1) stop(); else { i++; layout(); } };
  const back = () => { if (i > 0) { i--; layout(); } };

  const wire = () => {
    if (wired) return; wired = true;
    $('tourNext').addEventListener('click', next);
    $('tourBack').addEventListener('click', back);
    $('tourSkip').addEventListener('click', stop);
    $('tourMask').addEventListener('click', stop);
    window.addEventListener('keydown', (e) => {
      if ($('tourOverlay').hidden) return;
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
    });
    window.addEventListener('resize', () => { if (!$('tourOverlay').hidden) { const t = target(steps[i]); if (t) position(steps[i], t); } });
  };

  const start = () => { wire(); steps = STEPS.slice(); i = 0; $('tourOverlay').hidden = false; layout(); };
  const stop = () => { $('tourOverlay').hidden = true; };
  return { start, stop };
})();
