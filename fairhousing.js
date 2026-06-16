/* Listing Kit — fair-housing language checker.
 *
 * The federal Fair Housing Act (and many state equivalents) bar language in
 * advertising that signals a preference, limitation, or discrimination based on
 * a protected class: race, color, religion, national origin, sex, disability,
 * and familial status. Agents get tripped up by phrases that sound harmless —
 * "perfect for families," "safe neighbourhood," "walking distance," "master
 * bedroom." This module scans any text and flags those phrases with the why and
 * a safer rewrite.
 *
 * This is decision support, not legal advice — always defer to the broker's
 * compliance team. But it catches the common, costly mistakes before they post.
 */
const FairHousing = (() => {
  'use strict';

  // severity: 'high' = well-known violation pattern; 'medium' = risky/steering;
  // 'low'  = often fine but worth a glance / increasingly avoided by MLSs.
  const RULES = [
    // ---- Familial status ----------------------------------------------------
    { re: /\bperfect for families\b/i, cls: 'Familial status', sev: 'high', why: 'Signals a preference for families with children.', fix: 'Describe the home: “spacious layout,” “generous bedrooms.”' },
    { re: /\b(great|ideal|perfect) for (kids|children|families)\b/i, cls: 'Familial status', sev: 'high', why: 'Expresses a preference based on who lives there.', fix: 'Focus on the feature: “large fenced yard,” “flexible bonus room.”' },
    { re: /\bfamily[- ]friendly\b/i, cls: 'Familial status', sev: 'high', why: 'Implies a preference for families.', fix: 'Try “welcoming” or describe the actual amenity.' },
    { re: /\b(no (kids|children)|adults? only|not? for children)\b/i, cls: 'Familial status', sev: 'high', why: 'Directly excludes families with children.', fix: 'Remove. Age limits are only lawful for verified 55+/62+ communities.' },
    { re: /\bbachelor (pad|apartment)\b/i, cls: 'Familial status / Sex', sev: 'medium', why: 'Implies a preferred household type/gender.', fix: 'Describe the space: “efficient one-bedroom,” “low-maintenance.”' },
    { re: /\bempty[- ]nesters?\b/i, cls: 'Familial status', sev: 'medium', why: 'Targets a household type based on children.', fix: 'Describe the benefit: “single-level living,” “low upkeep.”' },
    { re: /\b(mother[- ]in[- ]law|in[- ]law) (suite|unit|apartment)\b/i, cls: 'Familial status', sev: 'low', why: '“In-law suite” is common but some brokers prefer neutral wording.', fix: 'Consider “accessory dwelling unit (ADU)” or “guest suite.”' },

    // ---- Religion -----------------------------------------------------------
    { re: /\b(christian|catholic|jewish|muslim|synagogue|mosque|kosher|halal)\b/i, cls: 'Religion', sev: 'high', why: 'References religion or religious institutions as a selling point.', fix: 'Remove religious references; name secular landmarks instead.' },
    { re: /\b(church|temple|parish)\b(?!\s+(?:st|street|rd|road|ave|avenue|ln|lane|cl|close|pl|place|ct|court|dr|drive|way|hwy|highway|tce|terrace|cres|crescent|blvd|grove|grammar|college|school))/i, cls: 'Religion', sev: 'medium', why: 'May reference a religious institution as a selling point.', fix: 'If this is a street or landmark name it is fine; otherwise remove the religious reference.' },
    { re: /\bholy\b/i, cls: 'Religion', sev: 'low', why: 'May read as a religious reference depending on context.', fix: 'Rephrase if it refers to a religious site.' },

    // ---- Race / color / national origin -------------------------------------
    { re: /\b(exclusive|restricted) (neighbou?rhood|community|area|enclave)\b/i, cls: 'Race / national origin', sev: 'high', why: '“Exclusive/restricted” can imply who is welcome.', fix: 'Try “sought-after” or “established” and describe the homes.' },
    { re: /\b((?:integrated|traditional)\s+(?:neighbou?rhood|community|area|enclave|suburb|district|block)|established ethnic)\b/i, cls: 'Race / national origin', sev: 'medium', why: 'Comments on the makeup of a neighbourhood.', fix: 'Describe amenities and architecture, not demographics.' },
    // directly excludes/prefers a protected group (catches "no asians", "whites only", etc. — incl. plurals)
    { re: /\b(no|only|prefer(?:red)?|not?\s+for)\s+(asians?|hispanics?|latinos?|latinas?|blacks?|whites?|caucasians?|africans?|indians?|arabs?|jews?|jewish|muslims?|christians?|chinese|europeans?|immigrants?|foreigners?)\b/i, cls: 'Race / national origin', sev: 'high', why: 'Directly excludes or prefers people by race, ethnicity, nationality or religion — a serious anti-discrimination / Fair Housing violation.', fix: 'Remove entirely. You may never reference, prefer or exclude a protected group.' },
    { re: /\b(asians?|hispanics?|latinos?|latinas?|blacks?|whites?|caucasians?|africans?|ethnic|chinese|indians?|europeans?|jewish|muslim|christian)\s+(only|preferred|neighbou?rhood|area|community|enclave|district|suburb|famil(?:y|ies)|buyers?|tenants?|owners?|households?|clientele|applicants?)\b/i, cls: 'Race / national origin', sev: 'high', why: 'Describes an area, buyer or tenant by race/ethnicity/religion.', fix: 'Never describe a neighbourhood or occupant by demographics — describe the property.' },
    { re: /\b(hispanics?|latinos?|latinas?|caucasians?|asians?\s+(?:buyers?|tenants?|families|community))\b/i, cls: 'Race / national origin', sev: 'medium', why: 'Mentions a racial/ethnic group — almost never appropriate in a listing.', fix: 'Remove unless it is an unambiguous non-demographic reference (e.g. a cuisine).' },

    // ---- Disability ---------------------------------------------------------
    { re: /\bwalking distance\b/i, cls: 'Disability', sev: 'medium', why: '“Walking distance” can be read as excluding those with mobility needs.', fix: 'Use “close to,” “minutes from,” or give the distance.' },
    { re: /\bwalk to\b/i, cls: 'Disability', sev: 'low', why: 'Similar concern to “walking distance.”', fix: 'Use “near” or “a short distance from.”' },
    { re: /\b(able[- ]bodied|must be able to|good for (active|fit))\b/i, cls: 'Disability', sev: 'high', why: 'Implies a physical-ability requirement.', fix: 'Remove ability references entirely.' },
    { re: /\b(no wheelchairs?|not (handicap|wheelchair) accessible as a plus)\b/i, cls: 'Disability', sev: 'high', why: 'Excludes people with disabilities.', fix: 'Remove. State accessibility features factually if relevant.' },
    { re: /\bhandicap(ped)?\b/i, cls: 'Disability', sev: 'low', why: '“Handicapped” is outdated; describe features factually.', fix: 'Use “accessible” or name the feature (e.g., “zero-step entry”).' },

    // ---- Sex / gender -------------------------------------------------------
    { re: /\bmaster (bedroom|suite|bath)\b/i, cls: 'Sex (style/convention)', sev: 'low', why: 'Many MLSs and brokerages now prefer “primary.”', fix: 'Use “primary bedroom / primary suite / primary bath.”' },
    { re: /\bhis and hers\b/i, cls: 'Sex', sev: 'low', why: 'Gendered phrasing; easy to neutralize.', fix: 'Use “dual vanities” or “two closets.”' },

    // ---- Age ----------------------------------------------------------------
    { re: /\b(perfect|ideal|great) for (retirees|seniors|the elderly|young professionals|singles)\b/i, cls: 'Familial status / Age', sev: 'high', why: 'Targets buyers by age or life stage.', fix: 'Describe the home, not the intended buyer.' },
    { re: /\b(senior|retiree|55\+|active adult)\b/i, cls: 'Age', sev: 'medium', why: 'Age targeting is only lawful in verified 55+/62+ communities.', fix: 'Only use if the community is legally age-restricted; otherwise remove.' },

    // ---- Steering / coded "desirability" ------------------------------------
    { re: /\b(safe|safer)\b(?!\s*(room|deposit|harbor))/i, cls: 'Steering (safety)', sev: 'high', why: '“Safe” is a classic steering word — it can imply who lives there and creates liability if ever inaccurate.', fix: 'Remove safety claims entirely; describe the property instead.' },
    { re: /\b(crime[- ]free|low[- ]crime|no crime)\b/i, cls: 'Steering (safety)', sev: 'high', why: 'Crime claims are steering and a liability risk.', fix: 'Remove. Let buyers research public crime data themselves.' },
    { re: /\b(good|great|top|best|excellent) schools?\b/i, cls: 'Steering (schools)', sev: 'medium', why: 'School-quality claims can function as steering and proxy for class/race.', fix: 'State the district name factually, or let buyers research it.' },
    { re: /\b(desirable|prestigious|prime|sought[- ]after) (neighbou?rhood|area|community)\b/i, cls: 'Steering', sev: 'low', why: 'Vague desirability language can edge into steering.', fix: 'Be specific: name the park, the trail, the coffee shop.' },
    { re: /\bquiet (neighbou?rhood|area|street|community)\b/i, cls: 'Steering', sev: 'low', why: 'Subjective claims about an area can be read as coded.', fix: 'Describe the street factually (“tree-lined,” “low-traffic cul-de-sac”).' },
    { re: /\bgated community\b/i, cls: 'Steering', sev: 'low', why: 'Usually fine as a factual feature; just avoid “exclusive” framing.', fix: 'Keep factual: “gated community with controlled access.”' },

    // ---- Rental-specific tenant restrictions --------------------------------
    { re: /\b(professionals?\s+only|suit(?:s|able for)?\s+(?:a\s+)?(?:young\s+)?professionals?(?:\s+couple)?|working\s+professionals?\s+only)\b/i, cls: 'Tenant selection', sev: 'medium', why: 'Targeting tenants by occupation/household type can be discriminatory.', fix: 'Describe the property, not the ideal tenant.' },
    { re: /\bno\s+students?\b|\bstudents?\s+need\s+not\s+apply\b/i, cls: 'Tenant selection', sev: 'medium', why: 'Excluding students can be discriminatory and is restricted in some areas.', fix: 'Remove; assess every application on its merits.' },
    { re: /\b(no\s+dss|no\s+benefits?|no\s+centrelink|must\s+be\s+employed|employed\s+only|no\s+unemployed)\b/i, cls: 'Source of income', sev: 'high', why: 'Refusing tenants on income source (benefits/Centrelink/DSS) is unlawful in many jurisdictions.', fix: 'Remove entirely — assess affordability individually, not by income source.' },
    { re: /\bsingle\s+(person|professional|occupant)\b/i, cls: 'Tenant selection', sev: 'medium', why: 'Specifying household size/type can be discriminatory.', fix: 'State the bedroom count; let applicants decide if it suits them.' },
    { re: /\bmature\s+(tenant|couple|person|applicant)s?\b/i, cls: 'Age', sev: 'medium', why: '“Mature” signals an age preference.', fix: 'Describe the home (e.g. “low-maintenance, single-level”), not the tenant’s age.' },
    { re: /\bno\s+pets\b/i, cls: 'Tenant selection (pets)', sev: 'low', why: 'Many jurisdictions (incl. parts of Australia) now restrict blanket no-pet clauses.', fix: 'Check current tenancy law; consider “pets considered on application”.' },
  ];

  // Scan a single string; returns [{match, cls, sev, why, fix, index}]
  const scanText = (text) => {
    if (!text) return [];
    const findings = [];
    RULES.forEach((rule) => {
      const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        findings.push({ match: m[0], cls: rule.cls, sev: rule.sev, why: rule.why, fix: rule.fix, index: m.index });
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
      }
    });
    return findings;
  };

  // Scan a map of { channel: text }. Dedupes identical matches across channels
  // and reports which channels each phrase appeared in.
  const scan = (sources) => {
    const byPhrase = new Map();
    Object.entries(sources).forEach(([channel, text]) => {
      scanText(text).forEach((f) => {
        const key = f.match.toLowerCase() + '|' + f.cls;
        if (!byPhrase.has(key)) byPhrase.set(key, { ...f, channels: new Set() });
        byPhrase.get(key).channels.add(channel);
      });
    });
    const findings = [...byPhrase.values()].map((f) => ({ ...f, channels: [...f.channels] }));
    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.sev] - order[b.sev]);
    const counts = { high: 0, medium: 0, low: 0 };
    findings.forEach((f) => counts[f.sev]++);
    return { findings, counts, clear: findings.length === 0 };
  };

  return { scan, scanText, RULES };
})();
