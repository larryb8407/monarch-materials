// Chrome's Web Speech API. One recognizer at a time: starting a new one stops the old one.

const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const speechSupported = !!SR;

let active: any = null;

/** Starts continuous recognition. Chrome ends sessions after silence, so it restarts until stopped. */
export function startRec(onFinal: (text: string) => void, onInterim: (text: string) => void): boolean {
  if (!SR) return false;
  stopRec();
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  r.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) { if (t) onFinal(t); } else interim += t + ' ';
    }
    onInterim(interim.trim());
  };
  r.onend = () => { if (active === r) { try { r.start(); } catch { /* already running */ } } };
  r.onerror = () => {};
  active = r;
  try { r.start(); } catch { active = null; return false; }
  return true;
}

export function stopRec() {
  const r = active;
  active = null;
  if (r) { try { r.stop(); } catch { /* not running */ } }
}
