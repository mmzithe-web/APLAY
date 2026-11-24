// Aplay chat server: conversation + track library -> Gemini
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
  const base = SUPABASE_URL.trim().replace(/\/+$/, '');
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
    if (count > limit) return say(200, 'You have reached today\'s message limit. Come back tomorrow 🌙');

    step = 'reading tracks';
    const t = await fetch(base + '/rest/v1/tracks?select=id,title,artist,moods', { headers: sb });
    if (!t.ok) return say(200, '⚠️ step: ' + step + ' | code ' + t.status + ' | ' + (await t.text()).slice(0, 150));
    const tracks = await t.json();

    step = 'AI (Gemini)';
    const { message = '', history = [] } = req.body || {};
    const prompt = 'You are Aplay, a friendly music curator chatting with a user. Always reply in the same language the user writes in. Keep replies short and warm. ' +
      'Your goal: understand the user\'s mood, the weather and where they are or what they are doing (and energy or taste if useful), then build a playlist from the library below. ' +
      'If you still lack key information, ask ONE short question and return an empty ids list. ' +
      'Once you have enough information, or the user asks for songs, pick 3-8 tracks from the library by id, ordered as a listening journey, and briefly say why. ' +
      'If the user asks to change the playlist (more energy, calmer, swap, fewer songs), return an updated list. ' +
      'Use ONLY ids from the library. If nothing fits, say so honestly and return an empty list. ' +
      'Also return "title": a 2-4 word title for this conversation, in the user\'s language. ' +
      'Library: ' + JSON.stringify(tracks) +
      '\nRespond ONLY JSON: {"reply":"...","ids":[...],"title":"..."}\nConversation so far:\n' +
      history.slice(-12).map(h => h.role + ': ' + h.text).join('\n') + '\nuser: ' + String(message).slice(0, 600);
    let g, j;
    for (let i = 0; i < 3; i++) {
      g = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY.trim(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      });
      j = await g.json();
      if (g.status !== 503) break;
      await new Promise(r => setTimeout(r, 1200));
    }
    if (!g.ok) return say(200, '⚠️ step: ' + step + ' | code ' + g.status + ' | ' + ((j.error && j.error.message) || '').slice(0, 200));
    const out = JSON.parse(j.candidates[0].content.parts[0].text);
    return res.status(200).json({ reply: out.reply, ids: out.ids || [], title: out.title || '' });
  } catch (e) {
    return say(200, '⚠️ step: ' + step + ' | ' + String(e.message).slice(0, 200));
  }
};
