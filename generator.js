/* Listing Kit — marketing copy generator.
 *
 * Runs entirely in the browser. No API, no network, no key. Given a listing,
 * it assembles polished, property-aware, tone-driven copy for every channel an
 * agent needs: MLS description, Instagram, Facebook, an email blast, and flyer
 * copy. The vocabulary is written to steer clear of fair-housing landmines by
 * construction; fairhousing.js then audits the result (and the agent's own
 * typed-in text) as a backstop.
 */
const Generator = (() => {
  'use strict';

  // ---- small utilities ------------------------------------------------------
  const rng = (max) => Math.floor(Math.random() * max);
  const pick = (arr) => arr[rng(arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pickN = (arr, n) => shuffle(arr).slice(0, n);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const oxford = (items) => {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  };
  const num = (n) => {
    if (n == null || n === '') return '';
    const v = Number(String(n).replace(/[^0-9.]/g, ''));
    return isFinite(v) ? v.toLocaleString('en-US') : '';
  };
  const money = (n) => {
    if (n == null || n === '') return '';
    const v = Number(String(n).replace(/[^0-9.]/g, ''));
    if (!isFinite(v) || v === 0) return '';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  // ---- price tiers drive how "aspirational" the language gets ---------------
  const priceTier = (price) => {
    const v = Number(String(price || '').replace(/[^0-9.]/g, ''));
    if (!v) return 'mid';
    if (v >= 1500000) return 'luxury';
    if (v >= 750000) return 'upper';
    if (v <= 300000) return 'value';
    return 'mid';
  };

  // ---- property-type nouns --------------------------------------------------
  const TYPE_NOUN = {
    single: ['home', 'residence', 'single-family home'],
    condo: ['condo', 'residence', 'condominium'],
    townhouse: ['townhome', 'residence', 'townhouse'],
    multi: ['property', 'multi-family property', 'investment property'],
    land: ['lot', 'parcel', 'property'],
    luxury: ['estate', 'residence', 'home'],
  };
  const typeNoun = (type) => pick(TYPE_NOUN[type] || TYPE_NOUN.single);

  // ---- feature dictionary: raw input -> polished phrasing --------------------
  // Each entry: trigger keywords + a few interchangeable phrasings. Phrases are
  // written so they read naturally mid-sentence ("...featuring <phrase>").
  const FEATURE_LIB = [
    { k: ['updated kitchen', 'renovated kitchen', 'new kitchen', 'chef'], p: ['a renovated chef’s kitchen', 'a beautifully updated kitchen', 'a sleek, modern kitchen'] },
    { k: ['kitchen'], p: ['a bright, functional kitchen', 'a well-appointed kitchen'] },
    { k: ['stainless'], p: ['stainless steel appliances'] },
    { k: ['quartz', 'granite', 'countertop'], p: ['stone countertops', 'upgraded countertops'] },
    { k: ['island'], p: ['a generous center island'] },
    { k: ['hardwood', 'wood floor'], p: ['gleaming hardwood floors', 'rich hardwood flooring'] },
    { k: ['tile floor', 'tile'], p: ['designer tile work'] },
    { k: ['open floor', 'open concept', 'open-concept', 'open plan'], p: ['an open-concept layout', 'a flowing open floor plan'] },
    { k: ['natural light', 'bright', 'sunlit', 'sunny'], p: ['abundant natural light', 'sun-filled living spaces'] },
    { k: ['high ceiling', 'vaulted', 'cathedral'], p: ['soaring ceilings', 'dramatic vaulted ceilings'] },
    { k: ['fireplace'], p: ['a cozy fireplace', 'a statement fireplace'] },
    { k: ['primary suite', 'master suite', 'owner’s suite', 'owners suite', 'primary bedroom', 'master bedroom'], p: ['a spacious primary suite', 'a serene primary retreat'] },
    { k: ['walk-in closet', 'walk in closet'], p: ['generous walk-in closets'] },
    { k: ['spa', 'soaking tub', 'en-suite', 'ensuite'], p: ['a spa-inspired bath', 'a luxurious en-suite bath'] },
    { k: ['pool'], p: ['a sparkling pool', 'a resort-style pool'] },
    { k: ['hot tub', 'jacuzzi', 'spa tub'], p: ['a relaxing hot tub'] },
    { k: ['backyard', 'back yard', 'fenced yard', 'yard'], p: ['a private, fenced backyard', 'a generous backyard'] },
    { k: ['deck', 'patio', 'pergola'], p: ['an entertainer’s deck', 'an inviting outdoor patio'] },
    { k: ['balcony', 'terrace'], p: ['a private balcony', 'a sun-soaked terrace'] },
    { k: ['view', 'overlook'], p: ['captivating views', 'stunning views'] },
    { k: ['garage'], p: ['a spacious garage', 'attached garage parking'] },
    { k: ['basement', 'lower level'], p: ['a finished lower level', 'a versatile finished basement'] },
    { k: ['bonus room', 'flex room', 'office', 'den', 'study'], p: ['a flexible bonus room', 'a dedicated home office'] },
    { k: ['smart home', 'smart-home', 'nest', 'smart thermostat'], p: ['smart-home technology'] },
    { k: ['solar'], p: ['energy-saving solar panels'] },
    { k: ['new roof', 'new hvac', 'new windows', 'new furnace', 'new water heater', 'updated systems', 'new ac'], p: ['major recent upgrades', 'big-ticket updates already done'] },
    { k: ['remodel', 'renovat', 'updated', 'upgraded', 'move-in', 'move in', 'turnkey', 'turn-key'], p: ['a tasteful, move-in-ready renovation', 'thoughtful updates throughout'] },
    { k: ['storage'], p: ['ample storage throughout'] },
    { k: ['laundry', 'mudroom'], p: ['a convenient laundry/mud room'] },
    { k: ['corner lot', 'cul-de-sac', 'cul de sac', 'large lot', 'acre', 'private lot'], p: ['a desirable lot', 'a premium lot position'] },
  ];

  // Convert the user's freeform features into polished phrases (deduped).
  const polishFeatures = (features) => {
    const out = [];
    const used = new Set();
    features.forEach((raw) => {
      const f = raw.trim().toLowerCase();
      if (!f) return;
      let matched = false;
      for (const entry of FEATURE_LIB) {
        if (entry.k.some((kw) => f.includes(kw))) {
          const phrase = pick(entry.p);
          const key = entry.p[0];
          if (!used.has(key)) { out.push(phrase); used.add(key); matched = true; }
          else matched = true;
          break;
        }
      }
      if (!matched) {
        // Unknown feature: use it verbatim but lightly dressed.
        const clean = raw.trim().replace(/\.$/, '');
        if (!used.has(clean.toLowerCase())) {
          out.push(clean.charAt(0) >= 'A' && clean.charAt(0) <= 'Z' ? clean.toLowerCase() : clean);
          used.add(clean.toLowerCase());
        }
      }
    });
    return out;
  };

  // ---- opening hooks, keyed by tone ----------------------------------------
  const OPENERS = {
    luxury: [
      'An extraordinary {noun} where timeless design meets everyday comfort.',
      'Refined living defines this exceptional {noun}.',
      'Welcome to a {noun} of rare distinction and craftsmanship.',
      'Sophistication and ease come together in this remarkable {noun}.',
    ],
    warm: [
      'Welcome home to this inviting {noun} with character at every turn.',
      'There’s an easy, welcoming feel the moment you step into this {noun}.',
      'Comfort and charm meet in this lovingly maintained {noun}.',
      'This is the kind of {noun} that just feels right from the front door.',
    ],
    modern: [
      'Clean lines and smart design shape this striking {noun}.',
      'A fresh, contemporary {noun} built for the way you live today.',
      'Style and function meet in this thoughtfully designed {noun}.',
      'Sleek, bright, and effortless — this {noun} delivers.',
    ],
    investor: [
      'A standout opportunity in a {noun} that pairs strong fundamentals with upside.',
      'Smart buyers will appreciate the numbers behind this {noun}.',
      'A well-positioned {noun} ready to perform from day one.',
      'Value, condition, and location align in this {noun}.',
    ],
    classic: [
      'Proudly presenting this well-appointed {noun}.',
      'A wonderful opportunity to own this classic {noun}.',
      'This handsome {noun} offers space, comfort, and great everyday flow.',
      'Discover all this {noun} has to offer.',
    ],
  };

  // ---- closing calls to action ---------------------------------------------
  const CLOSERS = {
    luxury: ['Schedule your private showing today.', 'Arrange a private tour and experience it for yourself.', 'Opportunities like this are rare — inquire today.'],
    warm: ['Come see it for yourself — schedule a tour today.', 'We’d love to show you around. Reach out anytime.', 'Don’t wait — book your showing today.'],
    modern: ['Book your tour and see it in person.', 'Ready when you are — schedule a showing today.', 'See it live — reach out to tour.'],
    investor: ['Run the numbers, then come take a look.', 'Serious inquiries welcome — reach out for the full breakdown.', 'Let’s talk — schedule a walkthrough today.'],
    classic: ['Call today to schedule your private showing.', 'Don’t miss this one — schedule a tour today.', 'Contact us today for a showing.'],
  };

  // ---- stat sentence builders ----------------------------------------------
  const statsClause = (d) => {
    const parts = [];
    if (d.beds) parts.push(`${d.beds} ${d.beds == 1 ? 'bedroom' : 'bedrooms'}`);
    if (d.baths) parts.push(`${d.baths} ${d.baths == 1 ? 'bath' : 'baths'}`);
    if (parts.length === 0 && !d.sqft) return '';
    let s = parts.length ? `Offering ${oxford(parts)}` : 'Offering';
    if (d.sqft) s += ` across ${num(d.sqft)} square feet of living space`;
    return s + '.';
  };

  const detailClause = (d) => {
    const bits = [];
    if (d.year) bits.push(`Built in ${d.year}`);
    if (d.lot) bits.push(`set on a ${d.lot} lot`);
    if (!bits.length) return '';
    return cap(oxford(bits)) + '.';
  };

  // ---- MLS / listing description -------------------------------------------
  const buildMLS = (d) => {
    const tone = d.tone || 'classic';
    const noun = typeNoun(d.type);
    const feats = polishFeatures(d.features);
    const sentences = [];

    sentences.push(pick(OPENERS[tone] || OPENERS.classic).replace('{noun}', noun));

    const stats = statsClause(d);
    if (stats) sentences.push(stats);

    if (feats.length) {
      const chosen = pickN(feats, Math.min(feats.length, 4));
      const lead = pick(['Highlights include', 'Inside you’ll find', 'Standout features include', 'Notable touches include']);
      sentences.push(`${lead} ${oxford(chosen)}.`);
    }

    const detail = detailClause(d);
    if (detail) sentences.push(detail);

    if (d.neighborhood) {
      const lead = pick(['Ideally located', 'Perfectly positioned', 'Set in a sought-after spot', 'Wonderfully situated']);
      sentences.push(`${lead}, you’re ${cleanLocation(d.neighborhood)}.`);
    }

    sentences.push(pick(CLOSERS[tone] || CLOSERS.classic));
    return sentences.join(' ');
  };

  // Normalize a location blurb into a "...you're <x>" tail without landmines.
  const cleanLocation = (text) => {
    let t = text.trim().replace(/\.$/, '');
    // soften distance phrasing the fair-housing checker dislikes
    t = t.replace(/within walking distance (of|to)?/gi, 'just minutes from');
    t = t.replace(/walking distance (of|to)?/gi, 'moments from');
    // if the agent wrote a list, present it as "close to X, Y, Z"
    if (/^(near|close to|minutes|moments|just|steps)/i.test(t)) return t.charAt(0).toLowerCase() + t.slice(1);
    return 'close to ' + t.charAt(0).toLowerCase() + t.slice(1);
  };

  // ---- Instagram caption ----------------------------------------------------
  const HOOK_EMOJI = ['✨', '🔑', '🏡', '📍', '🌟', '🛎️'];
  const buildInstagram = (d) => {
    const lines = [];
    const noun = typeNoun(d.type);
    lines.push(`${pick(HOOK_EMOJI)} JUST LISTED ${pick(HOOK_EMOJI)}`);
    const hook = pick([
      `Say hello to your next ${noun}.`,
      `This ${noun} checks all the boxes.`,
      `New on the market and ready to tour.`,
      `The ${noun} you’ve been waiting for just hit the market.`,
    ]);
    lines.push(hook);
    lines.push('');

    const stat = [];
    if (d.beds) stat.push(`🛏️ ${d.beds} bd`);
    if (d.baths) stat.push(`🛁 ${d.baths} ba`);
    if (d.sqft) stat.push(`📐 ${num(d.sqft)} sqft`);
    if (d.price) stat.push(`💰 ${money(d.price)}`);
    if (stat.length) lines.push(stat.join('  •  '));

    const feats = polishFeatures(d.features);
    if (feats.length) {
      pickN(feats, Math.min(feats.length, 3)).forEach((f) => lines.push(`✅ ${cap(f.replace(/^a |^an /,''))}`));
    }
    if (d.neighborhood) lines.push(`📍 ${cap(cleanLocation(d.neighborhood))}`);

    lines.push('');
    lines.push(pick(['DM me for a private tour 📩', 'Link in bio to book a showing.', 'Comment TOUR and I’ll send the details 👇', 'Ready to see it? Send me a message.']));
    if (d.agentName) lines.push(`— ${d.agentName}${d.brokerage ? ', ' + d.brokerage : ''}`);
    lines.push('');
    lines.push(hashtags(d));
    return lines.join('\n');
  };

  const hashtags = (d) => {
    const tags = ['#justlisted', '#realestate', '#forsale', '#newlisting', '#homeforsale', '#dreamhome', '#realtor'];
    const typeTag = { single: '#singlefamilyhome', condo: '#condoliving', townhouse: '#townhome', multi: '#investmentproperty', land: '#landforsale', luxury: '#luxuryrealestate' }[d.type];
    if (typeTag) tags.push(typeTag);
    if (priceTier(d.price) === 'luxury') tags.push('#luxuryhomes', '#luxurylisting');
    // a light location hashtag from the first word of the neighborhood/city
    if (d.city) tags.push('#' + d.city.toLowerCase().replace(/[^a-z0-9]/g, '') + 'realestate');
    return pickN(tags, Math.min(tags.length, 8)).join(' ');
  };

  // ---- Facebook post --------------------------------------------------------
  const buildFacebook = (d) => {
    const noun = typeNoun(d.type);
    const parts = [];
    parts.push(pick([
      `🏡 NEW LISTING — just hit the market!`,
      `Excited to share my newest listing! 🎉`,
      `Just listed and I can’t wait to show it off 👇`,
    ]));
    parts.push('');

    const sentence = [];
    const addr = d.address ? `${d.address} ` : '';
    sentence.push(`${addr ? addr + 'is a' : 'This'} ${noun}${statBlurb(d)}.`);
    const feats = polishFeatures(d.features);
    if (feats.length) sentence.push(`Inside, you’ll find ${oxford(pickN(feats, Math.min(feats.length, 3)))}.`);
    if (d.neighborhood) sentence.push(`It’s ${cleanLocation(d.neighborhood)}.`);
    parts.push(sentence.join(' '));

    if (d.price) { parts.push(''); parts.push(`Offered at ${money(d.price)}.`); }

    parts.push('');
    parts.push(pick(['Want a private tour? Send me a message or comment below 👇', 'Message me to schedule a showing — this one won’t last!', 'Tag someone who needs to see this, and DM me to tour.']));
    if (d.agentName) {
      const contact = [d.agentName, d.brokerage, d.phone].filter(Boolean).join(' • ');
      parts.push(`📞 ${contact}`);
    }
    return parts.join('\n');
  };

  const statBlurb = (d) => {
    const p = [];
    if (d.beds) p.push(`${d.beds} bed`);
    if (d.baths) p.push(`${d.baths} bath`);
    let s = p.length ? ' with ' + oxford(p) : '';
    if (d.sqft) s += `${p.length ? ',' : ' with'} ${num(d.sqft)} sq ft`;
    return s;
  };

  // ---- Email blast ----------------------------------------------------------
  const buildEmail = (d) => {
    const subjOpts = [
      `Just Listed${d.city ? ' in ' + d.city : ''}: ${[d.beds && d.beds + ' Bed', d.baths && d.baths + ' Bath'].filter(Boolean).join(', ')}`.replace(/:\s*$/, ''),
      `New Listing${d.price ? ' — ' + money(d.price) : ''}${d.address ? ' — ' + d.address : ''}`,
      `Be the first to see this one${d.city ? ' in ' + d.city : ''}`,
    ].filter((s) => s && s.trim());
    const subject = pick(subjOpts);

    const body = [];
    body.push(`Subject: ${subject}`);
    body.push('');
    body.push('Hi there,');
    body.push('');
    const noun = typeNoun(d.type);
    let intro = `I’m excited to share a new listing I think you’ll want to see${d.address ? ': ' + d.address : ''}.`;
    body.push(intro);
    body.push('');

    // reuse a warm version of the MLS body
    const feats = polishFeatures(d.features);
    let para = `This ${noun}${statBlurb(d)} offers `;
    para += feats.length ? oxford(pickN(feats, Math.min(feats.length, 3))) : 'comfortable, livable space throughout';
    para += '.';
    if (d.neighborhood) para += ` It’s ${cleanLocation(d.neighborhood)}.`;
    body.push(para);
    body.push('');

    // bullet highlights
    const bullets = [];
    if (d.price) bullets.push(`Price: ${money(d.price)}`);
    const bb = [d.beds && d.beds + ' bed', d.baths && d.baths + ' bath', d.sqft && num(d.sqft) + ' sq ft'].filter(Boolean);
    if (bb.length) bullets.push(bb.join(' / '));
    pickN(feats, Math.min(feats.length, 4)).forEach((f) => bullets.push(cap(f.replace(/^a |^an /, ''))));
    if (bullets.length) { bullets.forEach((b) => body.push(`• ${b}`)); body.push(''); }

    body.push(pick([
      'Want a private tour before it hits the open market? Just reply to this email or give me a call.',
      'I’d love to show you through. Reply here or call me and we’ll find a time.',
      'Reply to this email and I’ll get you in for a showing this week.',
    ]));
    body.push('');
    body.push('Best,');
    [d.agentName, d.brokerage, d.phone, d.email].filter(Boolean).forEach((l) => body.push(l));
    return body.join('\n');
  };

  // ---- Flyer copy -----------------------------------------------------------
  const buildFlyer = (d) => {
    const out = [];
    const headline = pick([
      d.price ? `JUST LISTED — ${money(d.price)}` : 'JUST LISTED',
      'NEW ON THE MARKET',
      'YOUR NEXT CHAPTER STARTS HERE',
    ]);
    out.push(`HEADLINE:  ${headline}`);
    if (d.address) out.push(`ADDRESS:   ${d.address}${d.city ? ', ' + d.city : ''}`);
    out.push('');
    out.push('AT A GLANCE:');
    const g = [];
    if (d.beds) g.push(`${d.beds} Bedrooms`);
    if (d.baths) g.push(`${d.baths} Bathrooms`);
    if (d.sqft) g.push(`${num(d.sqft)} Sq Ft`);
    if (d.lot) g.push(`${d.lot} Lot`);
    if (d.year) g.push(`Built ${d.year}`);
    g.forEach((x) => out.push(`   • ${x}`));
    out.push('');

    const feats = polishFeatures(d.features);
    if (feats.length) {
      out.push('FEATURES:');
      pickN(feats, Math.min(feats.length, 6)).forEach((f) => out.push(`   • ${cap(f.replace(/^a |^an /, ''))}`));
      out.push('');
    }
    if (d.neighborhood) { out.push(`LOCATION:  ${cap(cleanLocation(d.neighborhood))}`); out.push(''); }

    out.push(`CALL TO ACTION:  ${pick(CLOSERS[d.tone] || CLOSERS.classic)}`);
    const contact = [d.agentName, d.brokerage, d.phone, d.email].filter(Boolean);
    if (contact.length) { out.push(''); out.push('CONTACT:'); contact.forEach((c) => out.push(`   ${c}`)); }
    return out.join('\n');
  };

  // ---- public API -----------------------------------------------------------
  const generate = (data) => ({
    mls: buildMLS(data),
    instagram: buildInstagram(data),
    facebook: buildFacebook(data),
    email: buildEmail(data),
    flyer: buildFlyer(data),
  });

  return { generate, priceTier, money };
})();
