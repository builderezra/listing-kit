/* Listing Kit v2 — UI wiring: brand kit (persisted), photo management, copy +
 * graphics + flyer generation, fair-housing scan, tabs, downloads.
 * No framework, no build, nothing leaves the browser. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('listingForm');
  const BRAND_KEY = 'lk_brand_v2';
  const APP_VERSION = 'v34';

  // ---------------- state ----------------
  let photos = [];        // [{url, img, name}] — hero is photos[heroIndex]
  let heroIndex = 0;
  let outputs = null;     // { mls, instagram, facebook, email }
  let report = null;      // fair-housing scan result
  let activeTab = 'graphics';
  let mode = 'sale';      // 'sale' | 'rent' — the listing type
  let stamp = '';         // status sash overlaid on the graphics ('' | SOLD | UNDER OFFER | …)
  let ohDir = 'right';    // open-home directional-sign arrow ('left' | 'up' | 'right')
  let reelBlob = null, reelExt = 'webm', reelURL = '';   // last rendered Reel video

  // status options per listing type
  const SALE_STATUS = [['justlisted', 'Just Listed'], ['openhouse', 'Home Open / Open House'], ['forsale', 'For Sale'], ['newprice', 'New Price'], ['sold', 'Just Sold'], ['custom', 'Custom…']];
  const RENT_STATUS = [['forlease', 'For Lease'], ['inspection', 'Home Open / Inspection'], ['newprice', 'Price Reduced'], ['leased', 'Leased'], ['custom', 'Custom…']];
  let brand = {
    agentName: '', brokerage: '', phone: '', email: '',
    primary: '#0f2e3d', accent: '#c08a3e',
    logo: '', headshot: '',      // dataURLs (persisted)
    templateId: 'modern',
    font: 'auto',                // headline font: auto | serif | sans
    prefs: { noEmojis: false, noHashtags: false, noExclaim: false, short: false, greeting: '', signoff: '', banned: '' },
    region: 'au',                // au | us | uk | other — drives defaults + compliance framing
  };
  brand.logoImg = null; brand.headImg = null; // live Image objects

  const CHANNEL_LABEL = { mls: 'Listing description', instagram: 'Instagram caption', facebook: 'Facebook post', email: 'Email blast' };

  // ---------------- loading indicators ----------------
  // a global thin top bar (ref-counted across concurrent ops)
  const Progress = (() => {
    let n = 0;
    return {
      start() { n++; const el = $('loadbar'); el.hidden = false; el.classList.add('on'); },
      stop() { n = Math.max(0, n - 1); if (n === 0) { const el = $('loadbar'); el.classList.remove('on'); el.hidden = true; } },
    };
  })();
  // an inline status with a live elapsed-seconds counter + spinner + estimate
  const startBusy = (el, baseClass, label, estimate) => {
    const t0 = Date.now();
    let text = label;
    const tick = () => {
      const s = Math.round((Date.now() - t0) / 1000);
      el.className = baseClass + ' busy';
      el.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${text} ${s}s${estimate ? ` · usually ${estimate}` : ''}</span>`;
    };
    tick();
    const iv = setInterval(tick, 1000);
    Progress.start();
    return {
      label: (l) => { text = l; tick(); },
      finish: (msg, kind) => { clearInterval(iv); Progress.stop(); el.className = baseClass + (kind ? ' ' + kind : ''); el.textContent = msg; },
    };
  };

  // sensible per-market defaults for the per-listing selects
  const REGION_DEFAULTS = {
    au: { currency: '$', areaUnit: 'sqm' },
    us: { currency: '$', areaUnit: 'sqft' },
    uk: { currency: '£', areaUnit: 'sqft' },
    other: { currency: '$', areaUnit: 'sqm' },
  };
  const applyRegionDefaults = () => {
    const r = REGION_DEFAULTS[brand.region] || REGION_DEFAULTS.other;
    $('currency').value = r.currency;
    $('areaUnit').value = r.areaUnit;
  };

  // ---------------- brand kit (persisted) ----------------
  const loadBrand = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(BRAND_KEY) || '{}');
      Object.assign(brand, saved);
    } catch (e) {}
    $('agentName').value = brand.agentName; $('brokerage').value = brand.brokerage;
    $('phone').value = brand.phone; $('email').value = brand.email;
    $('brandPrimary').value = brand.primary; $('brandAccent').value = brand.accent;
    $('brandFont').value = brand.font || 'auto';
    // v10 stored prefs as free text — migrate to the structured object
    if (typeof brand.prefs === 'string') {
      const p = Generator.parsePrefs(brand.prefs);
      brand.prefs = { noEmojis: p.noEmojis, noHashtags: p.noHashtags, noExclaim: p.noExclaim, short: p.short, greeting: '', signoff: p.signoff || '', banned: (p.banned || []).join(', ') };
    }
    brand.prefs = { noEmojis: false, noHashtags: false, noExclaim: false, short: false, greeting: '', signoff: '', banned: '', ...(brand.prefs || {}) };
    $('prefNoEmojis').checked = brand.prefs.noEmojis;
    $('prefNoHashtags').checked = brand.prefs.noHashtags;
    $('prefNoExclaim').checked = brand.prefs.noExclaim;
    $('prefShort').checked = brand.prefs.short;
    $('prefGreeting').value = brand.prefs.greeting;
    $('prefSignoff').value = brand.prefs.signoff;
    $('prefBanned').value = brand.prefs.banned;
    $('region').value = brand.region || 'au';
    applyRegionDefaults();
    setImgPreview('logo', brand.logo); setImgPreview('head', brand.headshot);
    loadBrandImages();
    markTemplate();
    // first run: open the brand section so they set it up once
    if (!brand.agentName && !localStorage.getItem(BRAND_KEY)) $('brandSection').open = true;
  };

  const saveBrand = () => {
    const { logoImg, headImg, ...persist } = brand;
    try { localStorage.setItem(BRAND_KEY, JSON.stringify(persist)); } catch (e) {}
  };

  const loadBrandImages = () => {
    ['logo', 'headshot'].forEach((key) => {
      const prop = key === 'logo' ? 'logoImg' : 'headImg';
      if (brand[key]) {
        const img = new Image();
        img.onload = () => { brand[prop] = img; rerenderVisuals(); };
        img.src = brand[key];
      } else brand[prop] = null;
    });
  };

  const bindBrandField = (id, key) => {
    $(id).addEventListener('input', () => {
      brand[key] = $(id).value;
      saveBrand();
      rerenderVisuals();
    });
  };

  const setImgPreview = (kind, dataURL) => {
    const img = $(kind + 'Preview'), clear = $(kind + 'Clear');
    img.hidden = !dataURL; clear.hidden = !dataURL;
    if (dataURL) img.src = dataURL;
  };

  const wireImagePick = (kind, key) => {
    $(kind + 'File').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        brand[key] = reader.result;
        setImgPreview(kind, reader.result);
        saveBrand(); loadBrandImages();
      };
      reader.readAsDataURL(f);
      e.target.value = '';
    });
    $(kind + 'Clear').addEventListener('click', () => {
      brand[key] = '';
      setImgPreview(kind, '');
      saveBrand(); loadBrandImages(); rerenderVisuals();
    });
  };

  const markTemplate = () => {
    document.querySelectorAll('.tpl').forEach((t) => t.classList.toggle('active', t.dataset.tpl === brand.templateId));
  };

  // ---------------- quick palettes ----------------
  const PALETTES = [
    ['#0f2e3d', '#c08a3e'], // navy & gold
    ['#1b3a2d', '#b06f43'], // forest & copper
    ['#20242b', '#c9a227'], // charcoal & brass
    ['#2c2330', '#c77d92'], // plum & rose
    ['#16424f', '#e0704f'], // teal & coral
    ['#101010', '#d4af37'], // black & gold
    ['#33415c', '#8fb8de'], // slate & sky
    ['#4a2c2a', '#d9c5a0'], // espresso & cream
  ];
  const renderPalettes = () => {
    const row = $('palRow');
    row.innerHTML = '';
    PALETTES.forEach(([p, a]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pal';
      b.title = `${p} / ${a}`;
      b.style.background = `linear-gradient(135deg, ${p} 50%, ${a} 50%)`;
      b.addEventListener('click', () => {
        brand.primary = p; brand.accent = a;
        $('brandPrimary').value = p; $('brandAccent').value = a;
        saveBrand(); rerenderVisuals();
      });
      row.appendChild(b);
    });
  };

  // ---------------- design import / export ----------------
  const exportDesign = () => {
    const { logoImg, headImg, ...persist } = brand;
    const blob = new Blob([JSON.stringify({ app: 'listing-kit', v: 1, design: persist }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-design.listingkit.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const importDesign = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const design = parsed && parsed.app === 'listing-kit' ? parsed.design : parsed;
        if (!design || typeof design !== 'object' || !('primary' in design || 'templateId' in design)) {
          $('parseNote').textContent = '';
          alert('That file doesn’t look like a Listing Kit design.');
          return;
        }
        const { logoImg, headImg, ...safe } = design;
        Object.assign(brand, safe);
        saveBrand();
        loadBrand();
        rerenderVisuals();
      } catch (e) {
        alert('Couldn’t read that design file.');
      }
    };
    reader.readAsText(file);
  };

  // ---------------- photos ----------------
  const addPhotoFiles = (files) => {
    [...files].filter((f) => f.type.startsWith('image/')).forEach((f) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { renderPhotoGrid(); rerenderVisuals(); };
      img.src = url;
      photos.push({ url, img, name: f.name, inCarousel: true, filter: { b: 100, c: 100, s: 100, w: 0 } });
    });
    renderPhotoGrid();
  };

  // test/integration hook: add a photo from a dataURL
  const addPhotoDataURL = (dataURL, name = 'photo') => {
    const img = new Image();
    img.onload = () => { renderPhotoGrid(); rerenderVisuals(); };
    img.src = dataURL;
    photos.push({ url: dataURL, img, name, inCarousel: true, filter: { b: 100, c: 100, s: 100, w: 0 } });
    renderPhotoGrid();
  };

  // add a photo from fetched bytes (link import) — local blob, canvas-safe
  const addPhotoBlob = (blob, name = 'imported') =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { photos.push({ url, img, name, inCarousel: true, filter: { b: 100, c: 100, s: 100, w: 0 } }); renderPhotoGrid(); resolve(true); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });

  const orderedPhotos = () => {
    if (!photos.length) return [];
    return [photos[heroIndex], ...photos.filter((_, i) => i !== heroIndex)];
  };

  const FOCUS_ORDER = ['center', 'top', 'bottom'];
  const FOCUS_ICON = { center: '⊙', top: '⬆', bottom: '⬇' };
  // photo filters → CSS/canvas filter string (honest adjustments only)
  const NEUTRAL = { b: 100, c: 100, s: 100, w: 0 };
  const filterCSS = (f) => {
    if (!f) return '';
    const p = [];
    if (f.b !== 100) p.push(`brightness(${f.b}%)`);
    if (f.c !== 100) p.push(`contrast(${f.c}%)`);
    if (f.s !== 100) p.push(`saturate(${f.s}%)`);
    if (f.w) p.push(`sepia(${Math.round(f.w * 0.6)}%)`);
    return p.join(' ');
  };
  const syncFcss = () => photos.forEach((p) => { p.fcss = filterCSS(p.filter); });
  let dragFrom = null;   // index being dragged for reorder
  const movePhoto = (from, to) => {
    if (from === to || from == null || to == null) return;
    const heroPhoto = photos[heroIndex];
    const [moved] = photos.splice(from, 1);
    photos.splice(to, 0, moved);
    heroIndex = Math.max(0, photos.indexOf(heroPhoto));
    renderPhotoGrid();
    rerenderVisuals();
  };
  const renderPhotoGrid = () => {
    const grid = $('photoGrid');
    grid.innerHTML = '';
    photos.forEach((p, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-card' + (i === heroIndex ? ' hero' : '');
      cell.draggable = true;
      cell.title = 'Drag to reorder';
      cell.addEventListener('dragstart', (e) => {
        dragFrom = i;
        cell.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
      });
      cell.addEventListener('dragend', () => { cell.classList.remove('dragging'); dragFrom = null; });
      cell.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('dragover'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();   // don't bubble to the page-level photo dropzone
        cell.classList.remove('dragover');
        movePhoto(dragFrom, i);
      });
      const focus = p.focus || 'center';
      const edited = filterCSS(p.filter) ? ' edited' : '';
      cell.innerHTML = `<img src="${p.url}" alt="" style="filter:${filterCSS(p.filter)}">` +
        (i === heroIndex ? '<span class="hero-tag">★ hero</span>' : '') +
        `<button type="button" class="photo-x" title="Remove">×</button>` +
        `<button type="button" class="photo-edit${edited}" title="Edit photo (filters &amp; crop)">✎</button>` +
        `<button type="button" class="photo-focus${focus !== 'center' ? ' on' : ''}" title="Crop focus: ${focus} (click to change)">${FOCUS_ICON[focus]}</button>`;
      cell.querySelector('img').addEventListener('click', () => { heroIndex = i; renderPhotoGrid(); rerenderVisuals(); });
      cell.querySelector('.photo-edit').addEventListener('click', () => openPhotoEditor(i));
      cell.querySelector('.photo-focus').addEventListener('click', () => {
        p.focus = FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length];
        renderPhotoGrid(); rerenderVisuals();
      });
      cell.querySelector('.photo-x').addEventListener('click', () => {
        if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
        const wasHero = photos[heroIndex];     // keep the ★ on the same photo (by reference)
        photos.splice(i, 1);
        heroIndex = photos.indexOf(wasHero);
        if (heroIndex < 0 || heroIndex >= photos.length) heroIndex = 0;
        renderPhotoGrid(); rerenderVisuals();
      });
      grid.appendChild(cell);
    });
  };

  // ---------------- photo editor (filters + crop focus) ----------------
  const PRESETS = {
    none: { b: 100, c: 100, s: 100, w: 0 },
    airy: { b: 110, c: 95, s: 105, w: 6 },
    crisp: { b: 103, c: 112, s: 108, w: 0 },
    warm: { b: 104, c: 102, s: 110, w: 38 },
    mono: { b: 102, c: 106, s: 0, w: 0 },
  };
  let editIdx = -1;
  const pePreviewUpdate = () => {
    const p = photos[editIdx]; if (!p) return;
    $('pePreview').style.filter = filterCSS(p.filter);
    $('pePreview').style.objectPosition = `center ${{ top: '0%', center: '50%', bottom: '100%' }[p.focus || 'center']}`;
  };
  const peSyncControls = () => {
    const p = photos[editIdx]; if (!p) return;
    $('peB').value = p.filter.b; $('peC').value = p.filter.c; $('peS').value = p.filter.s; $('peW').value = p.filter.w;
    document.querySelectorAll('#peFocus button').forEach((b) => b.classList.toggle('active', b.dataset.focus === (p.focus || 'center')));
    document.querySelectorAll('#pePresets button').forEach((b) => {
      const pr = PRESETS[b.dataset.preset];
      b.classList.toggle('active', pr && ['b', 'c', 's', 'w'].every((k) => pr[k] === p.filter[k]));
    });
  };
  const openPhotoEditor = (i) => {
    const h = $('studioHint'); if (h) h.hidden = true; clearTimeout(studioHintTimer);   // clear the "saved" notifier
    editIdx = i;
    const p = photos[i]; if (!p) return;
    $('pePreview').src = p.url;
    peSyncControls();
    pePreviewUpdate();
    $('photoEditor').hidden = false;
    document.body.style.overflow = 'hidden';
  };
  const closePhotoEditor = () => { $('photoEditor').hidden = true; document.body.style.overflow = ''; renderPhotoGrid(); rerenderVisuals(); };
  const wirePhotoEditor = () => {
    [['peB', 'b'], ['peC', 'c'], ['peS', 's'], ['peW', 'w']].forEach(([id, key]) => {
      $(id).addEventListener('input', () => { if (photos[editIdx]) { photos[editIdx].filter[key] = Number($(id).value); pePreviewUpdate(); peSyncControls(); } });
    });
    document.querySelectorAll('#pePresets button').forEach((b) => b.addEventListener('click', () => {
      if (!photos[editIdx]) return;
      photos[editIdx].filter = { ...PRESETS[b.dataset.preset] };
      peSyncControls(); pePreviewUpdate();
    }));
    document.querySelectorAll('#peFocus button').forEach((b) => b.addEventListener('click', () => {
      if (!photos[editIdx]) return;
      photos[editIdx].focus = b.dataset.focus;
      peSyncControls(); pePreviewUpdate();
    }));
    $('peReset').addEventListener('click', () => { if (photos[editIdx]) { photos[editIdx].filter = { ...PRESETS.none }; photos[editIdx].focus = 'center'; peSyncControls(); pePreviewUpdate(); } });
    $('peDone').addEventListener('click', closePhotoEditor);
    $('peClose').addEventListener('click', closePhotoEditor);
    $('photoEditor').addEventListener('click', (e) => { if (e.target === $('photoEditor')) closePhotoEditor(); });
  };

  const wireDropZone = () => {
    const dz = $('dropZone');
    $('photoFile').addEventListener('change', (e) => { addPhotoFiles(e.target.files); e.target.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', async (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files.length) return addPhotoFiles(e.dataTransfer.files);
      // dragging an image from another tab drops its URL — fetch it via proxy
      const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (uri && /^https?:\/\//i.test(uri.trim())) {
        const blob = await Importer.fetchImageBlob(uri.trim().split('\n')[0]);
        if (blob) { await addPhotoBlob(blob, 'dragged'); rerenderVisuals(); }
      }
    });
  };

  // ---------------- form ----------------
  const readForm = () => ({
    mode,
    address: $('address').value.trim(),
    city: $('city').value.trim(),
    price: $('price').value.trim(),
    currency: $('currency').value === 'custom' ? ($('currencyCustom').value.trim() || '$') : $('currency').value,
    rentPeriod: $('rentPeriod').value,
    rentPeriodCustom: $('rentPeriodCustom').value.trim(),
    badge: $('badge').value,
    badgeCustom: $('badgeCustom').value.trim(),
    openhouse: $('openhouse').value.trim(),
    type: $('type').value,
    typeCustom: $('typeCustom').value.trim(),
    tone: $('tone').value,
    beds: $('beds').value.trim(),
    baths: $('baths').value.trim(),
    cars: $('cars').value.trim(),
    sqft: $('sqft').value.trim(),
    areaUnit: $('areaUnit').value === 'customunit' ? ($('areaUnitCustom').value.trim() || 'm²') : $('areaUnit').value,
    year: $('year').value.trim(),
    lot: $('lot').value.trim(),
    // rent-only fields
    available: $('available').value.trim(),
    bond: $('bond').value.trim(),
    leaseTerm: $('leaseTerm').value === 'custom' ? ($('leaseTermCustom').value.trim() || '') : $('leaseTerm').value,
    furnished: $('furnished').value,
    pets: $('pets').value,
    features: $('features').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    neighborhood: $('neighborhood').value.trim(),
    agentName: brand.agentName, brokerage: brand.brokerage, phone: brand.phone, email: brand.email,
    region: brand.region,
    photoCount: photos.length,
  });

  // ---------------- generate ----------------
  // (re)run the fair-housing scan + banned-word check over the current outputs
  const runScan = () => {
    const data = readForm();
    report = FairHousing.scan({
      ...outputs,
      'your input': [data.features.join(', '), data.neighborhood, data.address].filter(Boolean).join('. '),
    });
    String((brand.prefs || {}).banned || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).forEach((w) => {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      const channels = Object.keys(outputs).filter((k) => re.test(outputs[k]));
      if (channels.length) {
        report.findings.push({ match: w, cls: 'Your style rule', sev: 'medium', why: `You asked to avoid “${w}”.`, fix: 'Edit the text in place, or hit ↻ Reword for different phrasing.', channels });
        report.counts.medium++;
        report.clear = false;
      }
    });
    updateComplianceDot();
  };

  const generate = () => {
    const data = readForm();
    snapshotAll(); // so Undo can revert a Reword/regenerate
    outputs = Generator.applyPrefs(Generator.generate(data), brand.prefs || {});
    runScan();
    $('emptyState').hidden = true;
    renderTab(activeTab);
  };

  const vizData = () => {
    const d = readForm();
    const inspectLine = (d.badge === 'openhouse' || d.badge === 'inspection') && d.openhouse
      ? (d.mode === 'rent' ? 'Inspect ' : '') + d.openhouse : '';
    syncFcss();
    return {
      badgeText: Generator.badgeText(d),
      ohLine: inspectLine,
      price: Generator.priceShort(d),
      address: [d.address, d.city].filter(Boolean).join(', '),
      beds: d.beds, baths: d.baths, cars: d.cars,
      sqft: Generator.num(d.sqft), areaUnit: d.areaUnit,
      brand,
      hero: photos[heroIndex] ? photos[heroIndex].img : null,
      heroFocus: photos[heroIndex] ? photos[heroIndex].focus : 'center',
      heroFilter: photos[heroIndex] ? filterCSS(photos[heroIndex].filter) : '',
      photos: orderedPhotos(),
      stamp,
      raw: d,
    };
  };

  // ---------------- graphics tab ----------------
  let carouselCanvases = [];
  const renderGraphics = () => {
    const d = vizData();
    Visuals.render(brand.templateId, 'square', $('cvSquare'), d);
    Visuals.render(brand.templateId, 'story', $('cvStory'), d);
    Visuals.render(brand.templateId, 'wide', $('cvWide'), d);
    renderCarousel(d);
  };

  // carousel: cover → photo slides with feature captions → CTA card
  const renderCarousel = (d) => {
    const section = $('carouselSection'), row = $('carouselRow');
    carouselCanvases = [];
    if (!d.photos.length) { section.hidden = true; return; }
    section.hidden = false;
    row.innerHTML = '';

    // photo picker — tap to include/exclude slides
    const pickRow = $('carPick');
    pickRow.innerHTML = '';
    d.photos.forEach((p) => {
      const im = document.createElement('img');
      im.src = p.url;
      im.className = 'car-pick-img' + (p.inCarousel === false ? ' off' : '');
      im.title = p.inCarousel === false ? 'Excluded — tap to include' : 'Included — tap to exclude';
      im.addEventListener('click', () => { p.inCarousel = p.inCarousel === false; renderCarousel(vizData()); });
      pickRow.appendChild(im);
    });

    const feats = Generator.flyerFeatures(d.raw, 8);
    const slides = d.photos.filter((p) => p.inCarousel !== false).slice(0, 6);
    const total = slides.length + 2;
    // bind a caption to each photo ONCE so toggling/re-rendering doesn't reshuffle them
    let fi = 0;
    slides.forEach((p) => { if (p._caption == null) p._caption = feats[fi++] || ''; });

    const addSlide = (label, renderFn, photo, kind, meta) => {
      const cell = document.createElement('div');
      cell.className = 'car-slide';
      const cv = document.createElement('canvas');
      renderFn(cv);
      cv.title = 'Click to zoom & edit';
      const n = carouselCanvases.length + 1;
      cv.addEventListener('click', () => openLightbox(cv, photo || null, n, kind || 'photo', meta));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn dl-mini';
      btn.textContent = label;
      btn.addEventListener('click', () => Visuals.download(cv, `${slug()}-carousel-${String(n).padStart(2, '0')}.png`));
      cell.appendChild(cv); cell.appendChild(btn);
      row.appendChild(cell);
      carouselCanvases.push(cv);
    };

    addSlide('1 · Cover', (cv) => Visuals.render(brand.templateId, 'square', cv, d), null, 'cover');
    slides.forEach((p, i) =>
      addSlide(`${i + 2} · Photo`, (cv) => Visuals.featureSlide(cv, { photo: p, caption: p._caption || '', brand, idx: i + 1, total }), p, 'photo', { idx: i + 1, total }));
    addSlide(`${total} · CTA`, (cv) => Visuals.ctaSlide(cv, { brand, address: d.address, badgeText: d.badgeText }), null, 'cta');
  };

  // ---- native share (Web Share API, with download fallback) ----
  const canShareFiles = () => { try { return !!(navigator.canShare && navigator.share); } catch (e) { return false; } };
  const shareCanvas = async (canvas, filename, text) => {
    try {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: text || '' }); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return true; }   // user cancelled the sheet — that's fine
    return false;
  };

  // ---- carousel slide lightbox (zoom + edit) ----
  let lbState = { photo: null, n: 1, cv: null, kind: 'photo', idx: 0, total: 1 };
  const openLightbox = (cv, photo, n, kind, meta) => {
    lbState = { photo, n, cv, kind: kind || 'photo', idx: (meta && meta.idx) || 0, total: (meta && meta.total) || 1 };
    $('lbImg').src = cv.toDataURL('image/png');
    $('lightbox').hidden = false;
  };
  const closeLightbox = () => { $('lightbox').hidden = true; };
  const wireLightbox = () => {
    $('lbClose').addEventListener('click', closeLightbox);
    $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
    $('lbDownload').addEventListener('click', () => { const a = document.createElement('a'); a.href = $('lbImg').src; a.download = `${slug()}-carousel-${String(lbState.n).padStart(2, '0')}.png`; a.click(); });
    $('lbEdit').addEventListener('click', () => {
      closeLightbox();
      if (lbState.kind === 'cta') openStudio({ seed: 'cta' });            // the CTA card, not the hero photo
      else if (lbState.photo) openStudio({ seed: 'feature', photoIndex: orderedPhotos().indexOf(lbState.photo), caption: lbState.photo._caption || '', idx: lbState.idx, total: lbState.total });   // reproduce THIS slide (photo + caption + dots)
      else openStudio({ seed: 'cover', photoIndex: 0 });                  // cover ≈ the template card on the hero
    });
    if (canShareFiles()) { $('lbShare').hidden = false; $('lbShare').addEventListener('click', async () => { if (lbState.cv) { const ok = await shareCanvas(lbState.cv, `${slug()}-carousel-${String(lbState.n).padStart(2, '0')}.png`, (outputs && outputs.instagram) || ''); if (!ok) $('lbDownload').click(); } }); }
    window.addEventListener('keydown', (e) => { if (!$('lightbox').hidden && e.key === 'Escape') closeLightbox(); });
  };
  const wireSignboard = () => {
    $('sbUrl').addEventListener('input', () => { if (activeTab === 'signboard' && outputs) renderSignboard(); saveDraft(); });
    $('sbDownload').addEventListener('click', () => Visuals.download($('cvSignboard'), `${slug()}-signboard.png`));
    $('sbStudio').addEventListener('click', () => openStudio());
  };
  const wireShare = () => {
    if (!canShareFiles()) return;
    $('sharePost').hidden = false;
    $('sharePost').addEventListener('click', async () => {
      const cap = (outputs && outputs.instagram) || '';
      const ok = await shareCanvas($('cvSquare'), `${slug()}-instagram.png`, cap);
      if (!ok) { Visuals.download($('cvSquare'), `${slug()}-instagram.png`); copyText(cap); }
    });
  };

  const slug = () => ($('address').value.trim() || 'listing').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const DL_NAME = { cvSquare: 'instagram-post', cvStory: 'story', cvWide: 'facebook' };
  const wireDownloads = () => {
    document.querySelectorAll('.dl').forEach((b) =>
      b.addEventListener('click', () => Visuals.download($(b.dataset.dl), `${slug()}-${DL_NAME[b.dataset.dl]}.png`)));
    $('dlAll').addEventListener('click', () => {
      Object.entries(DL_NAME).forEach(([id, name], i) =>
        setTimeout(() => Visuals.download($(id), `${slug()}-${name}.png`), i * 350));
    });
    $('dlCarousel').addEventListener('click', () => {
      carouselCanvases.forEach((cv, i) =>
        setTimeout(() => Visuals.download(cv, `${slug()}-carousel-${String(i + 1).padStart(2, '0')}.png`), i * 350));
    });
    $('openStudio').addEventListener('click', openStudio);
    if ($('dlPack')) $('dlPack').addEventListener('click', downloadCampaignPack);
  };

  // ---------------- campaign pack (one click → every asset in one ZIP) ----------------
  const saveBlob = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  };
  const offscreenCanvas = () => document.createElement('canvas');
  const canvasPNGBytes = (cv) => new Promise((resolve) => {
    cv.toBlob(async (blob) => {
      if (!blob) return resolve(null);
      try { resolve(new Uint8Array(await blob.arrayBuffer())); } catch (e) { resolve(null); }
    }, 'image/png');
  });
  const packCopyText = (d) => {
    const addr = d.address || 'Listing';
    const out = [addr, '='.repeat(Math.max(6, addr.length)), ''];
    [['LISTING DESCRIPTION', outputs && outputs.mls], ['INSTAGRAM CAPTION', outputs && outputs.instagram],
      ['FACEBOOK POST', outputs && outputs.facebook], ['EMAIL', outputs && outputs.email]].forEach(([t, txt]) => {
        if (!txt) return;
        out.push('## ' + t, '', String(txt).trim(), '', '');
      });
    return out.join('\n');
  };
  // build & download a ZIP of all the graphics, the carousel, the sign board,
  // a self-contained print flyer, and every piece of written copy — all on-device.
  const downloadCampaignPack = async () => {
    if (!outputs) generate();
    if (!outputs) { toast('Add a listing first'); return; }
    if (typeof Zip === 'undefined') { toast('ZIP export unavailable'); return; }
    const btn = $('dlPack'); const label = btn ? btn.textContent : '';
    if (btn) btn.disabled = true;
    const setLbl = (s) => { if (btn) btn.textContent = s; };
    Progress.start();
    setLbl('📦 Building pack…');
    try {
      const d = vizData();
      const files = [];

      // 1) social graphics in the chosen template
      for (const [kind, name] of [['square', 'social/instagram-post.png'], ['story', 'social/story-reel.png'], ['wide', 'social/facebook-link.png']]) {
        const cv = offscreenCanvas();
        Visuals.render(brand.templateId, kind, cv, d);
        const bytes = await canvasPNGBytes(cv);
        if (bytes) files.push({ name, data: bytes });
      }

      // 2) carousel — cover + photo highlights + CTA (same composition as the tab)
      const carPhotos = d.photos.filter((p) => p.inCarousel !== false).slice(0, 6);
      if (carPhotos.length) {
        const feats = Generator.flyerFeatures(d.raw, 8);
        let fi = 0; carPhotos.forEach((p) => { if (p._caption == null) p._caption = feats[fi++] || ''; });
        const total = carPhotos.length + 2;
        let n = 0;
        const push = async (cv, suffix) => { const b = await canvasPNGBytes(cv); if (b) files.push({ name: `carousel/${String(++n).padStart(2, '0')}-${suffix}.png`, data: b }); };
        const cover = offscreenCanvas(); Visuals.render(brand.templateId, 'square', cover, d); await push(cover, 'cover');
        for (let i = 0; i < carPhotos.length; i++) {
          const cv = offscreenCanvas();
          Visuals.featureSlide(cv, { photo: carPhotos[i], caption: carPhotos[i]._caption || '', brand, idx: i + 1, total });
          await push(cv, 'photo');
        }
        const cta = offscreenCanvas(); Visuals.ctaSlide(cta, { brand, address: d.address, badgeText: d.badgeText }); await push(cta, 'cta');
      }

      // 3) sign board (with QR if a link is set)
      const sbCv = offscreenCanvas();
      Visuals.signboard(sbCv, { brand, d, status: d.raw.mode === 'rent' ? 'FOR LEASE' : 'FOR SALE', qrUrl: ($('sbUrl').value.trim() || $('importUrl').value.trim()) });
      const sbBytes = await canvasPNGBytes(sbCv);
      if (sbBytes) files.push({ name: 'signboard.png', data: sbBytes });

      // 3b) open-home post + directional sign (only when an inspection time is set)
      const hasOpen = hasOpenHome();
      if (hasOpen) {
        const when = openHomeWhen();
        const opCv = offscreenCanvas(); Visuals.openHomePost(opCv, 'square', { brand, d, when });
        const opB = await canvasPNGBytes(opCv); if (opB) files.push({ name: 'open-home/open-home-post.png', data: opB });
        const asCv = offscreenCanvas(); Visuals.arrowSign(asCv, { brand, d, when, dir: ohDir });
        const asB = await canvasPNGBytes(asCv); if (asB) files.push({ name: 'open-home/directional-sign.png', data: asB });
      }

      // 4) print-ready flyer — self-contained (photos baked in as data URLs so it works from the zip)
      try {
        const fo = flyerOpts();
        const flyerPhotos = fo.photos.map((p) => ({ url: photoToDataURL(p) || '', fcss: p.fcss || '' })).filter((p) => p.url);
        files.push({ name: 'flyer-print.html', data: Flyer.buildHTML({ ...fo, photos: flyerPhotos, print: true }) });
      } catch (e) {}

      // 5) all written copy
      const copy = packCopyText(d);
      if (copy.trim()) files.push({ name: 'copy.txt', data: copy });

      // 6) readme
      const hasQR = !!($('sbUrl').value.trim() || $('importUrl').value.trim());
      files.push({ name: 'README.txt', data:
        'Listing Kit — campaign pack\n' +
        'Listing: ' + (d.address || '(no address)') + '\n' +
        'Created: ' + new Date().toLocaleString() + '\n\n' +
        'Inside:\n' +
        '  social/           Instagram post, story / reel cover, Facebook / link image\n' +
        (carPhotos.length ? '  carousel/         Instagram carousel — post the files in number order\n' : '') +
        '  signboard.png     Photo sign board' + (hasQR ? ' (with QR code)' : '') + '\n' +
        (hasOpen ? '  open-home/        Open-home social post + printable directional sign\n' : '') +
        '  flyer-print.html  Open in a browser, then Print → Save as PDF (A4 / Letter)\n' +
        '  copy.txt          Listing description + Instagram / Facebook / email copy\n\n' +
        'Everything was generated on your device. Nothing was uploaded.\n' });

      if (!files.length) { toast('Nothing to pack yet'); return; }
      saveBlob(Zip.build(files), `${slug()}-campaign-pack.zip`);
      toast(`📦 Campaign pack ready — ${files.length} files`);
    } catch (e) {
      toast('Couldn’t build the pack — try again');
    } finally {
      Progress.stop();
      if (btn) { btn.disabled = false; btn.textContent = label || '📦 Download campaign pack'; }
    }
  };

  // the listing facts the studio binds its price/address/stats/badge layers to
  const studioFields = () => {
    const d = vizData();
    const stats = [d.beds && d.beds + ' BD', d.baths && d.baths + ' BA', d.cars && d.cars + ' CAR', d.sqft && d.sqft + ' ' + (d.areaUnit === 'sqm' ? 'M²' : 'SQ FT')].filter(Boolean).join('  ·  ');
    return { photos: d.photos, fields: { price: d.price, address: d.address, stats, badge: d.badgeText } };
  };
  // open the design studio from anywhere (works before a kit is generated too)
  const openStudio = (arg) => {
    const hint = $('studioHint'); if (hint) hint.hidden = true;   // clear the "saved" notifier on reopen
    clearTimeout(studioHintTimer);
    const opt = (arg && typeof arg === 'object') ? arg : { photoIndex: arg };
    const s = studioFields();
    Studio.open({
      photos: s.photos, brand, fields: s.fields,
      startPhotoIndex: (typeof opt.photoIndex === 'number') ? opt.photoIndex : null,
      seed: opt.seed || null,
      // carousel slide reproduction: the clicked slide's caption + position
      caption: opt.caption || null,
      idx: (typeof opt.idx === 'number') ? opt.idx : null,
      total: (typeof opt.total === 'number') ? opt.total : null,
      // lets the studio upload a photo straight into the listing gallery
      addPhoto: async (file) => { const ok = await addPhotoBlob(file, 'studio'); if (!ok) return null; syncFcss(); return photos[photos.length - 1]; },
      // "Apply to all my graphics" — push the transferable basic adjustments to the real photo
      onApplyPhotoAdjust: (idx, filter) => {
        const p = photos[idx]; if (!p) return;
        p.filter = { b: filter.b != null ? filter.b : 100, c: filter.c != null ? filter.c : 100, s: filter.s != null ? filter.s : 100, w: filter.sep || 0 };
        syncFcss(); rerenderVisuals();
        const adv = filter.highlights || filter.shadows || filter.tint || filter.vignette || filter.sharpness;
        toast(adv ? 'Brightness/contrast applied to all graphics (the studio-only effects stay here)' : '✓ Applied to all your graphics');
      },
      // closed with unsaved edits → point a friendly notifier at the launcher
      onClose: (wasDirty) => { if (wasDirty) showStudioHint(); },
    }, 'square');
  };

  // small "your design is saved — reopen to keep editing" notifier with an arrow
  // pointing at the Design Studio button (only after closing with unsaved work)
  let studioHintTimer = null;
  const showStudioHint = () => {
    const btn = $('studioLaunch'), hint = $('studioHint');
    if (!btn || !hint) return;
    hint.innerHTML = '<b>Saved.</b> Your design is kept here — reopen the Design Studio any time to pick up where you left off.';
    hint.hidden = false;
    const r = btn.getBoundingClientRect();
    hint.style.top = (r.bottom + 10) + 'px';
    const left = Math.min(r.right - hint.offsetWidth, window.innerWidth - hint.offsetWidth - 10);
    hint.style.left = Math.max(10, left) + 'px';
    clearTimeout(studioHintTimer);
    studioHintTimer = setTimeout(() => { hint.hidden = true; }, 7000);
    hint.onclick = () => { hint.hidden = true; };
  };

  // ---------------- flyer tab ----------------
  const flyerOpts = () => {
    const d = vizData();
    return {
      d: { ...d.raw, badgeText: d.badgeText, ohLine: d.ohLine, price: d.price, sqft: Generator.num(d.raw.sqft), cars: d.cars, areaUnit: d.areaUnit },
      brand,
      photos: orderedPhotos(),
      // the flyer has its own Highlights sidebar — drop the bullet block
      mls: outputs ? outputs.mls.split('\n\n').filter((p) => !p.startsWith('At a glance') && !p.startsWith('Features at a glance')).join('\n\n') : '',
      features: Generator.flyerFeatures(d.raw, 7),
    };
  };

  const renderFlyer = () => {
    const frame = $('flyerFrame');
    frame.srcdoc = Flyer.buildHTML({ ...flyerOpts(), print: false });
    scaleFlyer();
  };

  const scaleFlyer = () => {
    const wrap = $('flyerWrap'), frame = $('flyerFrame');
    const { w, h } = Flyer.pagePx(brand);
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    const scale = Math.min(1, (wrap.clientWidth - 24) / w);
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = Math.ceil(h * scale + 24) + 'px';
  };

  // re-render whatever visual surface is active (cheap; canvases only)
  const rerenderVisuals = () => {
    if (!outputs) return;
    if (activeTab === 'graphics') renderGraphics();
    if (activeTab === 'flyer') renderFlyer();
    if (activeTab === 'signboard') renderSignboard();
  };

  // ---- status stamp (SOLD / UNDER OFFER / PRICE REDUCED / LEASED) ----
  const setStamp = (val) => {
    stamp = val || '';
    document.querySelectorAll('#stampRow .stamp-btn').forEach((b) => b.classList.toggle('active', (b.dataset.stamp || '') === stamp));
    rerenderVisuals();
  };
  const wireStamps = () => {
    document.querySelectorAll('#stampRow .stamp-btn').forEach((b) =>
      b.addEventListener('click', () => setStamp(b.dataset.stamp || '')));
  };

  // ---- open-home kit (event post + directional sign + weekly roundup) ----
  const REGION_LOCALE = { au: 'en-AU', us: 'en-US', uk: 'en-GB', other: 'en-AU' };
  const fmtOpenDate = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    try { const dt = new Date(yyyymmdd + 'T00:00:00'); if (!isNaN(dt)) return dt.toLocaleDateString(REGION_LOCALE[brand.region] || 'en-AU', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) {}
    return '';
  };
  const openHomeWhen = () => ({ date: fmtOpenDate($('ohDate').value), time: $('ohTime').value.trim() });
  const hasOpenHome = () => { const w = openHomeWhen(); return !!(w.date || w.time); };
  const renderOpenHome = () => {
    if (!$('ohTime').value.trim() && $('openhouse').value.trim()) $('ohTime').value = $('openhouse').value.trim();   // prefill from the listing's open field
    const d = vizData(), when = openHomeWhen();
    Visuals.openHomePost($('cvOpenPost'), 'square', { brand, d, when });
    Visuals.arrowSign($('cvOpenSign'), { brand, d, when, dir: ohDir });
    $('ohEmpty').hidden = !!(when.date || when.time);
  };
  const buildOpensRoundup = async () => {
    const items = [];
    const seen = new Set();
    const add = (address, when, key) => { const a = (address || '').trim(); if (!a || seen.has(a.toLowerCase())) return; seen.add(a.toLowerCase()); items.push({ address: a, when, _key: key || '' }); };
    const cur = openHomeWhen();
    if (cur.date || cur.time) add($('address').value.trim() || 'This listing', cur, $('ohDate').value);
    try {
      const saved = await libAll();
      saved.forEach((rec) => {
        const f = rec.fields || {};
        if (!f.ohDate && !f.ohTime) return;
        add((f.address || rec.title || '').trim(), { date: fmtOpenDate(f.ohDate), time: (f.ohTime || '').trim() }, f.ohDate || '');
      });
    } catch (e) {}
    if (!items.length) { toast('Add an open date/time (and save listings) to build a roundup'); return; }
    items.sort((a, b) => (a._key || '9999').localeCompare(b._key || '9999'));
    Visuals.opensRoundup($('cvOpenRoundup'), { brand, items });
    $('ohRoundupWrap').hidden = false;
    toast(`Roundup built — ${items.length} listing${items.length === 1 ? '' : 's'}`);
  };
  const wireOpenHome = () => {
    ['ohDate', 'ohTime'].forEach((id) => $(id).addEventListener('input', () => { if (activeTab === 'openhome') renderOpenHome(); saveDraft(); }));
    document.querySelectorAll('#ohDirRow .dir-btn').forEach((b) => b.addEventListener('click', () => {
      ohDir = b.dataset.dir || 'right';
      document.querySelectorAll('#ohDirRow .dir-btn').forEach((x) => x.classList.toggle('active', x === b));
      if (activeTab === 'openhome') renderOpenHome();
    }));
    document.querySelectorAll('#openhomeContent .dlc').forEach((b) => b.addEventListener('click', () => Visuals.download($(b.dataset.canvas), `${slug()}-${b.dataset.name}.png`)));
    $('ohRoundup').addEventListener('click', buildOpensRoundup);
  };

  // ---- animated Reel / Story video (on-device, canvas → MediaRecorder) ----
  const resetReel = () => {
    if (reelURL) { try { URL.revokeObjectURL(reelURL); } catch (e) {} reelURL = ''; }
    reelBlob = null;
    const v = $('reelVideo'); if (v) { v.removeAttribute('src'); v.hidden = true; v.load && v.load(); }
    if ($('cvReel')) $('cvReel').hidden = false;
    if ($('reelDownload')) $('reelDownload').hidden = true;
  };
  const renderReel = () => {
    if (typeof Reel === 'undefined' || !Reel.supported()) {
      $('reelStatus').textContent = 'Video export isn’t supported in this browser — try Chrome, Edge or Safari.';
      $('reelStatus').className = 'parse-note err'; $('reelMake').disabled = true; return;
    }
    $('reelMake').disabled = false;
    if (reelBlob) return;                 // keep a finished video on screen until re-made
    $('reelStatus').textContent = ''; $('reelStatus').className = 'parse-note';
    Reel.previewFrame($('cvReel'), brand, vizData());
  };
  const makeReel = async () => {
    if (typeof Reel === 'undefined' || !Reel.supported()) return;
    resetReel();
    const d = vizData();
    const pics = d.photos.filter((p) => p.inCarousel !== false).slice(0, 6);
    const feats = Generator.flyerFeatures(d.raw, 8);
    let fi = 0; pics.forEach((p) => { if (p._caption == null) p._caption = feats[fi++] || ''; });
    const pace = parseFloat($('reelPace').value) || 2.6;
    const btn = $('reelMake'); btn.disabled = true;
    const st = $('reelStatus'); st.className = 'parse-note'; Progress.start();
    try {
      const res = await Reel.record({
        canvas: $('cvReel'), brand, d, photos: pics, opts: { perPhoto: pace },
        onProgress: (frac) => { st.textContent = `🎬 Rendering… ${Math.round(frac * 100)}% (recorded in real time)`; },
      });
      reelBlob = res.blob; reelExt = res.ext; reelURL = URL.createObjectURL(res.blob);
      const v = $('reelVideo'); v.src = reelURL; v.hidden = false; $('cvReel').hidden = true;
      try { v.play().catch(() => {}); } catch (e) {}
      $('reelDownload').hidden = false;
      st.className = 'parse-note ok';
      st.textContent = res.ext === 'mp4'
        ? '✓ Reel ready (MP4) — ready to upload to Instagram / Facebook.'
        : '✓ Reel ready (WebM) — plays everywhere; for Instagram you may need to convert to MP4 (CapCut or your phone’s editor do this).';
    } catch (e) {
      resetReel();
      st.className = 'parse-note err'; st.textContent = (e && e.message) ? e.message : 'Couldn’t build the reel — try again.';
    } finally { btn.disabled = false; Progress.stop(); }
  };
  const wireReel = () => {
    $('reelMake').addEventListener('click', makeReel);
    $('reelDownload').addEventListener('click', () => { if (reelBlob) saveBlob(reelBlob, `${slug()}-reel.${reelExt}`); });
    $('reelPace').addEventListener('change', () => { resetReel(); renderReel(); });
  };

  // ---------------- tabs ----------------
  // ---- sign board (with QR code) ----
  const renderSignboard = () => {
    const d = vizData();
    if (!$('sbUrl').value.trim() && $('importUrl').value.trim()) $('sbUrl').value = $('importUrl').value.trim();   // prefill from the imported link
    const status = d.raw.mode === 'rent' ? 'FOR LEASE' : 'FOR SALE';
    Visuals.signboard($('cvSignboard'), { brand, d, status, qrUrl: $('sbUrl').value.trim() });
  };

  const renderTab = (tab) => {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    if (!outputs) return;

    ['graphicsContent', 'flyerContent', 'content', 'complianceContent', 'signboardContent', 'openhomeContent', 'reelContent'].forEach((id) => ($(id).hidden = true));

    if (tab === 'graphics') { $('graphicsContent').hidden = false; renderGraphics(); return; }
    if (tab === 'flyer') { $('flyerContent').hidden = false; renderFlyer(); return; }
    if (tab === 'compliance') { $('complianceContent').hidden = false; renderCompliance(); return; }
    if (tab === 'signboard') { $('signboardContent').hidden = false; renderSignboard(); return; }
    if (tab === 'openhome') { $('openhomeContent').hidden = false; renderOpenHome(); return; }
    if (tab === 'reel') { $('reelContent').hidden = false; renderReel(); return; }

    $('content').hidden = false;
    const text = outputs[tab] || '';
    $('copytext').textContent = text;
    updateCharcount();
    resetCopyBtn();
    $('aiBar').hidden = false;
    $('aiStatus').textContent = '';
    updateUndo();
    renderChannelShare(tab);
  };

  // ---- per-channel "Open in…" share row (Instagram / Facebook / Email) ----
  const enc = encodeURIComponent;
  const EMAIL_SERVICES = [
    { id: 'gmail', label: 'Gmail', url: (s, b) => `https://mail.google.com/mail/?view=cm&fs=1&su=${enc(s)}&body=${enc(b)}` },
    { id: 'outlook', label: 'Outlook', url: (s, b) => `https://outlook.live.com/mail/0/deeplink/compose?subject=${enc(s)}&body=${enc(b)}` },
    { id: 'yahoo', label: 'Yahoo Mail', url: (s, b) => `https://compose.mail.yahoo.com/?subject=${enc(s)}&body=${enc(b)}` },
    { id: 'mailto', label: 'Default mail app', url: (s, b) => `mailto:?subject=${enc(s)}&body=${enc(b)}` },
  ];
  const savedEmailSvc = () => { try { return localStorage.getItem('lk_email_svc') || 'gmail'; } catch (e) { return 'gmail'; } };
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } };
  const openEmail = (svcId) => {
    const svc = EMAIL_SERVICES.find((s) => s.id === svcId) || EMAIL_SERVICES[0];
    const raw = (outputs && outputs.email) || '';
    const subM = raw.match(/^\s*subject:\s*(.+)$/im);
    const addr = $('address').value.trim();
    const subject = subM ? subM[1].trim() : (addr ? `New listing — ${addr}` : 'New listing');
    // drop the meta lines (Subject:, (Alt subject: …), Preview text: …) from the body
    const body = raw.split('\n').filter((l) => !/^\s*(subject:|\(alt subject:|preview text:)/i.test(l)).join('\n').trim();
    const url = svc.url(subject, body);
    if (svcId === 'mailto') window.location.href = url; else window.open(url, '_blank', 'noopener');
  };
  const renderChannelShare = (tab) => {
    const box = $('channelShare');
    if (!['instagram', 'facebook', 'email'].includes(tab)) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false; box.innerHTML = '';
    const lbl = document.createElement('span'); lbl.className = 'cs-label';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mini-btn';
    if (tab === 'email') {
      lbl.textContent = 'Open a pre-filled draft in:';
      const sel = document.createElement('select'); sel.className = 'cs-select';
      EMAIL_SERVICES.forEach((s) => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.label; sel.appendChild(o); });
      sel.value = savedEmailSvc();
      sel.addEventListener('change', () => { try { localStorage.setItem('lk_email_svc', sel.value); } catch (e) {} });
      btn.textContent = '✉️ Open email ↗';
      btn.addEventListener('click', () => openEmail(sel.value));
      box.append(lbl, sel, btn);
    } else {
      const isIg = tab === 'instagram';
      lbl.textContent = isIg ? 'Copy the caption & open Instagram:' : 'Copy the post & open Facebook:';
      btn.textContent = isIg ? '📸 Open Instagram ↗' : '👍 Open Facebook ↗';
      const note = document.createElement('span'); note.className = 'cs-note';
      btn.addEventListener('click', async () => {
        const ok = await copyText((outputs && outputs[tab]) || '');
        note.textContent = ok ? '✓ Caption copied — paste it into your post.' : 'Select & copy the text below, then paste it in.';
        window.open(isIg ? 'https://www.instagram.com/' : 'https://www.facebook.com/', '_blank', 'noopener');
      });
      box.append(lbl, btn, note);
    }
  };

  const updateCharcount = () => {
    const chars = (outputs && outputs[activeTab] || '').length;
    let note = `${chars.toLocaleString()} characters`;
    if (activeTab === 'mls') note += chars > 1000 ? ' · long for some portals — many truncate around 1,000' : ' · within typical portal limits';
    if (activeTab === 'instagram') note += ' · Instagram caption limit is 2,200';
    $('charcount').textContent = note + ' · ✏️ click text to edit';
  };

  // edits in the output pane are kept (Copy copies them) and re-scanned
  let rescanTimer = null;
  const wireEditableOutput = () => {
    const el = $('copytext');
    try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
    el.spellcheck = false;
    el.addEventListener('input', () => {
      if (!outputs || activeTab === 'compliance') return;
      outputs[activeTab] = el.innerText;
      updateCharcount();
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(() => {
        const data = readForm();
        report = FairHousing.scan({
          ...outputs,
          'your input': [data.features.join(', '), data.neighborhood, data.address].filter(Boolean).join('. '),
        });
        updateComplianceDot();
      }, 500);
    });
  };

  // ---------------- compliance ----------------
  // jump from a finding to the offending phrase in its copy tab and highlight it
  const jumpToFinding = (f, copyCh) => {
    renderTab(copyCh);
    const text = (outputs && outputs[copyCh]) || '';
    const idx = text.toLowerCase().indexOf(String(f.match).toLowerCase());
    const pre = $('copytext');
    if (idx < 0) { toast('Phrase not found (it may have been edited)'); return; }
    pre.innerHTML = escapeHtml(text.slice(0, idx)) + '<mark class="cx-hit">' + escapeHtml(text.slice(idx, idx + f.match.length)) + '</mark>' + escapeHtml(text.slice(idx + f.match.length));
    const m = pre.querySelector('mark'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' });
    clearTimeout(jumpToFinding._t);
    jumpToFinding._t = setTimeout(() => { if (activeTab === copyCh && outputs) pre.textContent = outputs[copyCh] || ''; }, 4500);
  };
  const renderCompliance = () => {
    const body = $('complianceBody');
    body.innerHTML = '';
    if (!report) return;   // nothing generated yet — don't dereference report.findings
    const summary = document.createElement('div');
    const level = report.clear ? 'clear' : report.counts.high ? 'alert' : 'warn';
    summary.className = 'compliance-summary ' + level;
    const total = report.findings.length;
    if (report.clear) {
      summary.innerHTML = `<span class="big">✅</span><div><h3>All clear</h3><p>No fair-housing language risks found across your inputs or any generated copy.</p></div>`;
    } else {
      const bits = [];
      if (report.counts.high) bits.push(`${report.counts.high} high`);
      if (report.counts.medium) bits.push(`${report.counts.medium} medium`);
      if (report.counts.low) bits.push(`${report.counts.low} low`);
      summary.innerHTML = `<span class="big">${report.counts.high ? '🚩' : '⚠️'}</span><div><h3>${total} item${total === 1 ? '' : 's'} to review</h3><p>${bits.join(' · ')}. Review each before publishing.</p></div>`;
    }
    body.appendChild(summary);

    report.findings.forEach((f) => {
      const el = document.createElement('div');
      el.className = 'finding ' + f.sev;
      const where = f.channels.map((c) => CHANNEL_LABEL[c] || c).join(', ');
      const copyCh = (f.channels || []).find((c) => ['mls', 'instagram', 'facebook', 'email'].includes(c));
      el.innerHTML = `
        <div class="finding-top">
          <span class="flag-phrase">“${escapeHtml(f.match)}”</span>
          <span class="sev ${f.sev}">${f.sev}</span>
          <span class="flag-class">${escapeHtml(f.cls)}</span>
          <span class="flag-where">in ${escapeHtml(where)}${copyCh ? ' ›' : ''}</span>
        </div>
        <div class="finding-why">${escapeHtml(f.why)}</div>
        <div class="finding-fix"><b>Try instead:</b> ${escapeHtml(f.fix)}</div>`;
      if (copyCh) { el.classList.add('finding-jump'); el.title = 'Click to find this phrase in the ' + (CHANNEL_LABEL[copyCh] || copyCh); el.addEventListener('click', () => jumpToFinding(f, copyCh)); }
      body.appendChild(el);
    });

    if (!report.clear) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.style.marginTop = '14px';
      note.textContent = brand.region === 'au'
        ? 'Flags are guidance, not legal advice. In Australia, ads that indicate an intention to discriminate are unlawful under federal anti-discrimination law and the WA Equal Opportunity Act 1984 — when in doubt, check with your agency or REIWA guidance.'
        : brand.region === 'uk'
          ? 'Flags are guidance, not legal advice. In the UK, discriminatory property ads breach the Equality Act 2010 — when in doubt, check with your agency’s compliance guidance.'
          : 'Flags are guidance, not legal advice. When in doubt, check with your broker’s compliance team.';
      body.appendChild(note);
    }

    // AI deeper double-check (catches subtle/coded wording the regex misses)
    const aiRow = document.createElement('div');
    aiRow.className = 'compliance-ai';
    aiRow.innerHTML = '<button type="button" id="aiComplyBtn">🤖 Double-check with AI</button> <span class="hint">— a deeper review for subtle or coded wording (uses your AI key)</span><div id="aiComplyResults"></div>';
    body.appendChild(aiRow);
    $('aiComplyBtn').addEventListener('click', runAiCompliance);
  };
  const runAiCompliance = async () => {
    const box = $('aiComplyResults');
    if (typeof AI === 'undefined' || !AI.available()) { box.innerHTML = '<p class="muted" style="margin-top:8px">Add your Anthropic API key in “Your brand” to use the AI double-check.</p>'; return; }
    const btn = $('aiComplyBtn'); btn.disabled = true; btn.textContent = '🤖 Checking…';
    const text = [outputs && outputs.mls, outputs && outputs.instagram, outputs && outputs.facebook, outputs && outputs.email, $('features').value, $('neighborhood').value, $('address').value].filter(Boolean).join('\n\n');
    try {
      const issues = await AI.compliance(text);
      if (!issues.length) box.innerHTML = '<div class="compliance-summary clear" style="margin-top:10px"><span class="big">✅</span><div><h3>AI found nothing further</h3><p>The AI review didn’t flag anything beyond the scanner above.</p></div></div>';
      else box.innerHTML = '<p class="ai-comply-head">🤖 The AI also flagged:</p>' + issues.map((i) => `<div class="finding medium"><div class="finding-top"><span class="flag-phrase">“${escapeHtml(i.phrase || '')}”</span><span class="flag-class">${escapeHtml(i.issue || '')}</span></div><div class="finding-why">${escapeHtml(i.why || '')}</div><div class="finding-fix"><b>Try instead:</b> ${escapeHtml(i.fix || '')}</div></div>`).join('');
    } catch (e) { box.innerHTML = `<p class="muted" style="margin-top:8px">${escapeHtml((typeof AI !== 'undefined' && AI.explain) ? AI.explain(e) : 'AI check failed')}</p>`; }
    finally { btn.disabled = false; btn.textContent = '🤖 Double-check with AI'; }
  };

  const updateComplianceDot = () => {
    const dot = $('complianceDot');
    dot.className = 'dot';
    if (!report) return;
    if (report.clear) dot.classList.add('clear');
    else if (report.counts.high) dot.classList.add('alert');
    else dot.classList.add('warn');
  };

  // ---------------- copy button ----------------
  const resetCopyBtn = () => { const b = $('copyBtn'); b.textContent = 'Copy'; b.classList.remove('copied'); };
  const doCopy = async () => {
    if (!outputs) return;
    const text = outputs[activeTab] || '';
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove();
    }
    const b = $('copyBtn');
    b.textContent = 'Copied ✓'; b.classList.add('copied');
    setTimeout(resetCopyBtn, 1600);
  };

  // ---------------- field filling (paste + link import share this) ----------------
  const applyParsedFields = (r, overwrite = false) => {
    const fillText = (id, v, fmt) => {
      if (v == null || v === '') return;
      if (overwrite || !$(id).value.trim()) $(id).value = fmt ? fmt(v) : v;
    };
    // separator-formatted numbers ("985,000") must not become NaN in the field
    const num = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? n.toLocaleString('en-US') : String(v); };
    fillText('price', r.price, num);
    fillText('beds', r.beds);
    fillText('baths', r.baths);
    fillText('cars', r.cars);
    fillText('sqft', r.sqft, num);
    fillText('year', r.year);
    fillText('lot', r.lot);
    fillText('address', r.address);
    fillText('city', r.city);
    if (r.currency) $('currency').value = r.currency;
    if (r.areaUnit) $('areaUnit').value = r.areaUnit;
    if (r.type) $('type').value = r.type;
    saveDraft();
  };

  // ---------------- missing-field flags (after paste/import) ----------------
  // After an auto-fill, anything still empty gets a red ring so it's obvious
  // what didn't come through. The ring clears as soon as the field gets typed in.
  const KEY_FIELDS = ['address', 'city', 'price', 'beds', 'baths', 'cars', 'sqft', 'features'];
  const flagMissingFields = () => {
    let missing = 0;
    KEY_FIELDS.forEach((id) => {
      const empty = !$(id).value.trim();
      $(id).classList.toggle('missing', empty);
      if (empty) missing++;
    });
    return missing;
  };
  const clearMissingFlags = () => KEY_FIELDS.forEach((id) => $(id).classList.remove('missing'));

  // ---------------- paste-to-parse (site-agnostic, via parser.js) ----------------
  const parsePaste = () => {
    const t = $('pasteBox').value;
    if (!t.trim()) return;
    const r = Parser.parse(t);
    applyParsedFields(r, false);
    const missing = flagMissingFields();
    $('parseNote').textContent = (r.found.length
      ? `✓ Found: ${[...new Set(r.found)].join(', ')}`
      : 'Nothing recognized — fill the fields manually.')
      + (missing ? ` · ${missing} field${missing === 1 ? '' : 's'} still empty (marked red)` : '');
  };

  // ---------------- link import ----------------
  // live elapsed + "usually 15–40s" estimate while an import is running
  let importT0 = 0, importIv = null, importMsg = '';
  const renderImportBusy = () => {
    const el = $('importStatus'), s = Math.round((Date.now() - importT0) / 1000);
    el.hidden = false; el.className = 'import-status busy';
    el.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${importMsg} ${s}s · usually 15–40s</span>`;
  };
  const importStart = () => { importT0 = Date.now(); Progress.start(); importIv = setInterval(() => { if (importMsg) renderImportBusy(); }, 1000); };
  const importStop = () => { if (importIv) clearInterval(importIv); importIv = null; importT0 = 0; importMsg = ''; Progress.stop(); };
  const setImportStatus = (msg, kind) => {
    const el = $('importStatus');
    if (!kind && importT0) { importMsg = msg; renderImportBusy(); return; }   // in-progress during import → spinner + elapsed + estimate
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'import-status' + (kind ? ' ' + kind : '');
  };

  // determinate import progress bar
  const importBar = (frac) => {
    const wrap = $('importBar');
    if (frac == null) { wrap.classList.add('hide'); wrap.firstElementChild.style.width = '0'; return; }
    wrap.classList.remove('hide');
    wrap.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  };

  // fetch a list of image URLs into local photos; returns how many landed
  const importPhotoURLs = async (urls) => {
    if (!urls.length) return 0;
    setImportStatus(`Importing photos 0/${urls.length}…`);
    importBar(0);
    const blobs = await Importer.fetchImages(urls, (done, total) => { setImportStatus(`Importing photos ${done}/${total}…`); importBar(done / total); });
    let added = 0;
    for (const b of blobs) if (b && photos.length < 14) added += (await addPhotoBlob(b, 'imported')) ? 1 : 0;
    importBar(null);
    return added;
  };
  const importGallery = (ref) => importPhotoURLs(Importer.reiwaGalleryURLs(ref, 12));

  const importFromLink = async () => {
    const url = $('importUrl').value.trim();
    if (!url) { setImportStatus('Paste a listing link first.', 'err'); return; }
    if (!/^https?:\/\//i.test(url)) { setImportStatus('That doesn’t look like a link — it should start with https://', 'err'); return; }
    const btn = $('importBtn');
    btn.disabled = true; btn.textContent = '…';
    importStart();
    try {
      // direct image link → just add the photo
      if (Importer.isImageURL(url) && !/reiwa\.com\.au\/[a-z]/i.test(url)) {
        setImportStatus('Fetching photo…');
        const blob = await Importer.fetchImageBlob(url);
        if (blob) { await addPhotoBlob(blob, 'imported'); setImportStatus('✓ Photo added.', 'ok'); rerenderVisuals(); }
        else setImportStatus('Couldn’t fetch that image (the site may block proxies). Try right-click → Copy Image, then paste it in the box below.', 'err');
        return;
      }

      // importing a listing replaces whatever was loaded — stale fields from a
      // previous property (especially price) must never bleed into this one
      clearListing();
      setImportStatus('Fetching the listing page…');
      const slug = Importer.reiwaSlugInfo(url);
      const page = await Importer.fetchPage(url);
      if (!page) {
        // REIWA never fully fails: the link itself gives address + suburb,
        // and the photo gallery doesn't need the page at all.
        const refOnly = Importer.reiwaRefFromURL(url);
        if (refOnly) {
          if (slug) applyParsedFields(slug, true);
          const added = await importGallery(refOnly);
          const gaps = flagMissingFields();
          setImportStatus(added
            ? `⚠ Text proxies are busy right now, so price/beds couldn’t be read — but the address and ${added} photos are in. Fill the ${gaps} red field${gaps === 1 ? '' : 's'} (10 seconds) and you’re away.`
            : '⚠ Proxies are busy right now — try again in a minute, or paste the listing text below.', added ? 'ok' : 'err');
          if (added) generate();
          return;
        }
        setImportStatus(
          Importer.isBlockedPortal(url)
            ? 'That site blocks automated imports. Tip: almost every WA listing is also on reiwa.com.au — find the same address there and import that link. Or copy the page text into the box below and drag the photos in.'
            : 'Couldn’t fetch that page. Copy the listing text into the box below instead — and drag photos straight into the photo area.',
          'err');
        return;
      }

      // details
      setImportStatus('Reading the details…');
      const text = Importer.cleanText(page.kind, page.text);
      const parsed = Parser.parse(text);
      if (page.kind === 'html') Object.assign(parsed, ((ld) => { Object.keys(ld).forEach((k) => ld[k] == null && delete ld[k]); return ld; })(Importer.jsonLD(page.text)));

      // photos — REIWA: recover the full numbered gallery; others: page images
      let imgURLs = Importer.extractImages(page.kind, page.text);

      // thin result (pre-render shell)? get a second opinion from the HTML route
      if (page.kind === 'md' && (!imgURLs.length || !parsed.beds)) {
        setImportStatus('Page came back thin — trying a second route…');
        const alt = await Importer.fetchPageHTML(url);
        if (alt) {
          const altParsed = Parser.parse(Importer.cleanText('html', alt.text));
          Object.assign(altParsed, ((ld) => { Object.keys(ld).forEach((k) => ld[k] == null && delete ld[k]); return ld; })(Importer.jsonLD(alt.text)));
          Object.keys(altParsed).forEach((k) => {
            if (k === 'found') { (altParsed.found || []).forEach((f) => parsed.found.push(f)); return; }
            if (parsed[k] == null || parsed[k] === '') parsed[k] = altParsed[k];
          });
          if (!imgURLs.length) imgURLs = Importer.extractImages('html', alt.text);
        }
      }
      applyParsedFields(parsed, true);
      if (slug) applyParsedFields(slug, false);   // backstop for thin pages
      const ref = imgURLs.map(Importer.reiwaRef).find(Boolean) || Importer.reiwaRefFromURL(url);
      if (ref) imgURLs = Importer.reiwaGalleryURLs(ref, 12);
      const added = await importPhotoURLs(imgURLs);

      const got = [...new Set(parsed.found || [])];
      const bits = [];
      if (got.length) bits.push(got.join(', '));
      bits.push(added ? `${added} photo${added === 1 ? '' : 's'}` : 'no photos (drag them in from the page)');
      const stillEmpty = flagMissingFields();
      setImportStatus(`✓ Imported: ${bits.join(' · ')}${parsed.price ? '' : ' — no advertised price found (offers campaign?), add one if you have it'}${stillEmpty ? ` · ${stillEmpty} field${stillEmpty === 1 ? '' : 's'} still empty (marked red)` : ''}`, 'ok');

      // one-action flow: if we got the essentials, build the kit right away
      if ((parsed.address || parsed.beds) && added) generate();
    } catch (e) {
      setImportStatus('Import failed unexpectedly — paste the listing text below instead.', 'err');
    } finally {
      importBar(null);
      importStop();
      btn.disabled = false; btn.textContent = 'Import';
    }
  };

  // ---------------- draft autosave (listing fields survive a refresh) ----------------
  const DRAFT_KEY = 'lk_draft_v1';
  const LISTING_FIELDS = ['address', 'city', 'price', 'currency', 'currencyCustom', 'rentPeriod', 'rentPeriodCustom', 'badge', 'badgeCustom', 'openhouse', 'type', 'typeCustom', 'tone', 'beds', 'baths', 'cars', 'sqft', 'areaUnit', 'areaUnitCustom', 'year', 'lot', 'available', 'bond', 'leaseTerm', 'leaseTermCustom', 'furnished', 'pets', 'features', 'neighborhood', 'sbUrl', 'ohDate', 'ohTime'];
  let draftTimer = null;
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const draft = { __mode: mode };
      LISTING_FIELDS.forEach((id) => (draft[id] = $(id).value));
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    }, 400);
  };
  const restoreDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      if (draft.__mode) applyMode(draft.__mode, false); // rebuild status options before setting badge
      LISTING_FIELDS.forEach((id) => { if (draft[id] != null && draft[id] !== '') $(id).value = draft[id]; });
      syncCustomWraps();
    } catch (e) {}
  };
  const clearListing = () => {
    applyMode('sale', false);
    LISTING_FIELDS.forEach((id) => {
      const el = $(id);
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    applyRegionDefaults();
    syncCustomWraps();
    clearMissingFlags();
    photos.forEach((p) => { if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url); });
    photos = []; heroIndex = 0;
    renderPhotoGrid();
    document.querySelectorAll('#featureChips .chip').forEach((c) => c.classList.remove('added'));
    stamp = '';
    document.querySelectorAll('#stampRow .stamp-btn').forEach((b) => b.classList.toggle('active', !b.dataset.stamp));
    ohDir = 'right';
    document.querySelectorAll('#ohDirRow .dir-btn').forEach((b) => b.classList.toggle('active', b.dataset.dir === 'right'));
    if ($('ohRoundupWrap')) $('ohRoundupWrap').hidden = true;
    resetReel();
    outputs = null; report = null;
    // a cleared listing must not let Undo/Redo resurrect the previous property's copy
    history = { mls: [], instagram: [], facebook: [], email: [] };
    redoStack = { mls: [], instagram: [], facebook: [], email: [] };
    ['graphicsContent', 'flyerContent', 'content', 'complianceContent'].forEach((id) => ($(id).hidden = true));
    $('emptyState').hidden = false;
    $('complianceDot').className = 'dot';
    $('parseNote').textContent = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  };

  // ---------------- transient toast ----------------
  const toast = (msg) => { const t = $('toast'); if (!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600); };

  // ---------------- saved-listings library (IndexedDB, on-device) ----------------
  const LIB_DB = 'lk_library', LIB_STORE = 'listings';
  const idb = () => new Promise((res, rej) => { let r; try { r = indexedDB.open(LIB_DB, 1); } catch (e) { return rej(e); } r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(LIB_STORE)) db.createObjectStore(LIB_STORE, { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const libTx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(LIB_STORE, mode); const rq = fn(tx.objectStore(LIB_STORE)); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }); };
  const libAll = () => libTx('readonly', (st) => st.getAll());
  const libGet = (id) => libTx('readonly', (st) => st.get(id));
  const libPut = (rec) => libTx('readwrite', (st) => st.put(rec));
  const libDel = (id) => libTx('readwrite', (st) => st.delete(id));

  // serialize a photo to a size-capped JPEG data URL for storage
  const photoToDataURL = (p) => {
    if (p.url && p.url.startsWith('data:')) return p.url;
    const img = p.img; if (!img || !img.width) return null;
    const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  };
  const addSavedPhoto = (ph) => new Promise((res) => { const img = new Image(); img.onload = () => { photos.push({ url: ph.dataURL, img, name: ph.name || 'photo', inCarousel: ph.inCarousel !== false, filter: ph.filter || { b: 100, c: 100, s: 100, w: 0 }, focus: ph.focus || 'center' }); res(true); }; img.onerror = () => res(false); img.src = ph.dataURL; });

  const saveCurrentListing = async () => {
    if (!$('address').value.trim() && !photos.length) { toast('Add an address or a photo first'); return; }
    const fields = {}; LISTING_FIELDS.forEach((id) => { fields[id] = $(id).value; });
    const rec = { id: 'L' + Date.now() + Math.floor(Math.random() * 1e4), savedAt: Date.now(), title: ($('address').value.trim() || 'Untitled listing'), mode, heroIndex, fields, photos: photos.map((p) => ({ dataURL: photoToDataURL(p), name: p.name, filter: p.filter, focus: p.focus, inCarousel: p.inCarousel })).filter((p) => p.dataURL) };
    try { await libPut(rec); renderLibrary(); toast('✓ Saved to this device'); } catch (e) { toast('Couldn’t save — storage may be full or blocked'); }
  };
  const openListing = async (id) => {
    let rec; try { rec = await libGet(id); } catch (e) { return; } if (!rec) return;
    clearListing();
    applyMode(rec.mode || 'sale', false);
    LISTING_FIELDS.forEach((k) => { if (rec.fields[k] != null) $(k).value = rec.fields[k]; });
    syncCustomWraps();
    for (const ph of (rec.photos || [])) await addSavedPhoto(ph);
    heroIndex = Math.min(Math.max(0, rec.heroIndex || 0), Math.max(0, photos.length - 1));
    syncFcss(); renderPhotoGrid(); clearMissingFlags();
    $('librarySection').open = false;
    generate();
    toast('Listing opened');
  };
  const cloneListing = async (id) => { const rec = await libGet(id); if (!rec) return; await libPut({ ...rec, id: 'L' + Date.now() + Math.floor(Math.random() * 1e4), savedAt: Date.now(), title: (rec.title || 'Listing') + ' (copy)' }); renderLibrary(); toast('Cloned'); };
  const deleteListing = async (id) => { try { await libDel(id); } catch (e) {} renderLibrary(); };
  const renderLibrary = async () => {
    const box = $('libList'); if (!box) return;
    let list = [];
    try { list = await libAll(); } catch (e) { box.innerHTML = '<div class="lib-empty">Saved listings aren’t available in this browser.</div>'; return; }
    list.sort((a, b) => b.savedAt - a.savedAt);
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="lib-empty">No saved listings yet — save one above.</div>'; return; }
    list.forEach((rec) => {
      const row = document.createElement('div'); row.className = 'lib-item';
      const thumb = document.createElement('img'); thumb.className = 'lib-thumb'; thumb.alt = ''; if (rec.photos && rec.photos[0]) thumb.src = rec.photos[0].dataURL;
      const main = document.createElement('div'); main.className = 'lib-main'; main.title = 'Open this listing';
      const np = (rec.photos || []).length;
      const title = document.createElement('div'); title.className = 'lib-title'; title.textContent = rec.title || 'Untitled';
      const sub = document.createElement('div'); sub.className = 'lib-sub'; sub.textContent = `${np} photo${np === 1 ? '' : 's'} · ${new Date(rec.savedAt).toLocaleDateString()}`;
      main.append(title, sub);
      main.addEventListener('click', () => openListing(rec.id));
      const clone = document.createElement('button'); clone.type = 'button'; clone.className = 'lib-act'; clone.title = 'Clone'; clone.textContent = '⎘'; clone.addEventListener('click', () => cloneListing(rec.id));
      const del = document.createElement('button'); del.type = 'button'; del.className = 'lib-act del'; del.title = 'Delete'; del.textContent = '×'; del.addEventListener('click', () => deleteListing(rec.id));
      row.append(thumb, main, clone, del); box.appendChild(row);
    });
  };

  // ---------------- misc wiring ----------------
  const wireChips = () => {
    document.querySelectorAll('#featureChips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const ta = $('features');
        const existing = ta.value.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
        const val = chip.textContent.trim();
        if (existing.includes(val.toLowerCase())) {
          ta.value = ta.value.split(/,\s*/).filter((s) => s.trim().toLowerCase() !== val.toLowerCase()).join(', ');
          chip.classList.remove('added');
        } else {
          ta.value = ta.value.trim() ? ta.value.replace(/,?\s*$/, '') + ', ' + val : val;
          chip.classList.add('added');
        }
        // chips set the value programmatically, so no 'input' event fires —
        // clear the red "missing" flag and persist the draft ourselves
        ta.classList.toggle('missing', !ta.value.trim());
        saveDraft();
      });
    });
  };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- undo / redo history (per text channel) ----------------
  let history = { mls: [], instagram: [], facebook: [], email: [] };
  let redoStack = { mls: [], instagram: [], facebook: [], email: [] };
  const pushHistory = (tab) => {
    if (!outputs || outputs[tab] == null || !history[tab]) return;
    history[tab].push(outputs[tab]);
    if (history[tab].length > 25) history[tab].shift();
    if (redoStack[tab]) redoStack[tab] = [];   // a fresh change invalidates the redo trail
  };
  const snapshotAll = () => { if (outputs) ['mls', 'instagram', 'facebook', 'email'].forEach(pushHistory); };
  const updateUndo = () => {
    $('undoBtn').disabled = !(history[activeTab] && history[activeTab].length);
    if ($('redoBtn')) $('redoBtn').disabled = !(redoStack[activeTab] && redoStack[activeTab].length);
  };

  // ---------------- AI polish (bring-your-own-key) ----------------
  const AI_CHANNEL = {
    mls: 'property listing description',
    instagram: 'Instagram caption',
    facebook: 'Facebook post',
    email: 'database email (keep the Subject and Preview text lines at the top)',
  };
  const TYPE_WORD = { single: 'house', apartment: 'apartment', villa: 'villa', townhouse: 'townhouse', condo: 'condo', multi: 'multi-family property', luxury: 'luxury home', land: 'block of land' };

  // the only facts the model is allowed to use — built straight from the form
  const aiFacts = () => {
    const d = readForm();
    const L = [];
    L.push(`Listing type: ${d.mode === 'rent' ? 'FOR RENT / lease' : 'FOR SALE'}`);
    if (d.address) L.push(`Address: ${d.address}${d.city ? ', ' + d.city : ''}`);
    if (Generator.money(d.price)) L.push(d.mode === 'rent' ? `Rent: ${Generator.priceLong(d)}` : `Price: ${Generator.money(d.price, d.currency)}`);
    L.push(`Property type: ${d.type === 'customtype' && d.typeCustom ? d.typeCustom : (TYPE_WORD[d.type] || 'home')}`);
    const bb = [d.beds && `${d.beds} bed`, d.baths && `${d.baths} bath`, d.cars && `${d.cars} car`].filter(Boolean);
    if (bb.length) L.push(`Configuration: ${bb.join(', ')}`);
    if (Generator.num(d.sqft)) L.push(`Internal size: ${Generator.num(d.sqft)} ${d.areaUnit === 'sqm' ? 'm²' : d.areaUnit === 'sqft' ? 'sq ft' : d.areaUnit}`);
    if (d.lot) L.push(`Land / block: ${d.lot}`);
    if (d.year) L.push(`Year built: ${d.year}`);
    if (d.mode === 'rent') {
      if (d.available) L.push(`Available from: ${d.available}`);
      if (d.bond) L.push(`Bond: ${Generator.money(d.bond, d.currency) || d.bond}`);
      if (d.leaseTerm) L.push(`Lease term: ${d.leaseTerm}`);
      if (d.furnished) L.push(`Furnishing: ${d.furnished === 'part' ? 'part-furnished' : d.furnished}`);
      if (Generator.petPhrase(d.pets)) L.push(`Pets: ${Generator.petPhrase(d.pets)}`);
    }
    if (d.features.length) L.push(`Features (use only these): ${d.features.join(', ')}`);
    if (d.neighborhood) L.push(`Location highlights: ${d.neighborhood}`);
    if ((d.badge === 'openhouse' || d.badge === 'inspection') && d.openhouse) L.push(`${d.mode === 'rent' ? 'Inspection' : 'Home open'}: ${d.openhouse}`);
    L.push(`Status: ${Generator.badgeText(d)}`);
    const contact = [d.agentName, d.brokerage, d.phone, d.email].filter(Boolean).join(', ');
    if (contact) L.push(`Agent (for sign-off): ${contact}`);
    return L.join('\n');
  };

  const aiStyle = () => {
    const p = brand.prefs || {};
    const S = [`Tone: ${$('tone').selectedOptions[0].textContent}`];
    S.push(`Region: ${({ au: 'Australia — Australian English', us: 'United States — US English', uk: 'United Kingdom — British English', other: 'international English' }[brand.region])}`);
    if (p.noEmojis) S.push('Do not use any emojis.');
    if (p.noHashtags) S.push('Do not use hashtags.');
    if (p.noExclaim) S.push('Do not use exclamation marks.');
    if (p.short) S.push('Keep it concise.');
    if (p.greeting) S.push(`Emails open with "${p.greeting}".`);
    if (p.signoff) S.push(`Emails sign off with "${p.signoff}".`);
    if (p.banned) S.push(`Never use these words: ${p.banned}.`);
    return S.join('\n');
  };

  const setAiButtons = (on) => { $('aiPolishBtn').disabled = on; $('aiApply').disabled = on; $('aiPolishBtn').textContent = on ? '…' : '✨ Polish'; };
  const aiBusy = (on, msg, kind) => {
    $('aiStatus').textContent = msg || '';
    $('aiStatus').className = 'ai-status' + (kind ? ' ' + kind : '');
    setAiButtons(on);
  };

  const runAI = async (mode, instruction) => {
    if (!outputs || !AI_CHANNEL[activeTab]) return;
    if (!AI.available()) {
      $('brandSection').open = true;
      setTimeout(() => $('aiKey').focus(), 50);
      aiBusy(false, 'Add your API key in “Your brand” to enable AI.', 'err');
      return;
    }
    setAiButtons(true);
    const busy = startBusy($('aiStatus'), 'ai-status', mode === 'polish' ? 'Polishing' : 'Revising', '5–20s');
    try {
      const opts = { channelLabel: AI_CHANNEL[activeTab], currentText: outputs[activeTab], facts: aiFacts(), style: aiStyle() };
      const text = mode === 'polish' ? await AI.polish(opts) : await AI.instruct({ ...opts, instruction });
      if (!text) { busy.finish('No change returned — try again.', 'err'); setAiButtons(false); return; }
      pushHistory(activeTab); // remember the before-AI version so Undo works
      // mechanical house-style is still enforced, and compliance re-scanned
      const single = Generator.applyPrefs({ [activeTab]: text }, brand.prefs || {});
      outputs[activeTab] = single[activeTab];
      $('copytext').textContent = outputs[activeTab];
      updateCharcount();
      runScan();
      updateUndo();
      busy.finish('✓ Updated with ' + AI.modelLabel() + ' · ↶ Undo to compare', 'ok');
      if (mode === 'instruct') $('aiInstruction').value = '';
    } catch (e) {
      busy.finish(AI.explain(e), 'err');
    } finally {
      setAiButtons(false);
    }
  };

  const wireAI = () => {
    // populate key + model from localStorage; show status
    $('aiModel').value = AI.getModel();
    const showKeyStatus = () => {
      $('aiKeyStatus').textContent = AI.available() ? `✓ AI ready (${AI.modelLabel()})` : '';
      $('aiKeyStatus').className = 'parse-note';
    };
    if (AI.available()) $('aiKey').placeholder = '•••• saved — paste a new key to replace';
    showKeyStatus();
    $('aiKeySave').addEventListener('click', () => {
      const k = $('aiKey').value.trim();
      if (!k) { AI.setKey(''); $('aiKeyStatus').textContent = 'Key cleared.'; return; }
      AI.setKey(k); $('aiKey').value = ''; $('aiKey').placeholder = '•••• saved — paste a new key to replace';
      showKeyStatus();
    });
    $('aiModel').addEventListener('change', () => { AI.setModel($('aiModel').value); showKeyStatus(); });
    $('aiTest').addEventListener('click', async () => {
      const typed = $('aiKey').value.trim();
      const prev = AI.getKey();
      if (!typed && !prev) { $('aiKeyStatus').textContent = 'Paste a key first.'; return; }
      $('aiKeyStatus').textContent = 'Testing…'; $('aiKeyStatus').className = 'parse-note';
      if (typed) AI.setKey(typed);   // tentatively use the typed key for the test
      try {
        await AI.test();
        $('aiKey').value = ''; $('aiKey').placeholder = '•••• saved — paste a new key to replace';
        $('aiKeyStatus').textContent = `✓ Key works — AI ready (${AI.modelLabel()})`;
      } catch (e) {
        AI.setKey(prev);   // a failed test must never leave a broken key saved/“available”
        $('aiKeyStatus').textContent = AI.explain(e);
      }
    });
    $('aiPolishBtn').addEventListener('click', () => runAI('polish'));
    $('aiApply').addEventListener('click', () => { const i = $('aiInstruction').value.trim(); if (i) runAI('instruct', i); else $('aiInstruction').focus(); });
    $('aiInstruction').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const i = e.target.value.trim(); if (i) runAI('instruct', i); } });
  };

  // AI + live web search → real nearby amenities into Location highlights
  const researchLocation = async () => {
    const note = (msg, kind) => { $('researchStatus').textContent = msg; $('researchStatus').className = 'parse-note' + (kind ? ' ' + kind : ''); };
    if (!AI.available()) { $('brandSection').open = true; setTimeout(() => $('aiKey').focus(), 50); note('Add your API key in “Your brand” to enable AI.', 'err'); return; }
    const address = $('address').value.trim(), suburb = $('city').value.trim();
    if (!address && !suburb) { note('Enter an address or suburb first.', 'err'); return; }
    $('researchBtn').disabled = true;
    const busy = startBusy($('researchStatus'), 'parse-note', 'Researching nearby amenities (web search)', '10–25s');
    try {
      const phrase = (await AI.research({ address, suburb, region: brand.region }) || '').replace(/^["'“]+|["'”]+$/g, '').trim();
      if (phrase) {
        $('neighborhood').value = phrase;
        $('neighborhood').classList.remove('missing');
        saveDraft();
        busy.finish('✓ Filled — check it reads right, then Generate (or Reword).', 'ok');
        if (outputs) generate();
      } else busy.finish('Nothing found — fill it in manually.', 'err');
    } catch (e) {
      busy.finish(AI.explain(e), 'err');
    } finally {
      $('researchBtn').disabled = false;
    }
  };

  // ---------------- events ----------------
  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  form.addEventListener('input', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('missing');
    saveDraft();
    Studio.refreshFields(studioFields().fields);   // live form → open studio binding
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderTab(t.dataset.tab)));
  $('studioLaunch').addEventListener('click', openStudio);
  $('copyBtn').addEventListener('click', doCopy);
  $('rewordBtn').addEventListener('click', () => { if (outputs) generate(); });
  $('undoBtn').addEventListener('click', () => {
    if (!outputs || !(history[activeTab] && history[activeTab].length)) return;
    redoStack[activeTab].push(outputs[activeTab]);   // remember current so Redo can restore it
    outputs[activeTab] = history[activeTab].pop();
    $('copytext').textContent = outputs[activeTab];
    updateCharcount(); runScan(); updateUndo();
    aiBusy(false, '↩ Reverted to the previous version', 'ok');
  });
  $('redoBtn').addEventListener('click', () => {
    if (!outputs || !(redoStack[activeTab] && redoStack[activeTab].length)) return;
    history[activeTab].push(outputs[activeTab]);
    outputs[activeTab] = redoStack[activeTab].pop();
    $('copytext').textContent = outputs[activeTab];
    updateCharcount(); runScan(); updateUndo();
    aiBusy(false, '↪ Redid the change', 'ok');
  });
  $('researchBtn').addEventListener('click', researchLocation);
  $('clearBtn').addEventListener('click', clearListing);

  // import + paste UX
  $('importBtn').addEventListener('click', importFromLink);
  $('importUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); importFromLink(); } });
  $('clipBtn').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { $('pasteBox').value = t; parsePaste(); }
      else $('parseNote').textContent = 'Clipboard is empty — copy the listing text first.';
    } catch (e) {
      $('parseNote').textContent = 'Clipboard blocked — click in the box and press Ctrl/Cmd+V instead.';
    }
  });
  $('pasteBox').addEventListener('paste', (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      addPhotoFiles(files);
      $('parseNote').textContent = `📸 ${files.length} photo${files.length === 1 ? '' : 's'} added below.`;
      rerenderVisuals();
      return;
    }
    setTimeout(parsePaste, 60);   // let the text land, then auto-fill
  });
  // pasting a copied photo anywhere (outside inputs) adds it too
  window.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) { addPhotoFiles(files); rerenderVisuals(); }
  });
  $('flyerOpen').addEventListener('click', () => { if (outputs) Flyer.openPrint(flyerOpts()); });
  // selects with a Custom… option reveal their own text input
  const isInspectBadge = () => $('badge').value === 'openhouse' || $('badge').value === 'inspection';
  const wireCustomToggles = () => {
    $('badge').addEventListener('change', () => {
      $('openhouseWrap').hidden = !isInspectBadge();
      $('badgeCustomWrap').hidden = $('badge').value !== 'custom';
      if ($('badge').value === 'custom') $('badgeCustom').focus();
      rerenderVisuals();
    });
    $('type').addEventListener('change', () => {
      $('typeCustomWrap').hidden = $('type').value !== 'customtype';
      if ($('type').value === 'customtype') $('typeCustom').focus();
      rerenderVisuals();
    });
    $('currency').addEventListener('change', () => {
      $('currencyCustom').hidden = $('currency').value !== 'custom';
      if ($('currency').value === 'custom') $('currencyCustom').focus();
      rerenderVisuals();
    });
    $('areaUnit').addEventListener('change', () => {
      $('areaUnitCustom').hidden = $('areaUnit').value !== 'customunit';
      if ($('areaUnit').value === 'customunit') $('areaUnitCustom').focus();
      rerenderVisuals();
    });
    $('rentPeriod').addEventListener('change', () => {
      $('rentPeriodCustom').hidden = $('rentPeriod').value !== 'custom';
      if ($('rentPeriod').value === 'custom') $('rentPeriodCustom').focus();
      rerenderVisuals();
    });
    $('leaseTerm').addEventListener('change', () => {
      $('leaseTermCustom').hidden = $('leaseTerm').value !== 'custom';
      if ($('leaseTerm').value === 'custom') $('leaseTermCustom').focus();
      rerenderVisuals();
    });
    // keep the visible custom-input state in sync (drafts, region defaults)
    syncCustomWraps();
  };
  const syncCustomWraps = () => {
    $('openhouseWrap').hidden = !isInspectBadge();
    $('badgeCustomWrap').hidden = $('badge').value !== 'custom';
    $('typeCustomWrap').hidden = $('type').value !== 'customtype';
    $('currencyCustom').hidden = $('currency').value !== 'custom';
    $('areaUnitCustom').hidden = $('areaUnit').value !== 'customunit';
    $('rentPeriodCustom').hidden = !(mode === 'rent' && $('rentPeriod').value === 'custom');
    $('leaseTermCustom').hidden = $('leaseTerm').value !== 'custom';
  };

  // ---------------- listing type (sale / rent) ----------------
  const applyMode = (m, keepStatus) => {
    mode = m === 'rent' ? 'rent' : 'sale';
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    // rebuild status options, preserving the selection if it still exists
    const prev = $('badge').value;
    const opts = mode === 'rent' ? RENT_STATUS : SALE_STATUS;
    $('badge').innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    if (keepStatus && opts.some(([v]) => v === prev)) $('badge').value = prev;
    // show/hide + relabel
    $('rentFields').hidden = mode !== 'rent';
    $('rentPeriod').hidden = mode !== 'rent';
    $('priceLabel').textContent = mode === 'rent' ? 'Rent' : 'Price';
    $('price').placeholder = mode === 'rent' ? 'e.g. 650' : '';
    $('openhouseWrap').querySelector('label').textContent = mode === 'rent' ? 'Inspection date/time' : 'Home open date/time';
    syncCustomWraps();
  };
  ['badgeCustom', 'openhouse', 'cars', 'currency', 'areaUnit', 'typeCustom', 'currencyCustom', 'areaUnitCustom'].forEach((id) =>
    $(id).addEventListener('input', rerenderVisuals));
  // custom badge/type text also flows through the written copy — refresh it
  // once the agent finishes typing (change = on blur)
  ['badgeCustom', 'typeCustom'].forEach((id) =>
    $(id).addEventListener('change', () => { if (outputs) generate(); }));
  wireCustomToggles();
  document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    applyMode(b.dataset.mode, false);
    saveDraft();
    if (outputs) generate(); else rerenderVisuals();
  }));
  ['available', 'bond', 'leaseTerm', 'leaseTermCustom', 'furnished', 'pets', 'rentPeriod', 'rentPeriodCustom'].forEach((id) =>
    $(id).addEventListener('input', () => { rerenderVisuals(); saveDraft(); }));
  document.querySelectorAll('.tpl').forEach((t) => t.addEventListener('click', () => {
    brand.templateId = t.dataset.tpl;
    saveBrand(); markTemplate(); rerenderVisuals();
  }));
  bindBrandField('agentName', 'agentName');
  bindBrandField('brokerage', 'brokerage');
  bindBrandField('phone', 'phone');
  bindBrandField('email', 'email');
  // house style controls -> brand.prefs object
  const PREF_CHECKS = { prefNoEmojis: 'noEmojis', prefNoHashtags: 'noHashtags', prefNoExclaim: 'noExclaim', prefShort: 'short' };
  Object.entries(PREF_CHECKS).forEach(([id, key]) => {
    $(id).addEventListener('change', () => {
      brand.prefs[key] = $(id).checked;
      saveBrand();
      if (outputs) generate();
    });
  });
  [['prefGreeting', 'greeting'], ['prefSignoff', 'signoff'], ['prefBanned', 'banned']].forEach(([id, key]) => {
    $(id).addEventListener('input', () => { brand.prefs[key] = $(id).value; saveBrand(); });
    $(id).addEventListener('change', () => { if (outputs) generate(); });
  });
  bindBrandField('brandPrimary', 'primary');
  bindBrandField('brandAccent', 'accent');
  bindBrandField('brandFont', 'font');
  $('region').addEventListener('change', () => {
    brand.region = $('region').value;
    applyRegionDefaults();
    saveBrand(); rerenderVisuals();
    if (activeTab === 'compliance' && report) renderCompliance();
  });
  $('designExport').addEventListener('click', exportDesign);
  $('designImport').addEventListener('change', (e) => {
    if (e.target.files[0]) importDesign(e.target.files[0]);
    e.target.value = '';
  });
  wireImagePick('logo', 'logo');
  wireImagePick('head', 'headshot');
  wireChips();
  wireStamps();
  wireOpenHome();
  wireReel();
  wireDropZone();
  wireDownloads();
  wireLightbox();
  wireShare();
  wireSignboard();
  wireEditableOutput();
  wireAI();
  // accessibility: announce async status updates to screen readers
  ['importStatus', 'parseNote', 'researchStatus', 'aiStatus', 'aiKeyStatus', 'stAiStatus'].forEach((id) => { const e = $(id); if (e) { e.setAttribute('role', 'status'); e.setAttribute('aria-live', 'polite'); } });
  // ⌘/Ctrl+Enter generates from anywhere (except while the studio overlay is open)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && $('studio').hidden) { e.preventDefault(); generate(); }
  });
  // saved-listings library
  $('libSave').addEventListener('click', saveCurrentListing);
  renderLibrary();
  wirePhotoEditor();
  renderPalettes();
  window.addEventListener('resize', () => { if (activeTab === 'flyer' && outputs) scaleFlyer(); });

  // ---------------- theme (light / dark) ----------------
  const applyTheme = (t) => {
    document.body.classList.toggle('dark', t === 'dark');
    $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#14171b' : '#0f2e3d');
  };
  let theme;
  try { theme = localStorage.getItem('lk_theme'); } catch (e) {}
  if (!theme) theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(theme);
  $('themeToggle').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('lk_theme', theme); } catch (e) {}
    applyTheme(theme);
  });

  // about/privacy popover (replaces the old bottom footer warning)
  $('infoBtn').addEventListener('click', (e) => { e.stopPropagation(); $('infoPop').hidden = !$('infoPop').hidden; });
  document.addEventListener('click', (e) => { if (!$('infoPop').hidden && !$('infoPop').contains(e.target) && e.target !== $('infoBtn')) $('infoPop').hidden = true; });
  $('infoTour').addEventListener('click', () => { $('infoPop').hidden = true; Tour.start(); });
  $('tourBtn').addEventListener('click', () => Tour.start());

  loadBrand();
  restoreDraft();
  $('verLine').textContent = 'Listing Kit ' + APP_VERSION;

  // integration/test hook
  window.ListingKit = { addPhotoDataURL, generate, importFromLink, downloadCampaignPack };

  // register service worker for offline / installable use
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
