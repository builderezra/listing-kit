/* Listing Kit — UI wiring: read the form, generate copy, run the fair-housing
 * scan, drive the tabs and copy buttons. No framework, no build. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('listingForm');

  // current generation state
  let outputs = null;     // { mls, instagram, facebook, email, flyer }
  let report = null;      // fair-housing scan result
  let activeTab = 'mls';

  const CHANNEL_LABEL = { mls: 'MLS description', instagram: 'Instagram caption', facebook: 'Facebook post', email: 'Email blast', flyer: 'Flyer copy' };

  // ---- read the form into a plain data object ------------------------------
  const readForm = () => ({
    address: $('address').value.trim(),
    city: $('city').value.trim(),
    price: $('price').value.trim(),
    type: $('type').value,
    tone: $('tone').value,
    beds: $('beds').value.trim(),
    baths: $('baths').value.trim(),
    sqft: $('sqft').value.trim(),
    year: $('year').value.trim(),
    lot: $('lot').value.trim(),
    features: $('features').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    neighborhood: $('neighborhood').value.trim(),
    agentName: $('agentName').value.trim(),
    brokerage: $('brokerage').value.trim(),
    phone: $('phone').value.trim(),
    email: $('email').value.trim(),
  });

  // ---- generate ------------------------------------------------------------
  const generate = () => {
    const data = readForm();
    outputs = Generator.generate(data);

    // Scan generated copy AND the agent's own typed-in text (features +
    // location) — that's where most violations actually originate.
    report = FairHousing.scan({
      ...outputs,
      'your input': [data.features.join(', '), data.neighborhood, data.address].filter(Boolean).join('. '),
    });

    $('emptyState').hidden = true;
    updateComplianceDot();
    renderTab(activeTab === 'compliance' ? 'compliance' : activeTab);
  };

  // ---- tabs ----------------------------------------------------------------
  const renderTab = (tab) => {
    activeTab = tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));

    const textPane = $('content');
    const compPane = $('complianceContent');

    if (!outputs) return; // nothing generated yet

    if (tab === 'compliance') {
      textPane.hidden = true;
      compPane.hidden = false;
      renderCompliance();
      return;
    }

    compPane.hidden = true;
    textPane.hidden = false;
    const text = outputs[tab] || '';
    $('copytext').textContent = text;
    const chars = text.length;
    let note = `${chars.toLocaleString()} characters`;
    if (tab === 'mls') note += chars > 1000 ? ' · over the 1,000-char MLS limit on some boards' : ' · within typical MLS limits';
    if (tab === 'instagram') note += ' · Instagram caption limit is 2,200';
    $('charcount').textContent = note;
    resetCopyBtn();
  };

  // ---- compliance report ---------------------------------------------------
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
      note.textContent = 'Flags are guidance, not legal advice. Some phrases (e.g. “primary bedroom” vs “master”) are stylistic; others are genuine liability. When in doubt, check with your broker’s compliance team.';
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

  // ---- copy ----------------------------------------------------------------
  const resetCopyBtn = () => { const b = $('copyBtn'); b.textContent = 'Copy'; b.classList.remove('copied'); };
  const doCopy = async () => {
    if (!outputs || activeTab === 'compliance') return;
    const text = outputs[activeTab] || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    const b = $('copyBtn');
    b.textContent = 'Copied ✓'; b.classList.add('copied');
    setTimeout(resetCopyBtn, 1600);
  };

  // ---- feature quick-add chips ---------------------------------------------
  const wireChips = () => {
    document.querySelectorAll('#featureChips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const ta = $('features');
        const existing = ta.value.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
        const val = chip.textContent.trim();
        if (existing.includes(val.toLowerCase())) {
          // toggle off
          ta.value = ta.value.split(/,\s*/).filter((s) => s.trim().toLowerCase() !== val.toLowerCase()).join(', ');
          chip.classList.remove('added');
        } else {
          ta.value = ta.value.trim() ? ta.value.replace(/,?\s*$/, '') + ', ' + val : val;
          chip.classList.add('added');
        }
      });
    });
  };

  // ---- example listing -----------------------------------------------------
  const EXAMPLE = {
    address: '142 Maple Grove Ln', city: 'Asheville', price: '525,000', type: 'single', tone: 'warm',
    beds: '3', baths: '2', sqft: '1,850', year: '1998', lot: '0.3-acre',
    features: 'Updated kitchen, hardwood floors, primary suite, fenced backyard, finished basement, stainless appliances',
    neighborhood: 'minutes from downtown, the greenway, and local coffee shops',
    agentName: 'Ezra Smith', brokerage: 'Blue Ridge Realty', phone: '(828) 555-0142', email: 'ezra@blueridge.com',
  };
  const loadExample = () => {
    Object.entries(EXAMPLE).forEach(([k, v]) => { if ($(k)) $(k).value = v; });
    document.querySelectorAll('#featureChips .chip').forEach((c) => c.classList.remove('added'));
    generate();
  };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- events --------------------------------------------------------------
  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => renderTab(t.dataset.tab)));
  $('copyBtn').addEventListener('click', doCopy);
  $('exampleBtn').addEventListener('click', loadExample);
  wireChips();

  // register service worker for offline / installable use
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
