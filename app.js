/* Listing Kit v2 — UI wiring: brand kit (persisted), photo management, copy +
 * graphics + flyer generation, fair-housing scan, tabs, downloads.
 * No framework, no build, nothing leaves the browser. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('listingForm');
  const BRAND_KEY = 'lk_brand_v2';
  const APP_VERSION = 'v10';

  // ---------------- state ----------------
  let photos = [];        // [{url, img, name}] — hero is photos[heroIndex]
  let heroIndex = 0;
  let outputs = null;     // { mls, instagram, facebook, email }
  let report = null;      // fair-housing scan result
  let activeTab = 'graphics';
  let brand = {
    agentName: '', brokerage: '', phone: '', email: '',
    primary: '#0f2e3d', accent: '#c08a3e',
    logo: '', headshot: '',      // dataURLs (persisted)
    templateId: 'modern',
    font: 'auto',                // headline font: auto | serif | sans
    prefs: '',                   // house style directives ("no emojis, sign off with Cheers")
    region: 'au',                // au | us | uk | other — drives defaults + compliance framing
  };
  brand.logoImg = null; brand.headImg = null; // live Image objects

  const CHANNEL_LABEL = { mls: 'Listing description', instagram: 'Instagram caption', facebook: 'Facebook post', email: 'Email blast' };

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
    $('prefs').value = brand.prefs || '';
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
      photos.push({ url, img, name: f.name, inCarousel: true });
    });
    renderPhotoGrid();
  };

  // test/integration hook: add a photo from a dataURL
  const addPhotoDataURL = (dataURL, name = 'photo') => {
    const img = new Image();
    img.onload = () => { renderPhotoGrid(); rerenderVisuals(); };
    img.src = dataURL;
    photos.push({ url: dataURL, img, name, inCarousel: true });
    renderPhotoGrid();
  };

  // add a photo from fetched bytes (link import) — local blob, canvas-safe
  const addPhotoBlob = (blob, name = 'imported') =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { photos.push({ url, img, name, inCarousel: true }); renderPhotoGrid(); resolve(true); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });

  const orderedPhotos = () => {
    if (!photos.length) return [];
    return [photos[heroIndex], ...photos.filter((_, i) => i !== heroIndex)];
  };

  const FOCUS_ORDER = ['center', 'top', 'bottom'];
  const FOCUS_ICON = { center: '⊙', top: '⬆', bottom: '⬇' };
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
      cell.innerHTML = `<img src="${p.url}" alt="">` +
        (i === heroIndex ? '<span class="hero-tag">★ hero</span>' : '') +
        `<button type="button" class="photo-x" title="Remove">×</button>` +
        `<button type="button" class="photo-focus${focus !== 'center' ? ' on' : ''}" title="Crop focus: ${focus} (click to change)">${FOCUS_ICON[focus]}</button>`;
      cell.querySelector('img').addEventListener('click', () => { heroIndex = i; renderPhotoGrid(); rerenderVisuals(); });
      cell.querySelector('.photo-focus').addEventListener('click', () => {
        p.focus = FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length];
        renderPhotoGrid(); rerenderVisuals();
      });
      cell.querySelector('.photo-x').addEventListener('click', () => {
        if (p.url.startsWith('blob:')) URL.revokeObjectURL(p.url);
        photos.splice(i, 1);
        if (heroIndex >= photos.length) heroIndex = 0;
        else if (i < heroIndex) heroIndex--;
        renderPhotoGrid(); rerenderVisuals();
      });
      grid.appendChild(cell);
    });
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
    address: $('address').value.trim(),
    city: $('city').value.trim(),
    price: $('price').value.trim(),
    currency: $('currency').value === 'custom' ? ($('currencyCustom').value.trim() || '$') : $('currency').value,
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
    features: $('features').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    neighborhood: $('neighborhood').value.trim(),
    agentName: brand.agentName, brokerage: brand.brokerage, phone: brand.phone, email: brand.email,
    region: brand.region,
    photoCount: photos.length,
  });

  // ---------------- generate ----------------
  const generate = () => {
    const data = readForm();
    const prefs = Generator.parsePrefs(brand.prefs);
    outputs = Generator.applyPrefs(Generator.generate(data), prefs);
    report = FairHousing.scan({
      ...outputs,
      'your input': [data.features.join(', '), data.neighborhood, data.address].filter(Boolean).join('. '),
    });
    // the agent's own banned words join the compliance report
    (prefs.banned || []).forEach((w) => {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      const channels = Object.keys(outputs).filter((k) => re.test(outputs[k]));
      if (channels.length) {
        report.findings.push({ match: w, cls: 'Your style rule', sev: 'medium', why: `You asked to avoid “${w}”.`, fix: 'Edit the text in place, or hit ↻ Reword for different phrasing.', channels });
        report.counts.medium++;
        report.clear = false;
      }
    });
    $('emptyState').hidden = true;
    updateComplianceDot();
    renderTab(activeTab);
  };

  const vizData = () => {
    const d = readForm();
    return {
      badgeText: Generator.badgeText(d),
      ohLine: d.badge === 'openhouse' && d.openhouse ? d.openhouse : '',
      price: Generator.money(d.price, d.currency),
      address: [d.address, d.city].filter(Boolean).join(', '),
      beds: d.beds, baths: d.baths, cars: d.cars,
      sqft: Generator.num(d.sqft), areaUnit: d.areaUnit,
      brand,
      hero: photos[heroIndex] ? photos[heroIndex].img : null,
      heroFocus: photos[heroIndex] ? photos[heroIndex].focus : 'center',
      photos: orderedPhotos(),
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

    const feats = Generator.flyerFeatures(d.raw, 6);
    const slides = d.photos.filter((p) => p.inCarousel !== false).slice(0, 6);
    const total = slides.length + 2;

    const addSlide = (label, renderFn) => {
      const cell = document.createElement('div');
      cell.className = 'car-slide';
      const cv = document.createElement('canvas');
      renderFn(cv);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn dl-mini';
      btn.textContent = label;
      const n = carouselCanvases.length + 1;
      btn.addEventListener('click', () => Visuals.download(cv, `${slug()}-carousel-${String(n).padStart(2, '0')}.png`));
      cell.appendChild(cv); cell.appendChild(btn);
      row.appendChild(cell);
      carouselCanvases.push(cv);
    };

    addSlide('1 · Cover', (cv) => Visuals.render(brand.templateId, 'square', cv, d));
    slides.forEach((p, i) =>
      addSlide(`${i + 2} · Photo`, (cv) => Visuals.featureSlide(cv, { photo: p, caption: feats[i] || '', brand, idx: i + 1, total })));
    addSlide(`${total} · CTA`, (cv) => Visuals.ctaSlide(cv, { brand, address: d.address, badgeText: d.badgeText }));
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
  };

  // ---------------- flyer tab ----------------
  const flyerOpts = () => {
    const d = vizData();
    return {
      d: { ...d.raw, badgeText: d.badgeText, ohLine: d.ohLine, price: d.price, sqft: Generator.num(d.raw.sqft), cars: d.cars, areaUnit: d.areaUnit },
      brand,
      photos: orderedPhotos(),
      // the flyer has its own Highlights sidebar — drop the bullet block
      mls: outputs ? outputs.mls.split('\n\n').filter((p) => !p.startsWith('Features at a glance')).join('\n\n') : '',
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
  };

  // ---------------- tabs ----------------
  const renderTab = (tab) => {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    if (!outputs) return;

    ['graphicsContent', 'flyerContent', 'content', 'complianceContent'].forEach((id) => ($(id).hidden = true));

    if (tab === 'graphics') { $('graphicsContent').hidden = false; renderGraphics(); return; }
    if (tab === 'flyer') { $('flyerContent').hidden = false; renderFlyer(); return; }
    if (tab === 'compliance') { $('complianceContent').hidden = false; renderCompliance(); return; }

    $('content').hidden = false;
    const text = outputs[tab] || '';
    $('copytext').textContent = text;
    updateCharcount();
    resetCopyBtn();
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
  const renderCompliance = () => {
    const body = $('complianceBody');
    body.innerHTML = '';
    const summary = document.createElement('div');
    const level = !report || report.clear ? 'clear' : report.counts.high ? 'alert' : 'warn';
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
      el.innerHTML = `
        <div class="finding-top">
          <span class="flag-phrase">“${escapeHtml(f.match)}”</span>
          <span class="sev ${f.sev}">${f.sev}</span>
          <span class="flag-class">${escapeHtml(f.cls)}</span>
          <span class="flag-where">in ${escapeHtml(where)}</span>
        </div>
        <div class="finding-why">${escapeHtml(f.why)}</div>
        <div class="finding-fix"><b>Try instead:</b> ${escapeHtml(f.fix)}</div>`;
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
    fillText('price', r.price, (v) => Number(v).toLocaleString('en-US'));
    fillText('beds', r.beds);
    fillText('baths', r.baths);
    fillText('cars', r.cars);
    fillText('sqft', r.sqft, (v) => Number(v).toLocaleString('en-US'));
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
  const setImportStatus = (msg, kind) => {
    const el = $('importStatus');
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'import-status' + (kind ? ' ' + kind : '');
  };

  // fetch a list of image URLs into local photos; returns how many landed
  const importPhotoURLs = async (urls) => {
    if (!urls.length) return 0;
    setImportStatus(`Importing photos 0/${urls.length}…`);
    const blobs = await Importer.fetchImages(urls, (done, total) => setImportStatus(`Importing photos ${done}/${total}…`));
    let added = 0;
    for (const b of blobs) if (b && photos.length < 14) added += (await addPhotoBlob(b, 'imported')) ? 1 : 0;
    return added;
  };
  const importGallery = (ref) => importPhotoURLs(Importer.reiwaGalleryURLs(ref, 12));

  const importFromLink = async () => {
    const url = $('importUrl').value.trim();
    if (!url) { setImportStatus('Paste a listing link first.', 'err'); return; }
    if (!/^https?:\/\//i.test(url)) { setImportStatus('That doesn’t look like a link — it should start with https://', 'err'); return; }
    const btn = $('importBtn');
    btn.disabled = true; btn.textContent = '…';
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
      btn.disabled = false; btn.textContent = 'Import';
    }
  };

  // ---------------- draft autosave (listing fields survive a refresh) ----------------
  const DRAFT_KEY = 'lk_draft_v1';
  const LISTING_FIELDS = ['address', 'city', 'price', 'currency', 'currencyCustom', 'badge', 'badgeCustom', 'openhouse', 'type', 'typeCustom', 'tone', 'beds', 'baths', 'cars', 'sqft', 'areaUnit', 'areaUnitCustom', 'year', 'lot', 'features', 'neighborhood'];
  let draftTimer = null;
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const draft = {};
      LISTING_FIELDS.forEach((id) => (draft[id] = $(id).value));
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
    }, 400);
  };
  const restoreDraft = () => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      LISTING_FIELDS.forEach((id) => { if (draft[id] != null && draft[id] !== '') $(id).value = draft[id]; });
      syncCustomWraps();
    } catch (e) {}
  };
  const clearListing = () => {
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
    outputs = null; report = null;
    ['graphicsContent', 'flyerContent', 'content', 'complianceContent'].forEach((id) => ($(id).hidden = true));
    $('emptyState').hidden = false;
    $('complianceDot').className = 'dot';
    $('parseNote').textContent = '';
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
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
      });
    });
  };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- events ----------------
  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  form.addEventListener('input', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('missing');
    saveDraft();
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderTab(t.dataset.tab)));
  $('copyBtn').addEventListener('click', doCopy);
  $('rewordBtn').addEventListener('click', () => { if (outputs) generate(); });
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
  const wireCustomToggles = () => {
    $('badge').addEventListener('change', () => {
      $('openhouseWrap').hidden = $('badge').value !== 'openhouse';
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
    // keep the visible custom-input state in sync (drafts, region defaults)
    syncCustomWraps();
  };
  const syncCustomWraps = () => {
    $('openhouseWrap').hidden = $('badge').value !== 'openhouse';
    $('badgeCustomWrap').hidden = $('badge').value !== 'custom';
    $('typeCustomWrap').hidden = $('type').value !== 'customtype';
    $('currencyCustom').hidden = $('currency').value !== 'custom';
    $('areaUnitCustom').hidden = $('areaUnit').value !== 'customunit';
  };
  ['badgeCustom', 'openhouse', 'cars', 'currency', 'areaUnit', 'typeCustom', 'currencyCustom', 'areaUnitCustom'].forEach((id) =>
    $(id).addEventListener('input', rerenderVisuals));
  // custom badge/type text also flows through the written copy — refresh it
  // once the agent finishes typing (change = on blur)
  ['badgeCustom', 'typeCustom'].forEach((id) =>
    $(id).addEventListener('change', () => { if (outputs) generate(); }));
  wireCustomToggles();
  document.querySelectorAll('.tpl').forEach((t) => t.addEventListener('click', () => {
    brand.templateId = t.dataset.tpl;
    saveBrand(); markTemplate(); rerenderVisuals();
  }));
  bindBrandField('agentName', 'agentName');
  bindBrandField('brokerage', 'brokerage');
  bindBrandField('phone', 'phone');
  bindBrandField('email', 'email');
  bindBrandField('prefs', 'prefs');
  $('prefs').addEventListener('change', () => { if (outputs) generate(); });
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
  wireDropZone();
  wireDownloads();
  wireEditableOutput();
  renderPalettes();
  window.addEventListener('resize', () => { if (activeTab === 'flyer' && outputs) scaleFlyer(); });

  loadBrand();
  restoreDraft();
  $('verTag').textContent = 'Listing Kit ' + APP_VERSION;

  // integration/test hook
  window.ListingKit = { addPhotoDataURL, generate, importFromLink };

  // register service worker for offline / installable use
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
