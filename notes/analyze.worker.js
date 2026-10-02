// Поиск высоты тона в фоне, чтобы страница не замирала на длинных записях.
importScripts('transcribe.js');

self.onmessage = (e) => {
  const { samples, sr } = e.data;
  try {
    let last = 0;
    const T = self.Transcribe;
    const x = sr > 16000 ? T.resample(samples, sr, 16000) : samples;
    const p = T.analyzePitch(x, Math.min(sr, 16000), (f) => {
      if (f - last >= 0.02 || f === 1) { last = f; self.postMessage({ progress: f }); }
    });
    self.postMessage({ pitch: p }, [p.f0.buffer, p.ap.buffer, p.db.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
