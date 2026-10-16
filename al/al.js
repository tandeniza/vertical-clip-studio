// TDA Studio — telefonda videoyu al (WebRTC DataChannel). Sunucu (Supabase Realtime) yalnızca bağlantı kurma mesajlarını
// taşır; video baytları bilgisayardan doğrudan bu sayfaya gelir. Oturum bilgisi adresin # kısmındadır (sunucuya gitmez).
(function () {
  const P = window.P2PProto;
  const $ = (id) => document.getElementById(id);
  const en = !/^tr\b/i.test(navigator.language || 'tr');
  const T = en ? {
    title: 'Receiving video', connecting: 'Connecting to your computer…', direct: 'Opening a direct connection…', receiving: 'Receiving…',
    done: 'Video received', save: 'Save video', share: 'Share / Save to gallery', bad: 'This link is invalid or incomplete. Scan the QR code again.',
    signal: 'Could not reach the connection service. Check your internet connection and scan again.',
    ice: 'A direct connection could not be made (some mobile/corporate networks block it). Try Wi-Fi, or use the "Same Wi-Fi" QR in the app.',
    busy: 'Another device is already receiving this video.', lost: 'Connection lost. Scan the QR code again.', closedPc: 'The computer stopped sending.',
    note: 'The video is not uploaded to any server: it comes straight from your computer over an encrypted connection. Keep this page open until it finishes.',
    iosHint: 'On iPhone: tap Share and choose “Save Video”.', mem: 'The video is kept in this page until you save it.',
    upTitle: 'Send to computer', upConnected: 'Connected. Choose videos, photos or audio to send.', pick: 'Choose files', more: 'Send more files',
    upNote: 'Files are not uploaded to any server: they go straight from this phone to your computer over an encrypted connection. Keep this page open until they finish.',
    waitPc: 'Waiting…', sending: 'Sending', saved: 'Added ✓', rejType: 'Unsupported file type', rejBig: 'File too large', rejOther: 'Could not be saved',
    allDone: 'All files were added to TDA Studio.', closedUp: 'Connection to the computer was lost.',
  } : {
    title: 'Video alınıyor', connecting: 'Bilgisayara bağlanılıyor…', direct: 'Doğrudan bağlantı kuruluyor…', receiving: 'Alınıyor…',
    done: 'Video geldi', save: 'Videoyu kaydet', share: 'Paylaş / Galeriye kaydet', bad: 'Bu bağlantı geçersiz ya da eksik. QR kodu yeniden okut.',
    signal: 'Bağlantı servisine ulaşılamadı. İnternet bağlantını kontrol edip QR kodu yeniden okut.',
    ice: 'Doğrudan bağlantı kurulamadı (bazı mobil / kurumsal ağlar engelliyor). Wi-Fi\'ye geçmeyi dene ya da uygulamadaki "Aynı Wi-Fi" QR kodunu kullan.',
    busy: 'Bu videoyu şu an başka bir cihaz alıyor.', lost: 'Bağlantı koptu. QR kodu yeniden okut.', closedPc: 'Bilgisayar gönderimi durdurdu.',
    note: 'Video sunucuya yüklenmez: bilgisayarından doğrudan bu telefona, şifreli bağlantıyla gelir. Bu sayfayı aktarım bitene kadar açık tut.',
    iosHint: 'iPhone\'da: Paylaş\'a dokunup “Videoyu Kaydet”i seç.', mem: 'Video kaydedene kadar bu sayfada tutulur.',
    upTitle: 'Bilgisayara gönder', upConnected: 'Bağlandı. Göndermek istediğin video, fotoğraf ya da sesleri seç.', pick: 'Dosya seç', more: 'Başka dosya gönder',
    upNote: 'Dosyalar sunucuya yüklenmez: bu telefondan doğrudan bilgisayarına, şifreli bağlantıyla gider. Gönderim bitene kadar bu sayfayı açık tut.',
    waitPc: 'Bekliyor…', sending: 'Gönderiliyor', saved: 'Eklendi ✓', rejType: 'Desteklenmeyen dosya türü', rejBig: 'Dosya çok büyük', rejOther: 'Kaydedilemedi',
    allDone: 'Tüm dosyalar TDA Studio\'ya eklendi.', closedUp: 'Bilgisayarla bağlantı koptu.',
  };
  if (en) document.documentElement.lang = 'en';
  $('title').textContent = T.title; $('note').textContent = T.note; $('save').textContent = T.save; $('share').textContent = T.share;
  const setMsg = (s, err) => { $('msg').textContent = s; $('msg').className = err ? 'msg err' : 'msg'; };
  const mb = (n) => (n / 1048576).toFixed(n >= 104857600 ? 0 : 1);
  setMsg(T.connecting);

  const cfg = P.parseFragment(location.hash);
  // Adres geçmişten / ekran görüntüsünden yeniden kullanılmasın: # kısmı adres çubuğundan silinir
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* yok */ }
  if (!cfg) { setMsg(T.bad, true); return; }
  const UP = cfg.mode === 'up';
  if (UP) { $('title').textContent = T.upTitle; $('note').textContent = T.upNote; $('pick-text').textContent = T.pick; $('more').textContent = T.more; }

  const peer = P.randomId(12);
  let client = null;
  let channel = null;
  let pc = null;
  let finished = false;
  let failed = false;
  let helloTimer = null;
  let iceTimer = null;
  const pending = [];
  const send = (m) => channel && channel.send({ type: 'broadcast', event: P.EVENT, payload: m });
  const fail = (s) => {
    if (finished || failed) return;
    failed = true;
    clearInterval(helloTimer); clearTimeout(iceTimer);
    setMsg(s, true);
    try { if (pc) pc.close(); } catch (_) { /* yok */ }
    try { if (client) client.realtime.disconnect(); } catch (_) { /* yok */ }
  };

  function receive(dc) {
    dc.binaryType = 'arraybuffer';
    let meta = null;
    let got = 0;
    const parts = [];
    const t0 = performance.now();
    let last = 0;
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        let m = null;
        try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m && m.t === 'meta') {
          meta = { name: P.safeName(m.name), size: Math.max(0, Number(m.size) || 0), mime: /^video\/[a-z0-9.+-]+$/i.test(m.mime) ? m.mime : 'video/mp4' };
          setMsg(T.receiving); $('bar').hidden = false;
          $('detail').textContent = `${meta.name} · ${mb(meta.size)} MB`;
        } else if (m && m.t === 'end' && meta) {
          finished = true;
          const blob = new Blob(parts, { type: meta.mime });
          parts.length = 0;
          try { dc.send(JSON.stringify({ t: 'got' })); } catch (_) { /* yok */ }
          done(blob, meta);
        }
        return;
      }
      if (!meta) return;
      parts.push(e.data);
      got += e.data.byteLength;
      const now = performance.now();
      if (now - last > 150) {
        last = now;
        const pct = meta.size ? Math.min(100, (got / meta.size) * 100) : 0;
        $('fill').style.width = `${pct.toFixed(1)}%`;
        const speed = got / Math.max(0.001, (now - t0) / 1000);
        $('detail').textContent = `${meta.name} · ${mb(got)} / ${mb(meta.size)} MB · ${mb(speed)} MB/sn`;
      }
    };
    dc.onclose = () => { if (!finished) fail(T.closedPc); };
  }

  function done(blob, meta) {
    clearTimeout(iceTimer);
    $('fill').style.width = '100%';
    $('title').textContent = T.done;
    setMsg(`${meta.name} · ${mb(blob.size)} MB`);
    $('detail').textContent = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? T.iosHint : T.mem;
    const url = URL.createObjectURL(blob);
    const v = $('vid'); v.src = url; v.hidden = false;
    const a = $('save'); a.href = url; a.download = meta.name;
    $('actions').hidden = false;
    try {
      const file = new File([blob], meta.name, { type: meta.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const b = $('share'); b.hidden = false;
        b.addEventListener('click', () => { navigator.share({ files: [file] }).catch(() => {}); });
      }
    } catch (_) { /* paylaşım yok */ }
    setTimeout(() => { try { pc.close(); client.realtime.disconnect(); } catch (_) { /* yok */ } }, 1500);
  }

  // ---------- Telefondan bilgisayara: seçilen dosyalar sırayla, parça parça (dosya belleğe tümüyle alınmaz) ----------
  function sendFiles(dc) {
    dc.binaryType = 'arraybuffer';
    const waiters = new Map(); // `${t}:${idx}` -> resolve
    const waitFor = (idx) => new Promise((res) => { waiters.set(idx, res); });
    let nextIdx = 0;
    let busy = false;
    const queue = [];
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m = null;
      try { m = JSON.parse(e.data); } catch (_) { return; }
      if (!m || !Number.isInteger(m.idx)) return;
      const w = waiters.get(m.idx);
      if (w) { waiters.delete(m.idx); w(m); }
    };
    dc.onclose = () => { if (!finished) fail(T.closedUp); for (const w of waiters.values()) w({ t: 'closed' }); waiters.clear(); };
    dc.onopen = () => { setMsg(T.upConnected); $('up').hidden = false; };
    if (dc.readyState === 'open') dc.onopen();
    dc.bufferedAmountLowThreshold = P.LOW_WATER;
    const drain = () => new Promise((res) => { if (dc.bufferedAmount <= P.HIGH_WATER) return res(); const on = () => { dc.removeEventListener('bufferedamountlow', on); res(); }; dc.addEventListener('bufferedamountlow', on); });
    function row(file) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="nm"><span></span><span class="st"></span></div><div class="bar"><div></div></div>';
      li.querySelector('.nm span').textContent = file.name;
      li.querySelector('.st').textContent = T.waitPc;
      $('files').appendChild(li);
      return { st: li.querySelector('.st'), fill: li.querySelector('.bar > div') };
    }
    async function sendOne(file, ui, count) {
      const idx = nextIdx++;
      const p = waitFor(idx);
      dc.send(JSON.stringify({ t: 'meta', idx, count, name: P.safeName(file.name), size: file.size, mime: file.type || '' }));
      const r = await p;
      if (r.t !== 'ready') {
        ui.st.textContent = r.code === 'P2P_BAD_TYPE' ? T.rejType : r.code === 'P2P_TOO_BIG' ? T.rejBig : T.rejOther;
        ui.st.className = 'st err';
        return false;
      }
      ui.st.textContent = `${T.sending} 0%`;
      const t0 = performance.now();
      let last = 0;
      for (let off = 0; off < file.size;) {
        const end = Math.min(file.size, off + 1024 * 1024);
        const buf = await file.slice(off, end).arrayBuffer();
        for (let i = 0; i < buf.byteLength; i += P.CHUNK) {
          await drain();
          if (dc.readyState !== 'open') return false;
          dc.send(buf.slice(i, Math.min(buf.byteLength, i + P.CHUNK)));
        }
        off = end;
        const now = performance.now();
        if (now - last > 150 || off >= file.size) {
          last = now;
          const pct = (off / file.size) * 100;
          ui.fill.style.width = `${pct.toFixed(1)}%`;
          ui.st.textContent = `${Math.floor(pct)}% · ${mb(off / Math.max(0.001, (now - t0) / 1000))} MB/sn`;
        }
      }
      const done = waitFor(idx);
      dc.send(JSON.stringify({ t: 'end', idx }));
      const r2 = await done;
      const ok = r2.t === 'saved';
      ui.st.textContent = ok ? T.saved : T.rejOther;
      ui.st.className = ok ? 'st ok' : 'st err';
      ui.fill.style.width = ok ? '100%' : ui.fill.style.width;
      return ok;
    }
    async function run() {
      if (busy) return;
      busy = true;
      $('pick-label').hidden = true; $('more').hidden = true;
      while (queue.length) {
        const { file, ui, count } = queue.shift();
        try { await sendOne(file, ui, count); } catch (_) { ui.st.textContent = T.rejOther; ui.st.className = 'st err'; }
        if (dc.readyState !== 'open') break;
      }
      busy = false;
      if (dc.readyState === 'open') {
        try { dc.send(JSON.stringify({ t: 'done', idx: -1 })); } catch (_) { /* yok */ }
        setMsg(T.allDone);
        $('more').hidden = false;
      }
    }
    $('pick').addEventListener('change', () => {
      const files = [...$('pick').files];
      $('pick').value = '';
      for (const f of files) queue.push({ file: f, ui: row(f), count: files.length });
      if (files.length) run();
    });
    $('more').addEventListener('click', () => $('pick').click());
  }

  async function onOffer(m) {
    if (pc) return;
    clearInterval(helloTimer);
    setMsg(T.direct);
    pc = new RTCPeerConnection({ iceServers: [...P.DEFAULT_ICE, ...(cfg.ice || []), ...(Array.isArray(m.ice) ? m.ice : [])] });
    pc.onicecandidate = (e) => send({ t: 'ice', peer, from: 'phone', c: e.candidate ? e.candidate.toJSON() : null });
    pc.ondatachannel = (e) => { clearTimeout(iceTimer); if (UP) sendFiles(e.channel); else receive(e.channel); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') fail(T.ice); else if (pc.connectionState === 'disconnected' && !finished) setTimeout(() => { if (pc && pc.connectionState !== 'connected' && !finished) fail(T.lost); }, 8000); };
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    for (const c of pending.splice(0)) pc.addIceCandidate(c).catch(() => {});
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    send({ t: 'answer', peer, sdp: pc.localDescription.sdp });
    iceTimer = setTimeout(() => { if (!finished) fail(T.ice); }, 30000); // veri kanalı açılınca iptal edilir
  }

  (async () => {
    try {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      channel = client.channel(P.topic(cfg.sid), { config: { broadcast: { self: false, ack: false } } });
      channel.on('broadcast', { event: P.EVENT }, ({ payload }) => {
        const m = P.checkSignal(payload);
        if (!m || m.peer !== peer || failed) return;
        if (m.t === 'offer') onOffer(m).catch(() => fail(T.ice));
        else if (m.t === 'busy') fail(T.busy);
        else if (m.t === 'ice' && m.from === 'pc') { if (pc && pc.remoteDescription) pc.addIceCandidate(m.c || null).catch(() => {}); else pending.push(m.c || null); }
      });
      const to = setTimeout(() => fail(T.signal), 20000);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(to);
          send({ t: 'hello', peer });
          // Bilgisayar mesajı kaçırırsa birkaç kez yinelenir (teklif gelince durur)
          let n = 0;
          helloTimer = setInterval(() => { if (pc || ++n > 8) { clearInterval(helloTimer); if (!pc && n > 8) fail(T.signal); return; } send({ t: 'hello', peer }); }, 2500);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(to); fail(T.signal); }
      });
    } catch (_) { fail(T.signal); }
  })();
})();
