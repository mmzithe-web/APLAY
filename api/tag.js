// Aplay auto-tagger: Gemini listens to a song and writes structured tags (key:value) into tracks.moods
const MAX_INLINE = 14 * 1024 * 1024;
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm' };
const ENUM = {
  vocals: ['with vocals', 'instrumental', 'rap', 'mixed'],
  region: ['eastern', 'western', 'fusion'],
  energy: ['calm', 'relaxed', 'medium', 'energetic', 'intense'],
  tempo: ['slow', 'medium', 'fast']
};
const TIMES = ['morning', 'noon', 'afternoon', 'evening', 'night', 'late night'];
const WEATHER = ['sunny', 'rainy', 'cloudy', 'snowy', 'stormy', 'foggy', 'hot', 'cold'];

const one = v => String(v || '').toLowerCase().trim().slice(0, 40);
const pick = (v, list) => {
  const s = String(v || '').toLowerCase().trim();
  if (list.indexOf(s) >= 0) return s;
  for (const x of list) { if (s && s.indexOf(x) >= 0) return x; }
  return '';
};
const arr = (v, max) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(x => String(x).toLowerCase().trim()).filter(x => x && x.length <= 40).slice(0, max || 6);

async function gem(key, parts) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key;
  let last = '';
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } })
    });
    if (r.ok) {
      const j = await r.json();
      const ps = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const txt = ps.map(p => p.text || '').join('');
      if (!txt.trim()) throw new Error('The AI returned no answer for this song');
      return txt;
    }
    last = r.status + ' ' + (await r.text()).slice(0, 160);
    if (r.status !== 503 && r.status !== 429 && r.status !== 500) break;
    await new Promise(z => setTimeout(z, 1500 * (i + 1)));
  }
  throw new Error('Gemini error ' + last);
}

module.exports = async (req, res) => {
  const out = (code, o) => res.status(code).json(o);
  if (req.method !== 'POST') return out(405, { ok: false, error: 'POST only' });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !GEMINI_API_KEY) return out(200, { ok: false, error: 'Missing keys in Vercel' });
  let base = SUPABASE_URL.trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return out(200, { ok: false, error: 'Not logged in' });
  const sb = { apikey: SUPABASE_ANON_KEY.trim(), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = Number(body && body.id);
  if (!id) return out(200, { ok: false, error: 'Missing song id' });
  try {
    const u = await fetch(base + '/auth/v1/user', { headers: sb });
    if (!u.ok) return out(200, { ok: false, error: 'Not logged in' });
    const user = await u.json();
    const a = await fetch(base + '/rest/v1/admins?select=user_id&user_id=eq.' + user.id, { headers: sb });
    const arows = a.ok ? await a.json() : [];
    if (!arows.length) return out(200, { ok: false, error: 'Admins only' });

    const t = await fetch(base + '/rest/v1/tracks?select=id,title,artist,file_path,moods&id=eq.' + id, { headers: sb });
    const trows = t.ok ? await t.json() : [];
    if (!trows.length) return out(200, { ok: false, error: 'Song not found' });
    const tr = trows[0];

    const ext = String(tr.file_path || '').split('.').pop().toLowerCase();
    const mime = MIME[ext] || 'audio/mpeg';
    let useAudio = false;
    let b64 = '';
    try {
      const headers = {};
      if (ext === 'mp3') headers.Range = 'bytes=0-' + (MAX_INLINE - 1);
      const ar = await fetch(base + '/storage/v1/object/public/music/' + encodeURI(tr.file_path), { headers: headers });
      if (ar.ok || ar.status === 206) {
        let buf = Buffer.from(await ar.arrayBuffer());
        if (buf.length > MAX_INLINE && ext === 'mp3') buf = buf.subarray(0, MAX_INLINE);
        if (buf.length > 0 && buf.length <= MAX_INLINE) { b64 = buf.toString('base64'); useAudio = true; }
      }
    } catch (e) { useAudio = false; }

    const prompt = `You are an expert music analyst tagging songs for a playlist app that matches songs to a listener's mood, place, time of day and weather.
` + (useAudio ? 'Listen carefully to the attached audio and describe only what you actually hear.' : 'The audio could not be loaded, so rely on the title and artist only, be conservative, and leave a value empty if you are unsure.') + `
Song title: ${tr.title || 'unknown'}. Artist: ${tr.artist || 'unknown'}. The title and artist can be wrong, so trust the audio.
Return ONLY a JSON object with exactly these keys:
vocals: one of with vocals, instrumental, rap, mixed
language: the language that is sung (for example persian, english, arabic, turkish, spanish, hindi, kurdish, korean, french), or none if there are no lyrics
region: one of eastern, western, fusion (eastern means a Persian, Middle Eastern, Arabic, Turkish, Indian or other Asian musical character; western means Western pop, rock, hip hop, electronic and similar)
origin: the musical tradition in one to three words (for example persian classical, persian pop, american hip hop, arabic pop, indian film, turkish pop, latin, european electronic)
genre: the main genre
subgenre: a more specific sub-genre
energy: one of calm, relaxed, medium, energetic, intense
tempo: one of slow, medium, fast
bpm: your estimate of the beats per minute as a number
moods: an array of 3 to 5 emotions (for example melancholic, romantic, euphoric, nostalgic, aggressive, hopeful, dark, peaceful)
times: an array of the best times of day to listen, chosen only from morning, noon, afternoon, evening, night, late night
places: an array of 2 to 5 best places or activities (for example car, road trip, gym, home, cafe, study, work, party, club, walking, beach, mountains, sleeping)
weather: an array chosen only from sunny, rainy, cloudy, snowy, stormy, foggy, hot, cold (empty if there is no clear fit)
vibe: an array of 2 to 4 short words about the atmosphere (for example dreamy, cinematic, warm, gritty, spacious, intimate)
All values must be lowercase English.`;

    const parts = [];
    if (useAudio) parts.push({ inline_data: { mime_type: mime, data: b64 } });
    parts.push({ text: prompt });
    const txt = await gem(GEMINI_API_KEY.trim(), parts);

    let o = {};
    try {
      o = JSON.parse(txt.split('```json').join('').split('```').join('').trim());
      if (Array.isArray(o)) o = o[0] || {};
    } catch (e) { throw new Error('The AI answer could not be read'); }

    const T = [];
    const add = (k, v) => { if (v) T.push(k + ':' + v); };
    const voc = pick(o.vocals, ENUM.vocals);
    add('vocals', voc);
    add('language', voc === 'instrumental' ? 'none' : one(o.language));
    add('region', pick(o.region, ENUM.region));
    add('origin', one(o.origin));
    add('genre', one(o.genre));
    add('subgenre', one(o.subgenre));
    add('energy', pick(o.energy, ENUM.energy));
    add('tempo', pick(o.tempo, ENUM.tempo));
    const bpm = Math.round(Number(o.bpm));
    if (bpm >= 40 && bpm <= 240) add('bpm', '~' + bpm);
    arr(o.moods, 5).forEach(x => add('mood', x));
    arr(o.times, 6).map(x => pick(x, TIMES)).filter(Boolean).forEach(x => add('time', x));
    arr(o.places, 5).forEach(x => add('place', x));
    arr(o.weather, 4).map(x => pick(x, WEATHER)).filter(Boolean).forEach(x => add('weather', x));
    arr(o.vibe, 4).forEach(x => add('vibe', x));
    if (T.length < 3) throw new Error('The AI did not return the song details');

    const seen = new Set();
    const keep = [];
    (tr.moods || []).filter(x => String(x).indexOf(':') < 0).concat(T).forEach(x => {
      const k = String(x).trim();
      if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); keep.push(k); }
    });
    const finalTags = keep.slice(0, 45);

    const p = await fetch(base + '/rest/v1/tracks?id=eq.' + id, {
      method: 'PATCH',
      headers: Object.assign({}, sb, { Prefer: 'return=representation' }),
      body: JSON.stringify({ moods: finalTags })
    });
    const prow = p.ok ? await p.json() : [];
    if (!prow.length) return out(200, { ok: false, error: 'Could not save the tags (admin permission)' });
    return out(200, { ok: true, tags: finalTags, heard: useAudio });
  } catch (e) {
    return out(200, { ok: false, error: (e && e.message) || 'Tagging failed' });
  }
};
