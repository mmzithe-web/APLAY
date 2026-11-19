// سرور کوچک APLAY - نسخه‌ی عیب‌یابی: خطای دقیق را در چت نشان می‌دهد
module.exports = async (req, res) => {
  const say = (code, reply, ids = []) => res.status(code).json({ reply, ids });
  if (req.method !== 'POST') return say(405, 'فقط POST');
  const { SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY } = process.env;
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GEMINI_API_KEY'].filter(k => !process.env[k]);
  if (missing.length) return say(200, '⚠️ این کلیدها توی Vercel نیستن: ' + missing.join(' ، '));
  const limit = +(process.env.DAILY_LIMIT || 30);
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return say(200, '⚠️ وارد نشدی. خروج بزن و دوباره ورود کن.');
  const base = SUPABASE_URL.trim().replace(/\/+$/, '');
  const sb = { apikey: SUPABASE_ANON_KEY.trim(), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let step = 'شروع';
  try {
    step = 'تأیید کاربر (Supabase)';
    const u = await fetch(base + '/auth/v1/user', { headers: sb });
    if (!u.ok) return say(200, '⚠️ مرحله: ' + step + ' | کد ' + u.status + ' | آدرس یا کلید Supabase توی Vercel غلطه. ' + (await u.text()).slice(0, 150));

    step = 'محدودیت روزانه';
    const b = await fetch(base + '/rest/v1/rpc/bump_usage', { method: 'POST', headers: sb, body: '{}' });
    if (!b.ok) return say(200, '⚠️ مرحله: ' + step + ' | کد ' + b.status + ' | ' + (await b.text()).slice(0, 150) + ' (احتمالاً فایل supabase.sql کامل اجرا نشده)');
    const count = await b.json();
    if (count > limit) return say(200, 'سهمیه‌ی پیام امروزت تموم شد. فردا دوباره بیا 🌙');

    step = 'خواندن آهنگ‌ها';
    const t = await fetch(base + '/rest/v1/tracks?select=id,title,artist,moods', { headers: sb });
    if (!t.ok) return say(200, '⚠️ مرحله: ' + step + ' | کد ' + t.status + ' | ' + (await t.text()).slice(0, 150));
    const tracks = await t.json();

    step = 'هوش مصنوعی (Gemini)';
    const { message = '', history = [] } = req.body || {};
    const prompt = 'You are APLAY, a music curator. Reply in the same language the user writes in, warm and short. The user describes mood, weather and place. Pick 3-8 tracks ONLY from this library (by id) and order them as a listening journey. If nothing fits, say so and return an empty list. Library: ' + JSON.stringify(tracks) +
      '\nRespond ONLY JSON: {"reply":"...","ids":[...]}\nChat so far:\n' + history.slice(-8).map(h => h.role + ': ' + h.text).join('\n') + '\nuser: ' + String(message).slice(0, 500);
    const g = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + GEMINI_API_KEY.trim(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
    });
    const j = await g.json();
    if (!g.ok) return say(200, '⚠️ مرحله: ' + step + ' | کد ' + g.status + ' | ' + ((j.error && j.error.message) || '').slice(0, 200));
    const out = JSON.parse(j.candidates[0].content.parts[0].text);
    return res.status(200).json({ reply: out.reply, ids: out.ids || [] });
  } catch (e) {
    return say(200, '⚠️ مرحله: ' + step + ' | ' + String(e.message).slice(0, 200));
  }
};
