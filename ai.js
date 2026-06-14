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
  const call = async (system, user, maxTokens = 1500) => {
    const key = getKey();
    if (!key) { const e = new Error('no-key'); e.status = 0; throw e; }
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
        body: JSON.stringify({
          model: getModel(),
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
        }),
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
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
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

  return { MODELS, available, getKey, setKey, getModel, setModel, modelLabel, polish, instruct, test, explain };
})();
