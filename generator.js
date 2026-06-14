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

  // area helpers — sq ft, m², or a custom label ("squares", "acres") passed through
  const areaLong = (u) => (u === 'sqm' ? 'square metres' : u === 'sqft' ? 'square feet' : u || 'square metres');
  const areaShort = (u) => (u === 'sqm' ? 'm²' : u === 'sqft' ? 'sq ft' : u || 'm²');

  // rent: "$650 per week" / "$650/wk"; sale: "$985,000". `mode` from the form.
  const RENT_LONG = { pw: 'per week', pm: 'per month' };
  const RENT_SHORT = { pw: '/wk', pm: '/mo' };
  const rentLong = (n, cur, period) => { const m = money(n, cur); return m ? `${m} ${RENT_LONG[period] || RENT_LONG.pw}` : ''; };
  const rentShort = (n, cur, period) => { const m = money(n, cur); return m ? `${m}${RENT_SHORT[period] || RENT_SHORT.pw}` : ''; };
  // headline price string for either mode (long form, used in prose)
  const priceLong = (d) => (d.mode === 'rent' ? rentLong(d.price, d.currency, d.rentPeriod) : money(d.price, d.currency));
  // compact price string (used on graphics / flyer tag)
  const priceShort = (d) => (d.mode === 'rent' ? rentShort(d.price, d.currency, d.rentPeriod) : money(d.price, d.currency));

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
  // custom property type ("beach shack", "penthouse") becomes the noun verbatim
  const typeNoun = (type, custom) =>
    (type === 'customtype' && custom ? custom.toLowerCase() : pick(TYPE_NOUN[type] || TYPE_NOUN.single));

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

  // rent-mode closers steer to inspections + applications, not a sale
  const RENT_CLOSERS = [
    'Register your interest today and we’ll be in touch with inspection times.',
    'Book an inspection and bring your application — quality rentals move fast.',
    'Keen to make it home? Register for the next inspection today.',
    'Inspect, apply, move in — register your interest to get started.',
  ];

  // pet policy → prose (never auto-write "no pets" — many jurisdictions now
  // restrict blanket bans, and it reads as exclusionary; leave it to the agent)
  const petPhrase = (pets) => ({
    yes: 'pet-friendly', considered: 'pets considered on application', negotiable: 'pets by negotiation',
  }[pets] || '');

  // Normalize a location blurb into a "...you're <x>" tail without landmines.
  const cleanLocation = (text) => {
    let t = String(text).trim().replace(/\.$/, '');
    t = t.replace(/within walking distance (of|to)?/gi, 'just minutes from');
    t = t.replace(/walking distance (of|to)?/gi, 'moments from');
    if (/^(near|close to|minutes|moments|just|steps|blocks)/i.test(t)) return t.charAt(0).toLowerCase() + t.slice(1);
    return 'close to ' + t.charAt(0).toLowerCase() + t.slice(1);
  };

  // ---- headline line (REIWA/portal convention: punchy first line) -----------
  const HEADLINES = {
    warm: ['Welcome Home to {sub}', 'The One You’ve Been Waiting For', 'Easy Living in the Heart of {sub}', 'Settle In and Stay Awhile'],
    luxury: ['A Statement Address in {sub}', 'Where Design Meets Lifestyle', 'Quietly Exceptional, {sub}', 'Crafted for the Way You Live'],
    modern: ['Smart Living, {sub} Style', 'Fresh, Functional and Ready', 'Designed for Right Now', 'Clean Lines, Easy Living in {sub}'],
    investor: ['An Opportunity That Stacks Up in {sub}', 'Solid Returns, Smart Address', 'Set, Forget and Watch {sub} Work', 'The Numbers Make Sense Here'],
    classic: ['Space, Comfort and Convenience in {sub}', 'Your Next Chapter Starts in {sub}', 'Position, Potential and Polish', 'All the Right Boxes in {sub}'],
  };
  // rent headlines focus on availability + lifestyle, not ownership
  const RENT_HEADLINES = ['Your Next Home Awaits in {sub}', 'Move-In Ready in {sub}', 'Lease This {sub} Lifestyle', 'Available Now in {sub}', 'The Rental You’ve Been Hunting For'];
  const headline = (tone, sub, mode) => {
    const bank = mode === 'rent' ? RENT_HEADLINES : (HEADLINES[tone] || HEADLINES.classic);
    const opts = bank.filter((h) => sub || !h.includes('{sub}'));
    return pick(opts.length ? opts : (mode === 'rent' ? ['The Rental You’ve Been Hunting For'] : HEADLINES.classic.slice(2, 3))).replace('{sub}', sub || '');
  };

  const LIFESTYLE = {
    warm: ['It’s the kind of address where the weekends look after themselves.', 'Everything that makes daily life easier is already within reach.'],
    luxury: ['It’s an address that does the quiet bragging for you.', 'The setting completes the picture — composed, connected, considered.'],
    modern: ['Everything you actually use is minutes away — no wasted commutes.', 'The location works as hard as the floor plan does.'],
    investor: ['Low-fuss ownership in a location that does the heavy lifting.', 'The address takes care of demand — the property takes care of itself.'],
    classic: ['A location that simply makes day-to-day life easier.', 'Convenience like this never goes out of style.'],
  };

  // ---- MLS / listing description (headline, full walk-through, bullets, CTA) ----
  const buildMLS = (d) => {
    const tone = d.tone || 'classic';
    const noun = typeNoun(d.type, d.typeCustom);
    const feats = polishFeatures(d.features);
    const byCat = { kitchen: [], interior: [], outdoor: [], practical: [] };
    feats.forEach((f) => (byCat[f.cat] || byCat.interior).push(f.text));

    const p1 = [];
    const p2 = [];
    const p3 = [];

    // opener (anchored to the suburb when we have one)
    p1.push(pick(OPENERS[tone] || OPENERS.classic).replace('{noun}', noun + (d.city ? ' in ' + d.city : '')));

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

    // rent: an availability/terms beat right up front (what renters scan for)
    if (d.mode === 'rent') {
      const r = [];
      if (d.furnished === 'furnished') r.push('offered fully furnished');
      else if (d.furnished === 'part') r.push('part-furnished');
      if (d.available) r.push(/now|immediate|avail/i.test(d.available) ? 'available now' : `available from ${d.available}`);
      if (d.leaseTerm) r.push(`on a ${d.leaseTerm} lease`);
      const pet = petPhrase(d.pets);
      if (pet) r.push(pet);
      if (r.length) p1.push(cap(oxford(r)) + '.');
    }

    // interior walk-through — use EVERYTHING the agent gave us, split over
    // two sentences when there's plenty (nothing they typed gets dropped)
    const interior = shuffle(byCat.interior).slice(0, 6);
    const intFirst = interior.slice(0, 3);
    const intRest = interior.slice(3);
    if (intFirst.length) {
      const lead = pick(['Inside,', 'Step through the door to', 'From the entry,', 'Throughout the home,']);
      if (lead === 'Inside,' || lead === 'Throughout the home,') {
        p1.push(`${lead} ${oxford(intFirst)} set the tone.`);
      } else {
        p1.push(`${lead} ${oxford(intFirst)}.`);
      }
    }
    if (intRest.length) {
      p1.push(pick([
        `Look closer and you’ll keep finding more — ${oxford(intRest)}.`,
        `Then come the extras: ${oxford(intRest)}.`,
        `${cap(oxford(intRest))} round out the picture.`,
      ]));
    }

    // kitchen gets its own beat — it sells houses. If one of the phrases IS
    // the kitchen ("a renovated chef's kitchen"), make it the subject so we
    // never write "the kitchen ... with a ... kitchen".
    const kitchenAll = pickN(byCat.kitchen, 4);
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
    const outdoor = pickN(byCat.outdoor, 4);
    if (outdoor.length) {
      p2.push(pick([
        `Outside, ${oxford(outdoor)} extend${outdoor.length === 1 ? 's' : ''} the living space.`,
        `Out back, ${oxford(outdoor)} ${outdoor.length === 1 ? 'is' : 'are'} ready for slow mornings and long evenings.`,
        `The outdoor story is just as good: ${oxford(outdoor)}.`,
      ]));
    }

    // practical wins
    const practical = pickN(byCat.practical, 4);
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

    // location + a tone-flavored lifestyle beat
    if (d.neighborhood) {
      const lead = pick(['Ideally located', 'Perfectly positioned', 'Wonderfully situated', 'And the address delivers']);
      p3.push(`${lead} — you’re ${cleanLocation(d.neighborhood)}.`);
      p3.push(pick(LIFESTYLE[tone] || LIFESTYLE.classic));
    }

    // features at a glance — every feature, plus the hard facts
    const bullets = [];
    feats.forEach((f) => bullets.push(cap(f.text.replace(/^a |^an /, ''))));
    if (num(d.sqft)) bullets.push(`${num(d.sqft)} ${areaShort(d.areaUnit)} of internal living`);
    if (d.lot) bullets.push(`${d.lot} ${d.region === 'au' ? 'block' : 'lot'}`);
    if (d.year) bullets.push(`Built in ${d.year}`);
    if (d.cars) bullets.push(`Parking for ${d.cars} car${d.cars == 1 ? '' : 's'}`);
    if (d.mode === 'rent') {
      if (priceLong(d)) bullets.unshift(`Rent: ${priceLong(d)}`);
      if (d.bond) bullets.push(`Bond: ${money(d.bond, d.currency) || d.bond}`);
      if (d.available) bullets.push(`Available: ${d.available}`);
      if (d.leaseTerm) bullets.push(`Lease: ${d.leaseTerm}`);
      if (d.furnished === 'furnished') bullets.push('Fully furnished');
      else if (d.furnished === 'part') bullets.push('Part-furnished');
      if (petPhrase(d.pets)) bullets.push(cap(petPhrase(d.pets)));
    }
    const bulletBlock = bullets.length >= 3
      ? 'At a glance:\n' + bullets.slice(0, 14).map((b) => `• ${b}`).join('\n')
      : '';

    // closing CTA — register/inspect/apply for rent; arrange a viewing for sale
    const cta = [];
    const inspectLabel = d.mode === 'rent' ? 'Inspection' : ohLabel(d);
    const inspectBadge = d.mode === 'rent' ? (d.badge === 'inspection') : (d.badge === 'openhouse');
    if (inspectBadge && d.openhouse) {
      cta.push(d.mode === 'rent'
        ? `Inspection ${d.openhouse} — register your interest to confirm a spot.`
        : pick([`${inspectLabel} ${d.openhouse} — come and walk it yourself.`, `See it in person: ${inspectLabel.toLowerCase()} ${d.openhouse}.`]));
      if (d.agentName) cta.push(`Questions? Contact ${d.agentName}${d.phone ? ' on ' + d.phone : ''}.`);
    } else if (d.mode === 'rent') {
      cta.push(pick(RENT_CLOSERS));
      if (d.agentName) cta.push(`Contact ${d.agentName}${d.phone ? ' on ' + d.phone : ''} to register your interest.`);
    } else if (d.agentName) {
      cta.push(pick([
        `To arrange a viewing, call ${d.agentName}${d.phone ? ' on ' + d.phone : ''} today.`,
        `Contact ${d.agentName}${d.phone ? ' on ' + d.phone : ''} for further details or a private viewing.`,
      ]));
    } else {
      cta.push(pick(CLOSERS[tone] || CLOSERS.classic));
    }

    return [
      headline(tone, d.city, d.mode),
      p1.join(' '),
      p2.join(' '),
      p3.join(' '),
      bulletBlock,
      cta.join(' '),
    ].filter(Boolean).join('\n\n');
  };

  // ---- Instagram caption ----------------------------------------------------
  const HOOK_EMOJI = ['✨', '🔑', '🏡', '📍', '🌟', '🛎️'];
  const BADGE_HOOK = {
    justlisted: 'JUST LISTED',
    openhouse: 'OPEN HOUSE',
    forsale: 'FOR SALE',
    newprice: 'NEW PRICE',
    sold: 'JUST SOLD',
    // rent statuses
    forlease: 'FOR LEASE',
    inspection: 'INSPECTION',
    leased: 'LEASED',
  };
  const badgeText = (d) => {
    if (d.badge === 'custom' && d.badgeCustom) return d.badgeCustom.toUpperCase();
    if (d.badge === 'openhouse' && d.region === 'au') return 'HOME OPEN';   // WA-speak
    return BADGE_HOOK[d.badge] || (d.mode === 'rent' ? 'FOR LEASE' : 'JUST LISTED');
  };
  const ohLabel = (d) => (d.region === 'au' ? 'Home open' : 'Open house');

  const buildInstagram = (d) => {
    const lines = [];
    const noun = typeNoun(d.type, d.typeCustom);
    lines.push(`${pick(HOOK_EMOJI)} ${badgeText(d)} ${pick(HOOK_EMOJI)}`);
    if (d.openhouse && (d.badge === 'openhouse' || d.badge === 'inspection')) lines.push(`🗓️ ${d.mode === 'rent' ? 'Inspection' : ohLabel(d)}: ${d.openhouse}`);
    lines.push(pick(d.mode === 'rent' ? [
      `Your next ${noun}, ready to lease.`,
      `This ${noun} is available now.`,
      `Move-in-ready and waiting for you.`,
      `The rental you’ve been hunting for.`,
    ] : [
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
    if (priceShort(d)) stat.push(`💰 ${priceShort(d)}`);
    if (stat.length) lines.push(stat.join('  •  '));

    const feats = polishFeatures(d.features);
    if (feats.length) {
      pickN(feats, Math.min(feats.length, 3)).forEach((f) => lines.push(`✅ ${cap(f.text.replace(/^a |^an /, ''))}`));
    }
    if (d.neighborhood) lines.push(`📍 ${cap(cleanLocation(d.neighborhood))}`);
    if ((d.photoCount || 0) > 1) { lines.push(''); lines.push('📸 Swipe through — then come see it in person.'); }

    lines.push('');
    lines.push(pick(d.mode === 'rent'
      ? ['DM me to book an inspection 📩', 'Comment INSPECT and I’ll send the times 👇', 'Register your interest — link in bio.', 'Keen? Send me a message to apply.']
      : ['DM me for a private tour 📩', 'Link in bio to book a showing.', 'Comment TOUR and I’ll send the details 👇', 'Ready to see it? Send me a message.']));
    if (d.agentName) lines.push(`— ${d.agentName}${d.brokerage ? ', ' + d.brokerage : ''}`);
    lines.push('');
    lines.push(hashtags(d));
    return lines.join('\n');
  };

  const hashtags = (d) => {
    const tags = d.mode === 'rent'
      ? ['#forlease', '#forrent', '#rental', '#rentals', '#propertyforrent', '#newlisting', '#realestate', '#renting']
      : ['#justlisted', '#realestate', '#forsale', '#newlisting', '#homeforsale', '#dreamhome', '#realtor', '#housetour', '#hometour'];
    const typeTag = { single: '#familyhome', apartment: '#apartmentliving', villa: '#villaliving', condo: '#condoliving', townhouse: '#townhome', multi: '#investmentproperty', land: '#landforsale', luxury: '#luxuryrealestate' }[d.type];
    if (typeTag) tags.push(typeTag);
    if (d.mode !== 'rent' && priceTier(d.price) === 'luxury') tags.push('#luxuryhomes', '#luxurylisting');
    if (d.city) tags.push('#' + d.city.toLowerCase().replace(/[^a-z0-9]/g, '') + (d.mode === 'rent' ? 'rentals' : 'realestate'));
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
    const noun = typeNoun(d.type, d.typeCustom);
    const rent = d.mode === 'rent';
    const parts = [];
    parts.push(pick(rent ? [
      `🏡 NEW RENTAL — now available for lease!`,
      `Just listed for lease 👇`,
      `New on the rental market and ready to inspect!`,
    ] : [
      `🏡 NEW LISTING — just hit the market!`,
      `Excited to share my newest listing! 🎉`,
      `Just listed and I can’t wait to show it off 👇`,
    ]));
    if (d.openhouse && (d.badge === 'openhouse' || d.badge === 'inspection')) parts.push(`🗓️ ${rent ? 'Inspection' : ohLabel(d)}: ${d.openhouse}`);
    parts.push('');

    const sentence = [];
    const addr = d.address ? `${d.address} ` : '';
    sentence.push(`${addr ? addr + 'is a' : 'This'} ${noun}${statBlurb(d)}.`);
    const feats = polishFeatures(d.features);
    if (feats.length) sentence.push(`Inside, you’ll find ${oxford(pickN(feats, Math.min(feats.length, 3)).map((f) => f.text))}.`);
    if (rent && (d.available || d.furnished === 'furnished')) sentence.push(`${d.furnished === 'furnished' ? 'Fully furnished and ' : ''}${d.available ? (/now|immediate|avail/i.test(d.available) ? 'available now' : 'available from ' + d.available) : 'ready to move into'}.`);
    if (d.neighborhood) sentence.push(`It’s ${cleanLocation(d.neighborhood)}.`);
    parts.push(sentence.join(' '));

    if (priceLong(d)) { parts.push(''); parts.push(rent ? `Available to lease at ${priceLong(d)}.` : `Offered at ${priceLong(d)}.`); }

    parts.push('');
    parts.push(pick(rent
      ? ['Want to inspect? Send me a message or comment below 👇', 'Message me to register for an inspection — quality rentals go fast!', 'Tag someone who’s house-hunting, and DM me to book a viewing.']
      : ['Want a private tour? Send me a message or comment below 👇', 'Message me to schedule a showing — this one won’t last!', 'Tag someone who needs to see this, and DM me to tour.']));
    if (d.agentName) {
      const contact = [d.agentName, d.brokerage, d.phone].filter(Boolean).join(' • ');
      parts.push(`📞 ${contact}`);
    }
    return parts.join('\n');
  };

  // ---- Email blast ----------------------------------------------------------
  const buildEmail = (d) => {
    const noun = typeNoun(d.type, d.typeCustom);
    const feats = polishFeatures(d.features);
    const where = d.city || 'the area';
    const bedBit = d.beds ? `${d.beds}-bed ` : '';

    const rent = d.mode === 'rent';
    const done = d.badge === 'sold' || d.badge === 'leased'; // the deal's done → pivot to prospecting
    const inspectWord = rent ? 'inspection' : ohLabel(d).toLowerCase();

    // badge-aware subject + an alternate, plus inbox preview text
    const SUBJECTS = {
      justlisted: [
        `Just listed in ${where}: ${bedBit}${noun}`,
        d.address ? `${d.address} just hit the market` : `New ${noun} on the market in ${where}`,
        `First look: a ${bedBit}${noun} in ${where}`,
      ],
      openhouse: [
        d.openhouse ? `${ohLabel(d)} ${d.openhouse} — ${d.address || 'come through'}` : `${ohLabel(d)} this week in ${where}`,
        `Walk through this ${bedBit}${noun} in ${where}`,
      ],
      newprice: [
        d.address ? `New price on ${d.address}` : `Price improved: ${bedBit}${noun} in ${where}`,
        `Worth a second look — new price in ${where}`,
      ],
      sold: [
        d.address ? `SOLD: ${d.address}` : `Just sold in ${where}`,
        `Another one sold in ${where} — thinking of selling?`,
      ],
      forsale: [`For sale in ${where}: ${bedBit}${noun}`, d.address ? `Have you seen ${d.address}?` : `A ${noun} worth your weekend in ${where}`],
      // rent
      forlease: [
        `For lease in ${where}: ${bedBit}${noun}${priceShort(d) ? ' — ' + priceShort(d) : ''}`,
        d.address ? `${d.address} is available to lease` : `Now leasing in ${where}`,
      ],
      inspection: [
        d.openhouse ? `Inspection ${d.openhouse} — ${d.address || where}` : `Inspect this ${bedBit}${noun} in ${where}`,
        `Open for inspection: ${bedBit}${noun} in ${where}`,
      ],
      leased: [
        d.address ? `LEASED: ${d.address}` : `Just leased in ${where}`,
        `Another one leased in ${where} — got a property to rent out?`,
      ],
    };
    const subs = (SUBJECTS[d.badge] || (rent ? SUBJECTS.forlease : SUBJECTS.justlisted)).filter(Boolean);
    const subject = subs[0];
    const altSubject = subs[1] || '';
    const preheader = [
      [d.beds && `${d.beds} bed`, d.baths && `${d.baths} bath`, d.cars && `${d.cars} car`].filter(Boolean).join(' · '),
      priceShort(d) || (done ? '' : (rent ? 'rent on application' : 'price on application')),
      rent && d.available ? `avail ${d.available}` : '',
      'photos inside',
    ].filter(Boolean).join(' — ');

    const body = [];
    body.push(`Subject: ${subject}`);
    if (altSubject) body.push(`(Alt subject: ${altSubject})`);
    body.push(`Preview text: ${preheader}`);
    body.push('');
    body.push('Hi there,');
    body.push('');

    // hook
    if (done) {
      body.push(rent
        ? `${d.address ? d.address + ' has' : 'One of my rentals has'} just leased${d.city ? ' in ' + d.city : ''} — and the enquiry it drew shows how tight ${where} is right now. If you’ve got a property sitting empty, I’d be glad to help you lease it quickly.`
        : `${d.address ? d.address + ' has' : 'One of my listings has'} just sold${d.city ? ' in ' + d.city : ''} — and the buyer interest along the way tells me ${where} is in demand. If you’ve been wondering what your own place might be worth, this is a good moment to ask.`);
    } else {
      body.push(rent
        ? pick([
          `A rental I think you’ll want to see just came up${d.address ? ': ' + d.address + (d.city ? ', ' + d.city : '') : ''}.`,
          `Quality rentals move fast — here’s a new one before it gets busy${d.address ? ': ' + d.address + (d.city ? ', ' + d.city : '') : ''}.`,
        ])
        : pick([
          `Before this one gets busy, I wanted you to see it first${d.address ? ': ' + d.address + (d.city ? ', ' + d.city : '') : ''}.`,
          `Some homes I send to everyone — this one I wanted my list to see first${d.address ? ': ' + d.address + (d.city ? ', ' + d.city : '') : ''}.`,
        ]));
      body.push('');
      let para = `It’s a ${noun}`;
      para += feats.length ? ` with ${oxford(pickN(feats, Math.min(feats.length, 3)).map((f) => f.text))}.` : ' worth a closer look.';
      if (d.neighborhood) para += ` And it’s ${cleanLocation(d.neighborhood)}.`;
      body.push(para);
    }
    body.push('');

    if (!done) {
      const bullets = [];
      if (rent) { if (priceLong(d)) bullets.push(`Rent: ${priceLong(d)}`); }
      else if (money(d.price)) bullets.push(`Price: ${money(d.price, d.currency)}`);
      const bb = [d.beds && d.beds + ' bed', d.baths && d.baths + ' bath', d.cars && d.cars + ' car', num(d.sqft) && num(d.sqft) + ' ' + areaShort(d.areaUnit)].filter(Boolean);
      if (bb.length) bullets.push(bb.join(' / '));
      if (rent) {
        if (d.available) bullets.push(`Available: ${d.available}`);
        if (d.leaseTerm) bullets.push(`Lease: ${d.leaseTerm}`);
        if (d.bond) bullets.push(`Bond: ${money(d.bond, d.currency) || d.bond}`);
        if (d.furnished === 'furnished') bullets.push('Fully furnished');
        else if (d.furnished === 'part') bullets.push('Part-furnished');
        if (petPhrase(d.pets)) bullets.push(cap(petPhrase(d.pets)));
      }
      if (d.openhouse && (d.badge === 'openhouse' || d.badge === 'inspection')) bullets.push(`${rent ? 'Inspection' : ohLabel(d)}: ${d.openhouse}`);
      pickN(feats, Math.min(feats.length, 5)).forEach((f) => bullets.push(cap(f.text.replace(/^a |^an /, ''))));
      if (bullets.length) { body.push('At a glance:'); bullets.forEach((b) => body.push(`• ${b}`)); body.push(''); }

      if (d.openhouse && (d.badge === 'openhouse' || d.badge === 'inspection')) {
        body.push(`Come through the ${inspectWord} (${d.openhouse}), or reply and I’ll ${rent ? 'add you to the inspection list' : 'arrange a private viewing that suits you'}.`);
      } else {
        body.push(rent
          ? pick(['Reply to register your interest and I’ll send through inspection times.', 'Keen? Reply or call and I’ll get you in for an inspection this week.', 'Reply to this email and I’ll send the application details.'])
          : pick(['Want to see it before the first home open? Reply to this email or give me a call.', 'I’d love to walk you through. Reply here or call me and we’ll find a time.', 'Reply to this email and I’ll get you through this week.']));
      }
      body.push('');
    } else {
      body.push(rent
        ? 'Reply or give me a call for a no-obligation chat about leasing your property.'
        : 'Reply to this email or give me a call for a no-obligation chat about your property.');
      body.push('');
    }

    body.push('Best,');
    [d.agentName, d.brokerage, d.phone, d.email].filter(Boolean).forEach((l) => body.push(l));

    // referral ask — the cheapest lead source there is
    if (!done) {
      body.push('');
      body.push(rent
        ? `P.S. Know someone hunting for a rental in ${where}? Forward this on — the good ones go through word of mouth.`
        : `P.S. Know someone house-hunting in ${where}? Forward this on — good homes tend to find their buyers through friends.`);
    }
    return body.join('\n');
  };

  // ---- flyer feature list (used by the visual flyer) -------------------------
  const flyerFeatures = (d, n = 6) =>
    pickN(polishFeatures(d.features), n).map((f) => cap(f.text.replace(/^a |^an /, '')));

  // ---- house style preferences ----------------------------------------------
  // Free-text directives -> mechanical transforms we can honestly deliver.
  const parsePrefs = (rawText) => {
    // phones autocorrect to curly quotes — normalise before matching
    const text = String(rawText || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    const t = text.toLowerCase();
    const p = {
      noEmojis: /\bno emojis?\b|\bdon'?t use emojis?\b|\bwithout emojis?\b|\bavoid emojis?\b/.test(t),
      noHashtags: /\bno hashtags?\b|\bdon'?t use hashtags?\b|\bavoid hashtags?\b/.test(t),
      noExclaim: /\bno exclamations?( marks?| points?)?\b|\bdon'?t use exclamations?\b/.test(t),
      short: /\bshort(er)?\b|\bbrief\b|\bconcise\b|\bkeep it short\b/.test(t),
      signoff: '',
      banned: [],
    };
    const so = text.match(/sign[- ]?off with[:\s]+["“']?([^\n.,"”']{2,30})/i);
    if (so) p.signoff = so[1].trim();
    const bre = /(?:don'?t say|never say|avoid saying|don'?t use the word|avoid the word)[:\s]+["“']?([a-z' -]{2,30}?)["”']?(?=[,.\n]|$)/gi;
    let m;
    while ((m = bre.exec(text))) {
      const w = m[1].trim().toLowerCase();
      if (w && !/emoji|hashtag|exclamation/.test(w)) p.banned.push(w);
    }
    return p;
  };

  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu;
  const stripEmojis = (s) => s
    .split('\n')
    .map((l) => l.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ').replace(/^[\s•·–-]*$/, '').trimStart())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const applyPrefs = (outputs, p) => {
    if (!p) return outputs;
    const out = { ...outputs };
    if (p.short) {
      if (out.mls) {
        const parts = out.mls.split('\n\n');
        if (parts.length > 3) out.mls = [parts[0], parts[1], parts[parts.length - 1]].join('\n\n');
      }
      if (out.email) out.email = out.email.split('\n').filter((l) => !l.startsWith('(Alt subject:') && !l.startsWith('P.S.')).join('\n').trimEnd();
    }
    if (p.noHashtags && out.instagram) {
      out.instagram = out.instagram.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trimEnd();
    }
    if (p.greeting && out.email) {
      const hi = cap(p.greeting.trim()).replace(/[,!.]*$/, ',');
      out.email = out.email.replace(/^Hi there,$/m, hi);
    }
    if (p.signoff && out.email) {
      const sig = cap(p.signoff.trim()).replace(/[,!.]*$/, ',');
      out.email = out.email.replace(/^Best,$/m, sig);
    }
    if (p.noExclaim) {
      Object.keys(out).forEach((k) => { out[k] = out[k].replace(/!+/g, '.').replace(/\.{2,}/g, '.'); });
    }
    if (p.noEmojis) {
      Object.keys(out).forEach((k) => { out[k] = stripEmojis(out[k]); });
    }
    return out;
  };

  // ---- public API -----------------------------------------------------------
  const generate = (data) => ({
    mls: buildMLS(data),
    instagram: buildInstagram(data),
    facebook: buildFacebook(data),
    email: buildEmail(data),
  });

  return { generate, priceTier, money, num, priceShort, priceLong, petPhrase, flyerFeatures, BADGE_HOOK, badgeText, parsePrefs, applyPrefs };
})();
