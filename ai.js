/* Listing Kit — optional AI polish (bring-your-own-key, client-side).
 *
 * Calls the Anthropic Messages API directly from the browser to rewrite the
 * generated marketing copy at genuine human quality, and to apply free-form
 * instructions ("make it more upmarket", "shorten it", "aim at first-home
 * buyers"). The key is the agent's own, stored only in this browser's
 * localStorage, sent straight to api.anthropic.com — never to any server of
 * ours, never written into a file or the design export. Each agent pays their
 * own usage (cents per listing).
 *
 * Direct browser calls require the `anthropic-dangerous-direct-browser-access`
 * header. That name is a deliberate warning: a key in client-side code is only
 * safe when it's the user's OWN key on their OWN machine — which is exactly the
 * model here. We never embed a key in the deployed site.
 */
const AI = (() => {
  'use strict';
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const KEY_LS = 'lk_ai_key';
  const MODEL_LS = 'lk_ai_model';

  const MODELS = [
    { id: 'claude-opus-4-8', label: 'Opus 4.8 — best quality' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — balanced, cheaper' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — cheapest & fastest' },
  ];
  const DEFAULT_MODEL = 'claude-opus-4-8';

  const getKey = () => { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KEY_LS, k.trim()) : localStorage.removeItem(KEY_LS); } catch (e) {} };
  const getModel = () => { try { return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } };
  const setModel = (m) => { try { localStorage.setItem(MODEL_LS, m); } catch (e) {} };
  const available = () => !!getKey();
  const modelLabel = () => (MODELS.find((m) => m.id === getModel()) || MODELS[0]).label.split(' —')[0];

  // ---- low-level call --------------------------------------------------------
  // lastTextOnly: with web search the model emits a "let me look…" text block
  // before the tool runs; the real answer is the FINAL text block.
  const call = async (system, user, maxTokens = 1500, tools = null, lastTextOnly = false) => {
    const key = getKey();
    if (!key) { const e = new Error('no-key'); e.status = 0; throw e; }
    const body = { model: getModel(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
    if (tools) body.tools = tools;
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      const err = new Error('network'); err.status = -1; throw err;
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || ''; } catch (e) {}
      const err = new Error(msg || ('HTTP ' + res.status)); err.status = res.status; throw err;
    }
    const data = await res.json();
    const texts = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean);
    // final answer is the text blocks (web-search tool results are server-side)
    return (lastTextOnly ? (texts[texts.length - 1] || '') : texts.join('')).trim();
  };

  // ---- system prompt: an expert copywriter that can't invent or discriminate -
  const SYSTEM = [
    'You are an expert real estate copywriter. You rewrite listing marketing copy so it reads the way a top-performing agent would publish it: vivid, specific, well-paced, with a genuine hook — never generic or templated.',
    '',
    'Hard rules, always:',
    '1. Use ONLY the facts in PROPERTY FACTS. Never invent or imply features, room counts, materials, schools, distances, prices, or claims that are not given. If something is not provided, leave it out.',
    '2. Avoid any language that could breach fair-housing / anti-discrimination rules: do not reference or imply a preference based on race, religion, nationality, sex, family or children status, age, or disability. Never use "safe", "family-friendly", "perfect for [a group]", "walking distance", or claims about school quality or crime.',
    '3. Follow the HOUSE STYLE exactly (tone, region/English variant, emoji and punctuation rules, sign-offs, banned words).',
    '4. Keep the same channel and format as the draft (e.g. an email keeps its Subject and Preview lines; an Instagram caption keeps short lines). Keep a similar length unless told otherwise.',
    '5. Output ONLY the finished copy — no preamble, no explanation, no surrounding quotes.',
  ].join('\n');

  const wrap = ({ channelLabel, facts, style, currentText }, task) =>
    `${task}\n\nCHANNEL: ${channelLabel}\n\nPROPERTY FACTS (the only facts you may use):\n${facts}\n\nHOUSE STYLE:\n${style}\n\nCURRENT DRAFT:\n${currentText}\n\nReturn only the rewritten ${channelLabel}.`;

  const polish = (opts) =>
    call(SYSTEM, wrap(opts, `Rewrite the ${opts.channelLabel} below so it reads like polished, human-written copy — stronger hook, better rhythm, concrete and specific, never generic. Same channel, similar length.`), 1500);

  const instruct = (opts) =>
    call(SYSTEM, wrap(opts, `Revise the ${opts.channelLabel} below according to this instruction: "${opts.instruction}". Apply it faithfully, but keep every hard rule (facts only, no discriminatory language, house style).`), 1500);

  // ---- location research (uses live web search) ------------------------------
  const RESEARCH_SYSTEM = [
    'You research the real, local lifestyle amenities near a property for a real estate "location highlights" line. Use web search — never invent or guess a place name.',
    'Include only genuine, verifiable nearby features a buyer cares about: beaches/coast/foreshore, parks and reserves, café/restaurant/shopping precincts (by name), and public transport (train/bus/ferry stations by name). Give a rough sense of proximity ("moments from", "a short walk to", "minutes from") only if the search supports it.',
    'NEVER mention schools or school catchments, crime, safety, or the demographic makeup of an area — these create anti-discrimination / fair-housing risk.',
    'You may think and search freely. But your FINAL output must wrap the single finished phrase between [HL] and [/HL] markers and contain nothing else inside them — e.g. [HL]moments from Scarborough Beach, the cafés along the foreshore, and Stirling train station[/HL]. Any commentary like "I have gathered the information" must stay OUTSIDE the markers.',
  ].join('\n');

  const REGION_NAME = { au: 'Australia', us: 'United States', uk: 'United Kingdom', other: '' };
  const research = ({ address, suburb, region }) => {
    const where = [address, suburb, REGION_NAME[region]].filter(Boolean).join(', ');
    return call(
      RESEARCH_SYSTEM,
      `Research the immediate area around this property and return the location-highlights phrase wrapped in [HL]…[/HL]:\n${where}`,
      1200,
      [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      true,
    ).then((t) => {
      const m = t.match(/\[HL\]([\s\S]*?)\[\/HL\]/i);   // extract ONLY the marked phrase
      // no markers = the model didn't produce a vetted phrase — return nothing rather
      // than dump unvetted prose (which could carry fair-housing-risk language) into the field
      if (!m) return '';
      return m[1].replace(/^(here(?:'s| is)[^:]*:\s*|sure[,!]?\s*|i (?:have|'ve)[^:]*:\s*|location highlights:\s*)/i, '')
        .replace(/^["'“]+|["'”]+$/g, '').trim();
    });
  };

  // ---- AI auto-layout: compose a full Design Studio graphic (structured JSON) -
  // The model only emits LAYOUT/COLOUR/TYPOGRAPHY decisions + references to real
  // facts — it never writes property copy or touches pixels. The studio binds
  // the actual fact strings, so a fabricated price/feature is structurally
  // impossible. Fair-housing language is blocked the same way (no free text
  // except a fixed status/CTA whitelist).
  const LABEL_WHITELIST = ['FOR SALE', 'FOR LEASE', 'NEW LISTING', 'JUST LISTED', 'HOME OPEN', 'UNDER OFFER', 'SOLD', 'AUCTION', 'EXPRESSIONS OF INTEREST', 'PRICE GUIDE', 'INSPECT', 'CONTACT', 'VIEW NOW', 'ENQUIRE', 'OFFERS FROM'];

  const designSystem = (ctx) => `You are the layout director inside "Listing Kit Design Studio", a 100% client-side real-estate graphics editor used by agents in Perth, Western Australia. Your ONLY job is to compose designs by returning STRICT JSON that maps onto the studio's layer model. You choose background, colours, typography, position, scale, rotation, opacity and visual hierarchy. You do NOT write marketing copy and you do NOT generate or alter imagery.

OUTPUT: return ONE JSON object and nothing else — no prose, no markdown, no code fences. Shape:
{"variations":[Design, ...]}  // exactly ${ctx.n} designs, best first, meaningfully different from each other.
Design = {"name":"<=40 chars","rationale":"<=120 chars, about VISUAL design only","size":"${ctx.size}","background":Background,"layers":[Layer,...]}  // 3-12 layers (use more when a colour/pattern effect needs them), array order = paint order (index 0 = back).

Coordinates xf,yf are FRACTIONS in [0,1] giving the CENTRE of a layer. (0,0)=top-left, (1,1)=bottom-right. Canvas = ${ctx.size} ${ctx.w}x${ctx.h}px.

Background (pick one):
 {"type":"photo","photoIndex":<0..${Math.max(0, ctx.photoCount - 1)}>,"filter":{"brightness":-100..100}}   // an EXISTING listing photo; filter optional
 {"type":"solid","color":"primary|accent|dark|white|#hex"}
 {"type":"gradient","from":"<color>","to":"<color>","mode":"linear|radial","angle":0..360}
${ctx.photoCount ? `There are ${ctx.photoCount} photos (indices 0..${ctx.photoCount - 1}).` : 'There are NO photos — use solid or gradient only.'}

Layer types & required keys (common: xf,yf required; opacity 0..1, rot -180..180 optional):
 Text from a FACT — {"type":"price|address|stats|agent","textRef":"price|address|stats|badge|agentName|phone|brokerage","size":12..280,"color":"<color>","font":"serif|sans","weight":300..900,"align":"left|center|right","shadow":bool,"outline":bool,"wrapf":0 or 0.2..1,"uppercase":bool}
 Status/CTA label — {"type":"text","text":"<EXACTLY one of: ${LABEL_WHITELIST.join(', ')}>", ...same text styling...}
 Badge (status pill) — {"type":"badge","textRef":"badge","color":"<color>", ...text styling...}
 Shape — {"type":"shape","shape":"rect|ellipse","color":"<color>","wf":0.02..1,"hf":0.02..1,"radius":0..200,"grad":"none|up|down|left|right"}
 Scrim (readability gradient) — {"type":"scrim","edge":"top|bottom|left|right|full","color":"dark|#hex","strength":0..1,"coverf":0.1..1}
 ${ctx.hasLogo ? '' : '(no logo asset — do NOT use a logo layer) '}${ctx.hasHead ? '' : '(no headshot asset — do NOT use a headshot layer) '}Brand image — {"type":"logo|headshot","shape":"rect|circle","wf":0.03..0.6}

THE ONLY FACTS YOU MAY USE (reference via textRef; you may NOT type these values yourself, invent, infer, round, reformat or embellish them):
 price = ${ctx.facts.price ? JSON.stringify(ctx.facts.price) : '(absent)'}
 address = ${ctx.facts.address ? JSON.stringify(ctx.facts.address) : '(absent)'}
 stats = ${ctx.facts.stats ? JSON.stringify(ctx.facts.stats) : '(absent)'}
 badge = ${ctx.facts.badge ? JSON.stringify(ctx.facts.badge) : '(absent)'}
 agentName = ${ctx.brand.agentName ? JSON.stringify(ctx.brand.agentName) : '(absent)'}
 phone = ${ctx.brand.phone ? JSON.stringify(ctx.brand.phone) : '(absent)'}
 brokerage = ${ctx.brand.brokerage ? JSON.stringify(ctx.brand.brokerage) : '(absent)'}
 brand primary = ${ctx.brand.primary}   accent = ${ctx.brand.accent}
If a field is "(absent)" you MUST omit any layer referencing it — never substitute a placeholder like "[price]" or "Contact agent". The "agent" type combines agentName/phone/brokerage that are present.

SAFETY (legal hard line — never violate, including in name/rationale): never produce or imply who should live there ("perfect for families", "ideal for couples/students/retirees", "family-friendly"), proximity/lifestyle claims ("walking distance", "close to schools/beach", "quiet", "safe"), or any school/crime/safety/religion/race/nationality/family-status/disability/age claim. You can only place the four facts + a whitelisted label, so do not try to smuggle claims anywhere.

AUSTRALIAN CONVENTIONS: currency AUD, areas m²; the status already uses "home open" (never "open house"); never reformat the price.

READABILITY & TASTE: light ("white") text only over dark areas — over a photo or light background put a "scrim" or dark "shape" behind it, or use dark/primary text. The most important fact (usually price or status) is the largest element; establish clear hierarchy. Keep every layer centre within 0.06–0.94 of the edges. At most one serif + one sans. Avoid rotating text beyond ~8°. Make the ${ctx.n} designs differ in background type, hierarchy and layout axis — not just recoloured.

COLOUR: default to the brand palette (tokens primary/accent/white/dark) for a cohesive look — UNLESS the agent's instruction names colours or asks for a colourful/playful effect (e.g. "rainbow", "warm tones", "blue", "pastel"). In that case use those EXACT colours via #hex and do NOT fall back to brand tokens. A "gradient" blends only TWO colours, so to build a multi-colour effect like a RAINBOW you must layer several coloured "shape" rectangles or ellipses side by side or stacked (e.g. red #e63946, orange #f4a261, yellow #ffd166, green #2a9d8f, blue #277da1, indigo #5a4fcf, violet #9b5de5) — as many shapes as it takes. When the instruction explicitly requests colours or content, EVERY one of the ${ctx.n} variations must honour it (vary the LAYOUT/arrangement between them, never whether the request is satisfied).

Now produce the JSON.`;

  const parseDesigns = (raw) => {
    let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const m = s.match(/\{[\s\S]*\}/);
    if (m) s = m[0];
    let o = null;
    try { o = JSON.parse(s); } catch (e) { try { o = JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (e2) { o = null; } }
    const arr = o && Array.isArray(o.variations) ? o.variations : [];
    return arr.slice(0, 3);
  };

  const designLayout = async (ctx) => {
    const sys = designSystem(ctx);
    const user = `Compose ${ctx.n} distinct ${ctx.size} designs for this listing as JSON.` + (ctx.vibe ? ` Style direction from the agent: "${String(ctx.vibe).slice(0, 200)}" — honour it within every rule above.` : '');
    const designs = parseDesigns(await call(sys, user, 3000));
    if (!designs.length) throw new Error('The AI didn’t return a usable design — try again.');
    return designs;
  };

  // ---- AI restyle: EDIT the current design per an instruction ---------------
  const editLayout = async (ctx) => {
    const sys = designSystem(ctx) + `\n\nYOU ARE EDITING AN EXISTING DESIGN, not starting from scratch. The design currently on the canvas is:\n${ctx.current}\n\nKeep its overall composition and everything the instruction does NOT mention; change only what the instruction asks (and anything required to keep it readable and on-brand). Every rule and the SAFETY line above still apply, and you must still bind text via textRef — never type a fact value.`;
    const user = `Apply this change to the current design and return ${ctx.n} edited ${ctx.size} variation(s) as JSON (best first): "${String(ctx.instruction).slice(0, 240)}".`;
    const designs = parseDesigns(await call(sys, user, 3000));
    if (!designs.length) throw new Error('The AI didn’t return a usable restyle — try again.');
    return designs;
  };

  // ---- AI design styling (text-only → template + colours + font) ------------
  const STYLE_SYSTEM = [
    'You are a brand designer for real estate marketing. Given a vibe, choose a cohesive visual identity.',
    'Respond with ONLY a compact JSON object — no prose, no markdown fences:',
    '{"template":"modern|classic|bold","primary":"#RRGGBB","accent":"#RRGGBB","font":"serif|sans"}',
    'primary = a deep, rich brand colour for bars/backgrounds; accent = a complementary highlight. White or near-white text must be clearly readable on primary, so keep primary dark/saturated.',
    'template: modern = full-bleed photo with a gradient; classic = framed editorial with serif; bold = colour-block panels.',
    'font: serif for elegant/luxury/editorial vibes, sans for modern/clean/minimal.',
  ].join('\n');
  const HEX = /^#[0-9a-f]{6}$/i;
  const designStyle = async (description) => {
    const raw = await call(STYLE_SYSTEM, `Vibe: ${description}`, 200);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not read a style from the AI.');
    let o;
    try { o = JSON.parse(m[0]); } catch (e) { throw new Error('Could not read a style from the AI.'); }
    const out = {};
    if (['modern', 'classic', 'bold'].includes(o.template)) out.templateId = o.template;
    if (HEX.test(o.primary)) out.primary = o.primary;
    if (HEX.test(o.accent)) out.accent = o.accent;
    if (['serif', 'sans'].includes(o.font)) out.font = o.font;
    if (!out.primary && !out.accent && !out.templateId) throw new Error('The AI didn’t return a usable style.');
    return out;
  };

  // ---- AI compliance double-check (catches what the regex scanner misses) ----
  const COMPLIANCE_SYSTEM = [
    'You are a real-estate advertising compliance reviewer for the AU and US markets. Scan the supplied listing text for any wording that could breach fair-housing / anti-discrimination law: a preference, limitation, or exclusion based on race, colour, ethnicity, religion, national origin, sex/gender, disability, familial status / children, age, or (AU) source of income or occupation. Also flag steering language ("safe", "good schools", "exclusive/prestigious area") and ableist phrasing ("walking distance", "must be active").',
    'Be thorough — catch subtle, coded, and explicit cases (e.g. "no asians", "ideal for a young professional couple", "great Christian community").',
    'Return ONLY a JSON array, no prose and no markdown fences. Each element: {"phrase": exact offending words from the text, "issue": short class e.g. "Race / national origin", "why": one sentence, "fix": a compliant rewrite or "Remove."}. If the text is clean, return [].',
  ].join('\n');
  const compliance = async (text) => {
    const raw = await call(COMPLIANCE_SYSTEM, `Review this listing text and report every fair-housing / anti-discrimination risk as JSON:\n\n${text}`, 1500);
    let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const m = s.match(/\[[\s\S]*\]/); if (m) s = m[0];
    try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  };

  // quick validation ping — cheapest model, tiny output
  const test = async () => {
    const key = getKey();
    if (!key) { const e = new Error('no-key'); e.status = 0; throw e; }
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }),
    }).catch(() => { const e = new Error('network'); e.status = -1; throw e; });
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || ''; } catch (e) {}
      const err = new Error(msg || ('HTTP ' + res.status)); err.status = res.status; throw err;
    }
    return true;
  };

  // friendly error text for the UI
  const explain = (e) => {
    const s = e && e.status;
    if (s === 0) return 'Add your API key above to enable AI.';
    if (s === -1) return 'Couldn’t reach Anthropic — check your connection or an ad-blocker.';
    if (s === 401) return 'Key rejected — check it’s a valid Anthropic API key.';
    if (s === 403) return 'This key isn’t permitted — check it has credit and access.';
    if (s === 429) return 'Rate limited — wait a moment and try again.';
    if (s === 400 && /credit|balance|billing/i.test(e.message)) return 'No credit on this key — top up at console.anthropic.com.';
    if (s >= 500) return 'Anthropic is busy right now — try again shortly.';
    return e && e.message ? e.message : 'Something went wrong.';
  };

  return { MODELS, available, getKey, setKey, getModel, setModel, modelLabel, polish, instruct, research, designStyle, designLayout, editLayout, compliance, test, explain };
})();
