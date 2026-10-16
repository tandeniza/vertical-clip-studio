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
  } : {
    title: 'Video alınıyor', connecting: 'Bilgisayara bağlanılıyor…', direct: 'Doğrudan bağlantı kuruluyor…', receiving: 'Alınıyor…',
    done: 'Video geldi', save: 'Videoyu kaydet', share: 'Paylaş / Galeriye kaydet', bad: 'Bu bağlantı geçersiz ya da eksik. QR kodu yeniden okut.',
    signal: 'Bağlantı servisine ulaşılamadı. İnternet bağlantını kontrol edip QR kodu yeniden okut.',
    ice: 'Doğrudan bağlantı kurulamadı (bazı mobil / kurumsal ağlar engelliyor). Wi-Fi\'ye geçmeyi dene ya da uygulamadaki "Aynı Wi-Fi" QR kodunu kullan.',
    busy: 'Bu videoyu şu an başka bir cihaz alıyor.', lost: 'Bağlantı koptu. QR kodu yeniden okut.', closedPc: 'Bilgisayar gönderimi durdurdu.',
    note: 'Video sunucuya yüklenmez: bilgisayarından doğrudan bu telefona, şifreli bağlantıyla gelir. Bu sayfayı aktarım bitene kadar açık tut.',
    iosHint: 'iPhone\'da: Paylaş\'a dokunup “Videoyu Kaydet”i seç.', mem: 'Video kaydedene kadar bu sayfada tutulur.',
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

  async function onOffer(m) {
    if (pc) return;
    clearInterval(helloTimer);
    setMsg(T.direct);
    pc = new RTCPeerConnection({ iceServers: [...P.DEFAULT_ICE, ...(cfg.ice || [])] });
    pc.onicecandidate = (e) => send({ t: 'ice', peer, from: 'phone', c: e.candidate ? e.candidate.toJSON() : null });
    pc.ondatachannel = (e) => { clearTimeout(iceTimer); receive(e.channel); };
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
