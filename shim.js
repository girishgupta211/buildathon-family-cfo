/* Runs only outside Claude. Supplies the two things the app expects from window.claude:
   'dictation' (record, send to /api/stt, get text) and 'sample' (/api/parse). */
(function () {
  if (window.claude && window.claude.use) return;
  var MAXMS = 28000; // stop automatically; short clips keep Sarvam's REST endpoint happy
  var canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder && (window.AudioContext || window.webkitAudioContext));

  function post(url, body, headers) {
    return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || 'failed'); e.status = r.status; throw e; } return d; });
    });
  }
  function sample(prompt) {
    return post('/api/parse', JSON.stringify({ prompt: prompt }), { 'content-type': 'application/json' });
  }
  sample.json = function (prompt) {
    return post('/api/parse', JSON.stringify({ prompt: prompt, json: true }), { 'content-type': 'application/json' }).then(function (d) {
      var t = String(d.text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(t);
    });
  };

  function toWav(blob) {
    return blob.arrayBuffer().then(function (ab) {
      var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
      return new Promise(function (ok, no) { ctx.decodeAudioData(ab, ok, no); }).then(function (buf) {
        try { ctx.close(); } catch (e) {}
        var n = Math.max(1, Math.ceil(buf.duration * 16000));
        var off = new OfflineAudioContext(1, n, 16000), src = off.createBufferSource();
        src.buffer = buf; src.connect(off.destination); src.start();
        return off.startRendering();
      }).then(function (out) {
        var f = out.getChannelData(0), len = f.length, v = new DataView(new ArrayBuffer(44 + len * 2));
        function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
        s(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, len * 2, true);
        for (var i = 0; i < len; i++) { var x = Math.max(-1, Math.min(1, f[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
        return new Blob([v], { type: 'audio/wav' });
      });
    });
  }

  var fin = [], st = [], rec = null, chunks = [], stream = null, timer = null, busy = false, t0 = 0;
  function emit(a, e) { a.slice().forEach(function (f) { try { f(e); } catch (x) {} }); }
  function note(t) { var el = document.getElementById('vp') || document.getElementById('vh'); if (el) el.textContent = t; }
  function release() { clearTimeout(timer); if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } }

  var dictation = {
    active: function () { return !!rec || busy; },
    onPartial: function () { return function () {}; },
    onFinal: function (f) { fin.push(f); return function () { fin = fin.filter(function (x) { return x !== f; }); }; },
    onState: function (f) { st.push(f); return function () { st = st.filter(function (x) { return x !== f; }); }; },
    start: function () {
      if (rec || busy) return Promise.resolve();
      emit(st, { state: 'starting' });
      return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (s) {
        stream = s; chunks = []; rec = new MediaRecorder(s); t0 = Date.now();
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          var type = rec && rec.mimeType, took = Date.now() - t0; rec = null; release();
          if (took < 500 || !chunks.length) { note('That was too short. Tap the mic and try again.'); emit(st, { state: 'idle', reason: 'stopped' }); return; }
          busy = true; note('Transcribing…'); emit(st, { state: 'processing' });
          toWav(new Blob(chunks, { type: type || 'audio/webm' })).then(function (wav) {
            return post('/api/stt', wav, { 'content-type': 'audio/wav' });
          }).then(function (d) {
            if (d.text && d.text.trim()) { emit(fin, { text: ' ' + d.text.trim() }); note(''); }
            else note('I could not hear that clearly. Please try again or type.');
          }).catch(function (e) {
            note(e && e.status === 429 ? 'Too many requests. Try again in a moment.' : 'Could not transcribe that. You can type instead.');
          }).then(function () { busy = false; emit(st, { state: 'idle', reason: 'stopped' }); });
        };
        rec.start(); emit(st, { state: 'listening' });
        timer = setTimeout(function () { dictation.stop(); }, MAXMS);
      }).catch(function (e) {
        release(); rec = null; emit(st, { state: 'idle', reason: 'error' });
        var err = new Error('mic'); err.code = (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) ? 'not_granted' : 'unavailable'; throw err;
      });
    },
    stop: function () { clearTimeout(timer); if (rec && rec.state !== 'inactive') rec.stop(); return Promise.resolve(); }
  };

  window.claude = { use: function (k) { return Promise.resolve(k === 'sample' ? sample : k === 'dictation' ? (canRec ? dictation : null) : null); } };
})();
