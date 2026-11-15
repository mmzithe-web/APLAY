// سرور کوچک: پیام کاربر + لیست آهنگ‌ها را به Gemini می‌فرستد
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY } = process.env;
  const limit = +(process.env.DAILY_LIMIT || 30);
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'login' });
  const sb = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    const u = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: sb });
    if (!u.ok) return res.status(401).json({ error: 'login' });
    const b = await fetch(SUPABASE_URL + '/rest/v1/rpc/bump_usage', { method: 'POST', headers: sb, body: '{}' });
    const count = await b.json();
    if (count > limit) return res.status(429).json({ reply: 'سهمیه‌ی پیام امروزت تموم شد. فردا دوباره بیا 🌙', ids: [] });
    const t = await fetch(SUPABASE_URL + '/rest/v1/tracks?select=id,title,artist,moods', { headers: sb });
    const tracks = await t.json();
    const { message = '', history = [] } = req.body || {};
    const prompt = 'You are APLAY, a music curator. Reply in Persian, warm and short. The user describes mood, weather and place. Pick 3-8 tracks ONLY from this library (by id) and order them as a listening journey. If the library has nothing suitable, say so and return an empty list. Library: ' + JSON.stringify(tracks) +
      '\nRespond ONLY JSON: {"reply":"...","ids":[...]}\nChat so far:\n' + history.slice(-8).map(h => h.role + ': ' + h.text).join('\n') + '\nuser: ' + String(message).slice(0, 500);
    const g = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
    });
    const j = await g.json();
    const out = JSON.parse(j.candidates[0].content.parts[0].text);
    res.json({ reply: out.reply, ids: out.ids || [] });
  } catch (e) {
    res.status(500).json({ reply: 'مشکلی پیش اومد، دوباره امتحان کن.', ids: [] });
  }
};
