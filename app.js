/* Listing Kit v2 — UI wiring: brand kit (persisted), photo management, copy +
 * graphics + flyer generation, fair-housing scan, tabs, downloads.
 * No framework, no build, nothing leaves the browser. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('listingForm');
  const BRAND_KEY = 'lk_brand_v2';

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
      photos.push({ url, img, name: f.name });
    });
    renderPhotoGrid();
  };

  // test/integration hook: add a photo from a dataURL
  const addPhotoDataURL = (dataURL, name = 'photo') => {
    const img = new Image();
    img.onload = () => { renderPhotoGrid(); rerenderVisuals(); };
    img.src = dataURL;
    photos.push({ url: dataURL, img, name });
    renderPhotoGrid();
  };

  const orderedPhotos = () => {
    if (!photos.length) return [];
    return [photos[heroIndex], ...photos.filter((_, i) => i !== heroIndex)];
  };

  const renderPhotoGrid = () => {
    const grid = $('photoGrid');
    grid.innerHTML = '';
    photos.forEach((p, i) => {
      const cell = document.createElement('div');
      cell.className = 'photo-card' + (i === heroIndex ? ' hero' : '');
      cell.innerHTML = `<img src="${p.url}" alt="">` +
        (i === heroIndex ? '<span class="hero-tag">★ hero</span>' : '') +
        `<button type="button" class="photo-x" title="Remove">×</button>`;
      cell.querySelector('img').addEventListener('click', () => { heroIndex = i; renderPhotoGrid(); rerenderVisuals(); });
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
    dz.addEventListener('drop', (e) => addPhotoFiles(e.dataTransfer.files));
  };

  // ---------------- form ----------------
  const readForm = () => ({
    address: $('address').value.trim(),
    city: $('city').value.trim(),
    price: $('price').value.trim(),
    currency: $('currency').value,
    badge: $('badge').value,
    badgeCustom: $('badgeCustom').value.trim(),
    openhouse: $('openhouse').value.trim(),
    type: $('type').value,
    tone: $('tone').value,
    beds: $('beds').value.trim(),
    baths: $('baths').value.trim(),
    cars: $('cars').value.trim(),
    sqft: $('sqft').value.trim(),
    areaUnit: $('areaUnit').value,
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
    outputs = Generator.generate(data);
    report = FairHousing.scan({
      ...outputs,
      'your input': [data.features.join(', '), data.neighborhood, data.address].filter(Boolean).join('. '),
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
      photos: orderedPhotos(),
      raw: d,
    };
  };

  // ---------------- graphics tab ----------------
  const renderGraphics = () => {
    const d = vizData();
    Visuals.render(brand.templateId, 'square', $('cvSquare'), d);
    Visuals.render(brand.templateId, 'story', $('cvStory'), d);
    Visuals.render(brand.templateId, 'wide', $('cvWide'), d);
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
  };

  // ---------------- flyer tab ----------------
  const flyerOpts = () => {
    const d = vizData();
    return {
      d: { ...d.raw, badgeText: d.badgeText, ohLine: d.ohLine, price: d.price, sqft: Generator.num(d.raw.sqft), cars: d.cars, areaUnit: d.areaUnit },
      brand,
      photos: orderedPhotos(),
      mls: outputs ? outputs.mls : '',
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
    const scale = Math.min(1, (wrap.clientWidth - 24) / 816);
    frame.style.transform = `scale(${scale})`;
    wrap.style.height = Math.ceil(1056 * scale + 24) + 'px';
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
    const chars = text.length;
    let note = `${chars.toLocaleString()} characters`;
    if (tab === 'mls') note += chars > 1000 ? ' · long for some portals — many truncate around 1,000' : ' · within typical portal limits';
    if (tab === 'instagram') note += ' · Instagram caption limit is 2,200';
    $('charcount').textContent = note;
    resetCopyBtn();
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

  // ---------------- paste-to-parse (site-agnostic, via parser.js) ----------------
  const parsePaste = () => {
    const t = $('pasteBox').value;
    if (!t.trim()) return;
    const r = Parser.parse(t);
    const fillText = (id, v, fmt) => { if (v != null && v !== '' && !$(id).value.trim()) $(id).value = fmt ? fmt(v) : v; };
    fillText('price', r.price, (v) => v.toLocaleString('en-US'));
    fillText('beds', r.beds);
    fillText('baths', r.baths);
    fillText('cars', r.cars);
    fillText('sqft', r.sqft, (v) => v.toLocaleString('en-US'));
    fillText('year', r.year);
    fillText('lot', r.lot);
    fillText('address', r.address);
    fillText('city', r.city);
    if (r.currency) $('currency').value = r.currency;
    if (r.areaUnit) $('areaUnit').value = r.areaUnit;
    if (r.type) $('type').value = r.type;
    $('parseNote').textContent = r.found.length
      ? `✓ Found: ${[...new Set(r.found)].join(', ')}`
      : 'Nothing recognized — fill the fields manually.';
  };

  // ---------------- example listing (with synthesized photos) ----------------
  const samplePhoto = (hueA, hueB, emoji) => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1100;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1600, 1100);
    g.addColorStop(0, `hsl(${hueA}, 38%, 62%)`);
    g.addColorStop(1, `hsl(${hueB}, 42%, 38%)`);
    x.fillStyle = g; x.fillRect(0, 0, 1600, 1100);
    x.globalAlpha = 0.25; x.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(140 + i * 270, i % 2 ? 280 : 760, 150, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
    x.font = '300px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(emoji, 800, 560);
    return c.toDataURL('image/jpeg', 0.85);
  };

  const EXAMPLE = {
    address: '24 Seaview Terrace', city: 'Scarborough', price: '985,000', type: 'single', tone: 'warm',
    beds: '4', baths: '2', cars: '2', sqft: '220', year: '2004', lot: '450 m²',
    features: 'Renovated kitchen, stone benchtops, open-plan living, alfresco entertaining area, double garage, solar panels, reverse-cycle aircon, walk-in robe',
    neighborhood: 'minutes from Scarborough Beach, the coastal path, and local cafés',
  };
  const loadExample = () => {
    Object.entries(EXAMPLE).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
    $('currency').value = '$'; $('areaUnit').value = 'sqm';
    if (!brand.agentName) {
      brand.agentName = 'Ezra Smith'; brand.brokerage = 'Sunset Coast Realty';
      brand.phone = '0400 555 142'; brand.email = 'ezra@sunsetcoast.com.au';
      $('agentName').value = brand.agentName; $('brokerage').value = brand.brokerage;
      $('phone').value = brand.phone; $('email').value = brand.email;
      saveBrand();
    }
    if (!photos.length) {
      addPhotoDataURL(samplePhoto(95, 200, '🏡'), 'exterior');
      addPhotoDataURL(samplePhoto(35, 20, '🛋️'), 'living-room');
      addPhotoDataURL(samplePhoto(140, 170, '🌳'), 'backyard');
    }
    document.querySelectorAll('#featureChips .chip').forEach((c) => c.classList.remove('added'));
    // photos load async from dataURLs; generate after they decode
    setTimeout(generate, 120);
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
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderTab(t.dataset.tab)));
  $('copyBtn').addEventListener('click', doCopy);
  $('exampleBtn').addEventListener('click', loadExample);
  $('parseBtn').addEventListener('click', parsePaste);
  $('flyerOpen').addEventListener('click', () => { if (outputs) Flyer.openPrint(flyerOpts()); });
  $('badge').addEventListener('change', () => {
    $('openhouseWrap').hidden = $('badge').value !== 'openhouse';
    $('badgeCustomWrap').hidden = $('badge').value !== 'custom';
    rerenderVisuals();
  });
  ['badgeCustom', 'openhouse', 'cars', 'currency', 'areaUnit'].forEach((id) =>
    $(id).addEventListener('input', rerenderVisuals));
  document.querySelectorAll('.tpl').forEach((t) => t.addEventListener('click', () => {
    brand.templateId = t.dataset.tpl;
    saveBrand(); markTemplate(); rerenderVisuals();
  }));
  bindBrandField('agentName', 'agentName');
  bindBrandField('brokerage', 'brokerage');
  bindBrandField('phone', 'phone');
  bindBrandField('email', 'email');
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
  renderPalettes();
  window.addEventListener('resize', () => { if (activeTab === 'flyer' && outputs) scaleFlyer(); });

  loadBrand();

  // integration/test hook
  window.ListingKit = { addPhotoDataURL, generate, loadExample };

  // register service worker for offline / installable use
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
