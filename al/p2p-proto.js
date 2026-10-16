// P2P video aktarımı (WebRTC DataChannel) — masaüstü uygulaması ve telefon sayfası (web/al) ORTAK protokolü.
// Bu dosyanın aynısı web/al/p2p-proto.js olarak telefon sayfasında da kullanılır (tests/p2p-proto.test.js aynılığı denetler).
//
// Sinyalleşme: Supabase Realtime "broadcast" kanalı `tda-p2p-<oturum>`. Sunucudan yalnızca bağlantı kurma mesajları geçer
// (SDP teklif / yanıt ve ICE adayları); video baytları sunucuya hiç gitmez, iki cihaz arasında doğrudan (DTLS ile şifreli)
// akar. Oturum kimliği 128 bit rastgeledir ve yalnızca QR koddaki adresin # kısmında durur (# sonrası sunucuya gönderilmez).
//
// Mesajlar (broadcast olayı 'sig'):  telefon -> { t:'hello', peer }   masaüstü -> { t:'offer', peer, sdp }
//   telefon -> { t:'answer', peer, sdp }   iki yön -> { t:'ice', peer, from, c }   masaüstü -> { t:'busy', peer }
// Veri kanalı ('file', sıralı): metin { t:'meta', name, size, mime } -> ikili parçalar -> metin { t:'end' }; telefon { t:'got' }
// Telefondan bilgisayara (m=up): telefon her dosya için { t:'meta', idx, name, size, mime } -> bilgisayar { t:'ready', idx } ya da
//   { t:'reject', idx, code } -> telefon ikili parçalar + { t:'end', idx } -> bilgisayar { t:'saved', idx } / { t:'fail', idx, code };
//   en sonda telefon { t:'done' }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.P2PProto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VERSION = 1;
  const CHUNK = 64 * 1024;            // veri kanalı mesajı (tüm tarayıcılarda güvenli boyut)
  const HIGH_WATER = 4 * 1024 * 1024; // gönderim tamponu bu kadar dolunca beklenir
  const LOW_WATER = 1024 * 1024;
  const EVENT = 'sig';
  const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const SID_RE = /^[A-Za-z0-9_-]{22,64}$/;
  const PEER_RE = /^[A-Za-z0-9_-]{8,64}$/;
  const topic = (sid) => `tda-p2p-${sid}`;

  /** QR adresi: sayfa + #s=oturum&u=supabase&k=yayınlanabilir anahtar (+ isteğe bağlı TURN listesi) */
  function buildUrl(page, { sid, supabaseUrl, key, ice, mode }) {
    const q = new URLSearchParams();
    q.set('v', String(VERSION));
    if (mode === 'up') q.set('m', 'up'); // telefondan bilgisayara gönderme
    q.set('s', sid);
    const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/i.exec(String(supabaseUrl || ''));
    q.set('u', m ? m[1] : String(supabaseUrl || '')); // standart adres yalnızca proje kimliğiyle (kısa QR)
    q.set('k', key);
    if (Array.isArray(ice) && ice.length) q.set('i', JSON.stringify(ice));
    return `${String(page).replace(/#.*$/, '')}#${q.toString()}`;
  }
  /** Telefon sayfası: adresin # kısmını çözer. Geçersizse null */
  function parseFragment(hash) {
    const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const sid = q.get('s') || '';
    const u = q.get('u') || '';
    const key = q.get('k') || '';
    if (!SID_RE.test(sid) || !key || key.length > 600) return null;
    let supabaseUrl;
    if (/^[a-z0-9]{20}$/i.test(u)) supabaseUrl = `https://${u.toLowerCase()}.supabase.co`;
    else if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) supabaseUrl = u.replace(/\/+$/, '');
    else return null;
    let ice = null;
    try { const x = JSON.parse(q.get('i') || 'null'); if (Array.isArray(x)) ice = sanitizeIce(x); } catch (_) { ice = null; }
    return { v: Number(q.get('v')) || 1, sid, supabaseUrl, key, ice, mode: q.get('m') === 'up' ? 'up' : 'down' };
  }
  /** ICE sunucu listesini doğrular (yalnızca stun: / turn: / turns: adresleri) */
  function sanitizeIce(list) {
    const out = [];
    for (const s of Array.isArray(list) ? list.slice(0, 8) : []) {
      if (!s || typeof s !== 'object') continue;
      const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && /^(stun|turns?):[^\s]{3,200}$/i.test(u)).slice(0, 6);
      if (!urls.length) continue;
      const e = { urls };
      if (typeof s.username === 'string' && s.username.length <= 200) e.username = s.username;
      if (typeof s.credential === 'string' && s.credential.length <= 200) e.credential = s.credential;
      out.push(e);
    }
    return out;
  }
  /** Gelen sinyal mesajını doğrular (bilinmeyen / bozuk mesaj -> null) */
  function checkSignal(m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string' || !PEER_RE.test(String(m.peer || ''))) return null;
    if (m.t === 'hello' || m.t === 'busy') return m;
    if ((m.t === 'offer' || m.t === 'answer') && typeof m.sdp === 'string' && m.sdp.length < 200000) {
      if (m.t === 'offer' && m.ice != null) m.ice = sanitizeIce(m.ice); // TURN aktarıcısı (teklifle gelir; QR'a girmez)
      return m;
    }
    if (m.t === 'ice' && (m.from === 'pc' || m.from === 'phone') && (m.c === null || (typeof m.c === 'object' && typeof m.c.candidate === 'string' && m.c.candidate.length < 2000))) return m;
    return null;
  }
  /** Rastgele kimlik (base64url) */
  function randomId(bytes = 16) {
    const a = new Uint8Array(bytes);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(a);
    let s = '';
    for (const b of a) s += String.fromCharCode(b);
    const b64 = typeof btoa === 'function' ? btoa(s) : Buffer.from(a).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const safeName = (n) => String(n || 'video.mp4').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'video.mp4';
  const mimeOf = (n) => (/\.mov$/i.test(n) ? 'video/quicktime' : /\.webm$/i.test(n) ? 'video/webm' : /\.mkv$/i.test(n) ? 'video/x-matroska' : 'video/mp4');
  return { VERSION, CHUNK, HIGH_WATER, LOW_WATER, EVENT, DEFAULT_ICE, SID_RE, PEER_RE, topic, buildUrl, parseFragment, sanitizeIce, checkSignal, randomId, safeName, mimeOf };
});
