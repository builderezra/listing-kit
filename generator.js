/* Listing Kit — marketing copy generator (v2).
 *
 * Runs entirely in the browser. Given a listing, assembles property-aware,
 * tone-driven copy for MLS, Instagram, Facebook, and email. Features are
 * categorized (kitchen / interior / outdoor / practical) so the description
 * reads like prose that walks you through the home, not a comma-spliced list.
 * The vocabulary avoids fair-housing landmines by construction; fairhousing.js
 * audits everything (including the agent's own input) as a backstop.
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
    return isFinite(v) && v > 0 ? v.toLocaleString('en-US') : '';
  };
  const money = (n, cur = '$') => {
    if (n == null || n === '') return '';
    const v = Number(String(n).replace(/[^0-9.]/g, ''));
    if (!isFinite(v) || v === 0) return '';
    const s = v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return cur === 'kr' ? s + ' kr' : cur + s;   // kr is a suffix currency
  };

  // area helpers — the app supports sq ft and m² listings
  const areaLong = (u) => (u === 'sqm' ? 'square metres' : 'square feet');
  const areaShort = (u) => (u === 'sqm' ? 'm²' : 'sq ft');

  const priceTier = (price) => {
    const v = Number(String(price || '').replace(/[^0-9.]/g, ''));
    if (!v) return 'mid';
    if (v >= 1500000) return 'luxury';
    if (v >= 750000) return 'upper';
    if (v <= 300000) return 'value';
    return 'mid';
  };

  const TYPE_NOUN = {
    single: ['home', 'residence', 'family home'],
    apartment: ['apartment', 'residence', 'home'],
    villa: ['villa', 'home', 'residence'],
    condo: ['condo', 'residence', 'condominium'],
    townhouse: ['townhome', 'residence', 'townhouse'],
    multi: ['property', 'multi-family property', 'investment property'],
    land: ['lot', 'parcel', 'property'],
    luxury: ['estate', 'residence', 'home'],
  };
  const typeNoun = (type) => pick(TYPE_NOUN[type] || TYPE_NOUN.single);

  // ---- feature dictionary: raw input -> polished phrasing + category ---------
  // cat: kitchen | interior | outdoor | practical — drives sentence grouping.
  const FEATURE_LIB = [
    { k: ['updated kitchen', 'renovated kitchen', 'new kitchen', 'chef'], cat: 'kitchen', p: ['a renovated chef’s kitchen', 'a beautifully updated kitchen', 'a sleek, modern kitchen'] },
    { k: ['kitchen'], cat: 'kitchen', p: ['a bright, functional kitchen', 'a well-appointed kitchen'] },
    { k: ['stainless'], cat: 'kitchen', p: ['stainless steel appliances'] },
    { k: ['stone bench', 'benchtop'], cat: 'kitchen', p: ['stone benchtops'] },
    { k: ['quartz', 'granite', 'countertop'], cat: 'kitchen', p: ['stone countertops', 'upgraded countertops'] },
    { k: ['scullery'], cat: 'kitchen', p: ['a separate scullery'] },
    { k: ['island'], cat: 'kitchen', p: ['a generous center island'] },
    { k: ['pantry'], cat: 'kitchen', p: ['a walk-in pantry'] },
    { k: ['hardwood', 'wood floor'], cat: 'interior', p: ['gleaming hardwood floors', 'rich hardwood flooring'] },
    { k: ['tile floor', 'tile'], cat: 'interior', p: ['designer tile work'] },
    { k: ['open floor', 'open concept', 'open-concept', 'open plan'], cat: 'interior', p: ['an open-concept layout', 'a flowing open floor plan'] },
    { k: ['natural light', 'bright', 'sunlit', 'sunny'], cat: 'interior', p: ['abundant natural light', 'sun-filled living spaces'] },
    { k: ['high ceiling', 'vaulted', 'cathedral'], cat: 'interior', p: ['soaring ceilings', 'dramatic vaulted ceilings'] },
    { k: ['fireplace'], cat: 'interior', p: ['a cozy fireplace', 'a statement fireplace'] },
    { k: ['primary suite', 'master suite', 'owner’s suite', 'owners suite', 'primary bedroom', 'master bedroom'], cat: 'interior', p: ['a spacious primary suite', 'a serene primary retreat'] },
    { k: ['robe'], cat: 'interior', p: ['generous built-in robes'] },
    { k: ['walk-in closet', 'walk in closet'], cat: 'interior', p: ['generous walk-in closets'] },
    { k: ['theatre', 'theater room'], cat: 'interior', p: ['a dedicated home theatre'] },
    { k: ['powder room'], cat: 'interior', p: ['a convenient powder room'] },
    { k: ['spa', 'soaking tub', 'en-suite', 'ensuite'], cat: 'interior', p: ['a spa-inspired bath', 'a luxurious en-suite bath'] },
    { k: ['basement', 'lower level'], cat: 'interior', p: ['a finished lower level', 'a versatile finished basement'] },
    { k: ['bonus room', 'flex room', 'office', 'den', 'study'], cat: 'interior', p: ['a flexible bonus room', 'a dedicated home office'] },
    { k: ['storage'], cat: 'interior', p: ['ample storage throughout'] },
    { k: ['laundry', 'mudroom'], cat: 'interior', p: ['a convenient laundry/mud room'] },
    { k: ['pool'], cat: 'outdoor', p: ['a sparkling pool', 'a resort-style pool'] },
    { k: ['hot tub', 'jacuzzi', 'spa tub'], cat: 'outdoor', p: ['a relaxing hot tub'] },
    { k: ['backyard', 'back yard', 'fenced yard', 'yard'], cat: 'outdoor', p: ['a private, fenced backyard', 'a generous backyard'] },
    { k: ['deck', 'patio', 'pergola'], cat: 'outdoor', p: ['an entertainer’s deck', 'an inviting outdoor patio'] },
    { k: ['balcony', 'terrace'], cat: 'outdoor', p: ['a private balcony', 'a sun-soaked terrace'] },
    { k: ['view', 'overlook'], cat: 'outdoor', p: ['captivating views', 'stunning views'] },
    { k: ['alfresco'], cat: 'outdoor', p: ['an alfresco entertaining area', 'a covered alfresco for year-round entertaining'] },
    { k: ['bbq', 'barbecue', 'outdoor kitchen'], cat: 'outdoor', p: ['a built-in outdoor barbecue area'] },
    { k: ['reticulat'], cat: 'outdoor', p: ['reticulated, easy-care gardens'] },
    { k: ['garden', 'landscap'], cat: 'outdoor', p: ['mature, easy-care landscaping'] },
    { k: ['corner lot', 'cul-de-sac', 'cul de sac', 'large lot', 'acre', 'private lot'], cat: 'outdoor', p: ['a desirable lot', 'a premium lot position'] },
    { k: ['garage'], cat: 'practical', p: ['a spacious garage', 'attached garage parking'] },
    { k: ['smart home', 'smart-home', 'nest', 'smart thermostat'], cat: 'practical', p: ['smart-home technology'] },
    { k: ['reverse cycle', 'reverse-cycle', 'ducted', 'aircon', 'air con'], cat: 'practical', p: ['ducted reverse-cycle air conditioning'] },
    { k: ['granny flat', 'ancillary dwelling'], cat: 'practical', p: ['a self-contained granny flat'] },
    { k: ['solar'], cat: 'practical', p: ['energy-saving solar panels'] },
    { k: ['new roof', 'new hvac', 'new windows', 'new furnace', 'new water heater', 'updated systems', 'new ac'], cat: 'practical', p: ['major recent system upgrades', 'big-ticket updates already done'] },
    { k: ['remodel', 'renovat', 'updated', 'upgraded', 'move-in', 'move in', 'turnkey', 'turn-key'], cat: 'practical', p: ['a tasteful, move-in-ready renovation', 'thoughtful updates throughout'] },
  ];

  // Convert freeform features into [{text, cat}] (deduped, order preserved).
  const polishFeatures = (features) => {
    const out = [];
    const used = new Set();
    (features || []).forEach((raw) => {
      const f = String(raw).trim().toLowerCase();
      if (!f) return;
      let matched = false;
      for (const entry of FEATURE_LIB) {
        if (entry.k.some((kw) => f.includes(kw))) {
          const key = entry.p[0];
          if (!used.has(key)) { out.push({ text: pick(entry.p), cat: entry.cat }); used.add(key); }
          matched = true;
          break;
        }
      }
      if (!matched) {
        const clean = String(raw).trim().replace(/\.$/, '');
        const key = clean.toLowerCase();
        if (!used.has(key)) {
          out.push({ text: clean.charAt(0) >= 'A' && clean.charAt(0) <= 'Z' ? clean.toLowerCase() : clean, cat: 'interior' });
          used.add(key);
        }
      }
    });
    return out;
  };

  // ---- tone voices -----------------------------------------------------------
  const OPENERS = {
    luxury: [
      'An extraordinary {noun} where timeless design meets everyday comfort.',
      'Refined living defines this exceptional {noun}.',
      'Welcome to a {noun} of rare distinction and craftsmanship.',
      'Some homes simply carry themselves differently — this {noun} is one of them.',
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

  const STAT_TAILS = {
    luxury: ['composed with exceptional attention to scale and light', 'where every room earns its place', 'with proportions that photographs only hint at'],
    warm: ['with room for every rhythm of daily life', 'and every inch of it feels like home', 'with space to spread out and settle in'],
    modern: ['planned for flexibility and everyday flow', 'with a footprint that adapts to how you actually live', 'and not a wasted square foot among them'],
    investor: ['with a layout that shows well and holds value', 'and the kind of floor plan that stays in demand', 'with broad appeal to today’s buyers'],
    classic: ['with comfortable, practical flow throughout', 'thoughtfully arranged for everyday living', 'with a classic layout that simply works'],
  };

  const CLOSERS = {
    luxury: ['Schedule your private showing today.', 'Arrange a private tour and experience it for yourself.', 'Opportunities like this are rare — inquire today.'],
    warm: ['Come see it for yourself — schedule a tour today.', 'We’d love to show you around. Reach out anytime.', 'Come stand in the kitchen and you’ll get it — schedule a showing today.'],
    modern: ['Book your tour and see it in person.', 'Ready when you are — schedule a showing today.', 'See it live — reach out to tour.'],
    investor: ['Run the numbers, then come take a look.', 'Serious inquiries welcome — reach out for the full breakdown.', 'Let’s talk — schedule a walkthrough today.'],
    classic: ['Call today to schedule your private showing.', 'Don’t miss this one — schedule a tour today.', 'Contact us today for a showing.'],
  };

  // Normalize a location blurb into a "...you're <x>" tail without landmines.
  const cleanLocation = (text) => {
    let t = String(text).trim().replace(/\.$/, '');
    t = t.replace(/within walking distance (of|to)?/gi, 'just minutes from');
    t = t.replace(/walking distance (of|to)?/gi, 'moments from');
    if (/^(near|close to|minutes|moments|just|steps|blocks)/i.test(t)) return t.charAt(0).toLowerCase() + t.slice(1);
    return 'close to ' + t.charAt(0).toLowerCase() + t.slice(1);
  };

  // ---- MLS / listing description (two paragraphs, walks through the home) ----
  const buildMLS = (d) => {
    const tone = d.tone || 'classic';
    const noun = typeNoun(d.type);
    const feats = polishFeatures(d.features);
    const byCat = { kitchen: [], interior: [], outdoor: [], practical: [] };
    feats.forEach((f) => (byCat[f.cat] || byCat.interior).push(f.text));

    const p1 = [];
    const p2 = [];

    // opener
    p1.push(pick(OPENERS[tone] || OPENERS.classic).replace('{noun}', noun));

    // stats with a tone-flavored tail
    const statBits = [];
    if (d.beds) statBits.push(`${d.beds} ${d.beds == 1 ? 'bedroom' : 'bedrooms'}`);
    if (d.baths) statBits.push(`${d.baths} ${d.baths == 1 ? 'bath' : 'baths'}`);
    const sq = num(d.sqft);
    if (statBits.length || sq) {
      let s = statBits.length ? cap(oxford(statBits)) : 'The floor plan';
      s += sq ? ` span${statBits.length === 1 ? 's' : ''} ${sq} ${areaLong(d.areaUnit)}` : ' fill the home';
      s += `, ${pick(STAT_TAILS[tone] || STAT_TAILS.classic)}.`;
      p1.push(s);
    }

    // interior walk-through
    const interior = pickN(byCat.interior, 3);
    if (interior.length) {
      const lead = pick(['Inside,', 'Step through the door to', 'From the entry,', 'Throughout the main level,']);
      if (lead === 'Inside,' || lead === 'Throughout the main level,') {
        p1.push(`${lead} ${oxford(interior)} set the tone.`);
      } else {
        p1.push(`${lead} ${oxford(interior)}.`);
      }
    }

    // kitchen gets its own beat — it sells houses. If one of the phrases IS
    // the kitchen ("a renovated chef's kitchen"), make it the subject so we
    // never write "the kitchen ... with a ... kitchen".
    const kitchenAll = pickN(byCat.kitchen, 3);
    const kNoun = kitchenAll.find((k) => k.includes('kitchen'));
    const kDetails = kitchenAll.filter((k) => k !== kNoun);
    if (kNoun) {
      p1.push(pick([
        `${cap(kNoun)} anchors the heart of the home${kDetails.length ? `, complete with ${oxford(kDetails)}` : ''}.`,
        `At the center of it all: ${kNoun}${kDetails.length ? `, finished with ${oxford(kDetails)}` : ''}.`,
        `Cooks will gravitate to ${kNoun}${kDetails.length ? ` outfitted with ${oxford(kDetails)}` : ''}.`,
      ]));
    } else if (kDetails.length) {
      p1.push(pick([
        `The kitchen delivers with ${oxford(kDetails)}.`,
        `In the kitchen, ${oxford(kDetails)} make everyday cooking easy.`,
      ]));
    }

    // outdoor
    const outdoor = pickN(byCat.outdoor, 3);
    if (outdoor.length) {
      p2.push(pick([
        `Outside, ${oxford(outdoor)} extend${outdoor.length === 1 ? 's' : ''} the living space.`,
        `Out back, ${oxford(outdoor)} ${outdoor.length === 1 ? 'is' : 'are'} ready for slow mornings and long evenings.`,
        `The outdoor story is just as good: ${oxford(outdoor)}.`,
      ]));
    }

    // practical wins
    const practical = pickN(byCat.practical, 3);
    if (practical.length) {
      p2.push(pick([
        `Practical wins, too: ${oxford(practical)}.`,
        `Behind the scenes, ${oxford(practical)} mean${practical.length === 1 ? 's' : ''} less to worry about.`,
        `Add in ${oxford(practical)}, and the boxes start checking themselves.`,
      ]));
    }

    // provenance
    const prov = [];
    if (d.year) prov.push(`built in ${d.year}`);
    if (d.lot) prov.push(`set on a ${d.lot} ${d.region === 'au' ? 'block' : 'lot'}`);
    if (prov.length) p2.push(`${cap(oxford(prov))}, it’s been cared for where it counts.`);

    // location
    if (d.neighborhood) {
      const lead = pick(['Ideally located', 'Perfectly positioned', 'Wonderfully situated', 'And the address delivers']);
      p2.push(`${lead} — you’re ${cleanLocation(d.neighborhood)}.`);
    }

    if (d.badge === 'openhouse' && d.openhouse) {
      p2.push(pick([
        `${ohLabel(d)} ${d.openhouse} — come and walk it yourself.`,
        `See it in person: ${ohLabel(d).toLowerCase()} ${d.openhouse}.`,
      ]));
    } else {
      p2.push(pick(CLOSERS[tone] || CLOSERS.classic));
    }

    return p1.join(' ') + '\n\n' + p2.join(' ');
  };

  // ---- Instagram caption ----------------------------------------------------
  const HOOK_EMOJI = ['✨', '🔑', '🏡', '📍', '🌟', '🛎️'];
  const BADGE_HOOK = {
    justlisted: 'JUST LISTED',
    openhouse: 'OPEN HOUSE',
    forsale: 'FOR SALE',
    newprice: 'NEW PRICE',
    sold: 'JUST SOLD',
  };
  const badgeText = (d) => {
    if (d.badge === 'custom' && d.badgeCustom) return d.badgeCustom.toUpperCase();
    if (d.badge === 'openhouse' && d.region === 'au') return 'HOME OPEN';   // WA-speak
    return BADGE_HOOK[d.badge] || 'JUST LISTED';
  };
  const ohLabel = (d) => (d.region === 'au' ? 'Home open' : 'Open house');

  const buildInstagram = (d) => {
    const lines = [];
    const noun = typeNoun(d.type);
    lines.push(`${pick(HOOK_EMOJI)} ${badgeText(d)} ${pick(HOOK_EMOJI)}`);
    if (d.badge === 'openhouse' && d.openhouse) lines.push(`🗓️ ${d.openhouse}`);
    lines.push(pick([
      `Say hello to your next ${noun}.`,
      `This ${noun} checks all the boxes.`,
      `New on the market and ready to tour.`,
      `The ${noun} you’ve been waiting for just hit the market.`,
    ]));
    lines.push('');

    const stat = [];
    if (d.beds) stat.push(`🛏️ ${d.beds} bd`);
    if (d.baths) stat.push(`🛁 ${d.baths} ba`);
    if (d.cars) stat.push(`🚗 ${d.cars} car`);
    if (num(d.sqft)) stat.push(`📐 ${num(d.sqft)} ${d.areaUnit === 'sqm' ? 'm²' : 'sqft'}`);
    if (money(d.price)) stat.push(`💰 ${money(d.price, d.currency)}`);
    if (stat.length) lines.push(stat.join('  •  '));

    const feats = polishFeatures(d.features);
    if (feats.length) {
      pickN(feats, Math.min(feats.length, 3)).forEach((f) => lines.push(`✅ ${cap(f.text.replace(/^a |^an /, ''))}`));
    }
    if (d.neighborhood) lines.push(`📍 ${cap(cleanLocation(d.neighborhood))}`);
    if ((d.photoCount || 0) > 1) { lines.push(''); lines.push('📸 Swipe through — then come see it in person.'); }

    lines.push('');
    lines.push(pick(['DM me for a private tour 📩', 'Link in bio to book a showing.', 'Comment TOUR and I’ll send the details 👇', 'Ready to see it? Send me a message.']));
    if (d.agentName) lines.push(`— ${d.agentName}${d.brokerage ? ', ' + d.brokerage : ''}`);
    lines.push('');
    lines.push(hashtags(d));
    return lines.join('\n');
  };

  const hashtags = (d) => {
    const tags = ['#justlisted', '#realestate', '#forsale', '#newlisting', '#homeforsale', '#dreamhome', '#realtor', '#housetour', '#hometour'];
    const typeTag = { single: '#familyhome', apartment: '#apartmentliving', villa: '#villaliving', condo: '#condoliving', townhouse: '#townhome', multi: '#investmentproperty', land: '#landforsale', luxury: '#luxuryrealestate' }[d.type];
    if (typeTag) tags.push(typeTag);
    if (priceTier(d.price) === 'luxury') tags.push('#luxuryhomes', '#luxurylisting');
    if (d.badge === 'openhouse') tags.push('#openhouse');
    if (d.city) tags.push('#' + d.city.toLowerCase().replace(/[^a-z0-9]/g, '') + 'realestate');
    return pickN(tags, Math.min(tags.length, 9)).join(' ');
  };

  // ---- Facebook post --------------------------------------------------------
  const statBlurb = (d) => {
    const p = [];
    if (d.beds) p.push(`${d.beds} bed`);
    if (d.baths) p.push(`${d.baths} bath`);
    let s = p.length ? ' with ' + oxford(p) : '';
    if (num(d.sqft)) s += `${p.length ? ',' : ' with'} ${num(d.sqft)} ${areaShort(d.areaUnit)}`;
    return s;
  };

  const buildFacebook = (d) => {
    const noun = typeNoun(d.type);
    const parts = [];
    parts.push(pick([
      `🏡 NEW LISTING — just hit the market!`,
      `Excited to share my newest listing! 🎉`,
      `Just listed and I can’t wait to show it off 👇`,
    ]));
    if (d.badge === 'openhouse' && d.openhouse) parts.push(`🗓️ ${ohLabel(d)}: ${d.openhouse}`);
    parts.push('');

    const sentence = [];
    const addr = d.address ? `${d.address} ` : '';
    sentence.push(`${addr ? addr + 'is a' : 'This'} ${noun}${statBlurb(d)}.`);
    const feats = polishFeatures(d.features);
    if (feats.length) sentence.push(`Inside, you’ll find ${oxford(pickN(feats, Math.min(feats.length, 3)).map((f) => f.text))}.`);
    if (d.neighborhood) sentence.push(`It’s ${cleanLocation(d.neighborhood)}.`);
    parts.push(sentence.join(' '));

    if (money(d.price)) { parts.push(''); parts.push(`Offered at ${money(d.price, d.currency)}.`); }

    parts.push('');
    parts.push(pick(['Want a private tour? Send me a message or comment below 👇', 'Message me to schedule a showing — this one won’t last!', 'Tag someone who needs to see this, and DM me to tour.']));
    if (d.agentName) {
      const contact = [d.agentName, d.brokerage, d.phone].filter(Boolean).join(' • ');
      parts.push(`📞 ${contact}`);
    }
    return parts.join('\n');
  };

  // ---- Email blast ----------------------------------------------------------
  const buildEmail = (d) => {
    const subjOpts = [
      `Just Listed${d.city ? ' in ' + d.city : ''}: ${[d.beds && d.beds + ' Bed', d.baths && d.baths + ' Bath'].filter(Boolean).join(', ')}`.replace(/:\s*$/, ''),
      `New Listing${money(d.price) ? ' — ' + money(d.price, d.currency) : ''}${d.address ? ' — ' + d.address : ''}`,
      `Be the first to see this one${d.city ? ' in ' + d.city : ''}`,
    ].filter((s) => s && s.trim());
    const subject = pick(subjOpts);

    const body = [];
    body.push(`Subject: ${subject}`);
    body.push('');
    body.push('Hi there,');
    body.push('');
    const noun = typeNoun(d.type);
    body.push(`I’m excited to share a new listing I think you’ll want to see${d.address ? ': ' + d.address : ''}.`);
    body.push('');

    const feats = polishFeatures(d.features);
    let para = `This ${noun}${statBlurb(d)} offers `;
    para += feats.length ? oxford(pickN(feats, Math.min(feats.length, 3)).map((f) => f.text)) : 'comfortable, livable space throughout';
    para += '.';
    if (d.neighborhood) para += ` It’s ${cleanLocation(d.neighborhood)}.`;
    body.push(para);
    body.push('');

    const bullets = [];
    if (money(d.price)) bullets.push(`Price: ${money(d.price, d.currency)}`);
    const bb = [d.beds && d.beds + ' bed', d.baths && d.baths + ' bath', num(d.sqft) && num(d.sqft) + ' ' + areaShort(d.areaUnit)].filter(Boolean);
    if (bb.length) bullets.push(bb.join(' / '));
    if (d.badge === 'openhouse' && d.openhouse) bullets.push(`${ohLabel(d)}: ${d.openhouse}`);
    pickN(feats, Math.min(feats.length, 4)).forEach((f) => bullets.push(cap(f.text.replace(/^a |^an /, ''))));
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

  // ---- flyer feature list (used by the visual flyer) -------------------------
  const flyerFeatures = (d, n = 6) =>
    pickN(polishFeatures(d.features), n).map((f) => cap(f.text.replace(/^a |^an /, '')));

  // ---- public API -----------------------------------------------------------
  const generate = (data) => ({
    mls: buildMLS(data),
    instagram: buildInstagram(data),
    facebook: buildFacebook(data),
    email: buildEmail(data),
  });

  return { generate, priceTier, money, num, flyerFeatures, BADGE_HOOK, badgeText };
})();
