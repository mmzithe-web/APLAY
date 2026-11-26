// Aplay chat server: conversation + track library (with AI-written tags) -> Gemini
module.exports = async (req, res) => {
  const say = (code, reply, ids = []) => res.status(code).json({ reply, ids });
  if (req.method !== 'POST') return say(405, 'POST only');
  const { SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY } = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GEMINI_API_KEY'].filter(k => !process.env[k]);
  if (missing.length) return say(200, '⚠️ Missing keys in Vercel: ' + missing.join(', '));
  const limit = +(process.env.DAILY_LIMIT || 60);
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return say(200, '⚠️ Not logged in. Log out and log in again.');
  let base = SUPABASE_URL.trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  const sb = { apikey: SUPABASE_ANON_KEY.trim(), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let step = 'start';
  try {
    step = 'auth (Supabase)';
    const u = await fetch(base + '/auth/v1/user', { headers: sb });
    if (!u.ok) return say(200, '⚠️ step: ' + step + ' | code ' + u.status + ' | Supabase URL or key in Vercel is wrong. ' + (await u.text()).slice(0, 150));

    step = 'daily limit';
    const b = await fetch(base + '/rest/v1/rpc/bump_usage', { method: 'POST', headers: sb, body: '{}' });
    if (!b.ok) return say(200, '⚠️ step: ' + step + ' | code ' + b.status + ' | ' + (await b.text()).slice(0, 150));
    const count = await b.json();
    if (count > limit) return say(200, `You have reached today's message limit. Come back tomorrow 🌙`);

    step = 'reading tracks';
    const t = await fetch(base + '/rest/v1/tracks?select=id,title,artist,moods', { headers: sb });
    if (!t.ok) return say(200, '⚠️ step: ' + step + ' | code ' + t.status + ' | ' + (await t.text()).slice(0, 150));
    const tracks = await t.json();
    const known = new Set(tracks.map(x => Number(x.id)));
    const lib = tracks.map(x => x.id + ' | ' + (x.title || '?') + ' - ' + (x.artist || '?') + ' | ' + (x.moods || []).join('; ')).join('\n');

    step = 'AI (Gemini)';
    const { message = '', history = [] } = req.body || {};
    const hist = Array.isArray(history) ? history.slice(-12) : [];
    const asked = hist.filter(h => h.role === 'assistant' && String(h.text || '').indexOf('[playlist ids:') < 0).length;

    const prompt = `You are Aplay, a warm and concise music curator chatting with a listener. Always reply in the same language the user writes in (if they write Persian, reply in Persian).

HOW THE LIBRARY WORKS
Each library line is: id | title - artist | tags. Tags written as key:value were produced by listening to the song, so trust them:
- vocals: with vocals, instrumental, rap or mixed
- language: the language that is sung (none means there are no lyrics)
- region: eastern (Persian, Arabic, Turkish, Indian or other Asian character), western, or fusion; origin: the musical tradition
- genre and subgenre
- energy: calm, relaxed, medium, energetic or intense; tempo: slow, medium or fast; bpm: approximate beats per minute
- mood: the emotions of the song
- time: the best times of day (morning, noon, afternoon, evening, night, late night)
- place: the best places or activities (car, gym, study, home, party, walking and so on)
- weather: the best weather
- vibe: atmosphere words
Tags without a colon were typed by the owner and can be less reliable: if they contradict the key:value tags, trust the key:value tags. A song without any key:value tags was not analysed yet: judge it only by its title and artist, and prefer analysed songs.

WHAT YOU NEED TO KNOW (ask only for what is missing, never repeat what the user already said)
1. mood or feeling
2. where they are or what they are doing
3. time of day (use clues such as night, morning, after work)
4. weather, if they mention it
5. taste: with lyrics or instrumental, language, eastern or western, calm or energetic
Ask ONE short, specific question at a time and give two or three example answers inside it. Ask first about the most important missing item (usually the situation, then the taste for lyrics and language). You have already asked ${asked} question(s) in this conversation. If that number is 2 or more, or the user is in a hurry or says something like just play something, do NOT ask again: build the playlist now using sensible defaults.
A reply either asks a question or gives songs, never both. If you ask a question, return an empty ids list. If you return songs, do not ask a question; you may end with one short offer to adjust it (for example calmer or more energetic). If the user already told you the situation plus at least one clear taste (for example night, car, Persian), that is enough: build the playlist.

BUILDING THE PLAYLIST
- Pick 3 to 8 songs by id. Hard wishes from the user (a language, with lyrics or instrumental, eastern or western, an energy level) must be respected: never include a song that breaks them.
- Match the softer clues using the tags: a drive at night means place car, time night and medium or energetic energy; studying or work means instrumental or calm songs without lyrics unless the user wants lyrics; the gym means energetic or intense and fast; sleeping or relaxing means calm and slow; rain or clouds mean weather rainy or cloudy with melancholic or peaceful moods; a party means energetic.
- Order the songs as a listening journey: start at the user's current energy and move toward where they want to be. Do not use more than two songs by the same artist.
- If the library has too few songs that fit, say so honestly, give the closest ones and explain the compromise. If nothing fits at all, return an empty ids list.
- Use ONLY ids that appear in the library.
- In the reply, explain in at most three short sentences why the playlist fits (for example instrumental, calm, night, rain) without listing tag names mechanically.

CHANGING A PLAYLIST
If the user asks to change it (more energy, calmer, swap a song, fewer or more songs, add or remove lyrics, another language), start from the ids shown as [playlist ids: ...] in the conversation and return the full updated list.

OUTPUT
Respond ONLY with JSON: {"reply":"...","ids":[1,2],"title":"..."}
title is a 2 to 4 word title of this conversation in the user's language. Give a title even when you only ask a question.

Library:
${lib}

Conversation so far:
${hist.map(h => h.role + ': ' + h.text).join('\n')}
user: ${String(message).slice(0, 600)}`;

    const fallback = process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest';
    const tries = [model, model, fallback, model, fallback];
    let g, j;
    for (let i = 0; i < tries.length; i++) {
      g = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + tries[i] + ':generateContent?key=' + GEMINI_API_KEY.trim(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      j = await g.json();
      if (g.ok) break;
      const retry = g.status === 503 || g.status === 500 || g.status === 429 || (g.status === 404 && tries[i] === fallback);
      if (!retry) break;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
    if (!g.ok) return say(200, '⚠️ step: ' + step + ' | code ' + g.status + ' | ' + ((j.error && j.error.message) || '').slice(0, 200));

    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.map(p => p.text || '').join('');
    if (!text.trim()) return say(200, '⚠️ The AI did not answer. Please try again.');
    let out;
    try { out = JSON.parse(text.split('```json').join('').split('```').join('').trim()); }
    catch (e) { return say(200, '⚠️ The AI answer could not be read. Please try again.'); }
    const ids = (Array.isArray(out.ids) ? out.ids : []).map(Number).filter(n => known.has(n)).filter((n, i, a) => a.indexOf(n) === i).slice(0, 8);
    return res.status(200).json({ reply: String(out.reply || ''), ids, title: String(out.title || '') });
  } catch (e) {
    return say(200, '⚠️ step: ' + step + ' | ' + String(e.message).slice(0, 200));
  }
};
