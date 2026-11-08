(() => {
  // Deliberately read no page text, URLs, inputs, history or playback controls.
  try {
    const session = navigator.mediaSession;
    const elements = document.querySelectorAll('audio,video');
    let audible = false;
    for (let index = 0; index < Math.min(elements.length, 64); index += 1) {
      const media = elements[index];
      if (!media.paused && !media.ended && !media.muted && media.volume > 0 && media.readyState >= 2) {
        audible = true;
        break;
      }
    }
    const playing = audible || session?.playbackState === 'playing';
    const metadata = playing ? session?.metadata : null;
    const text = (value) => typeof value === 'string' ? value.slice(0, 512) : '';
    return JSON.stringify({ playing, title: text(metadata?.title), artist: text(metadata?.artist) });
  } catch {
    return JSON.stringify({ playing: false, title: '', artist: '' });
  }
})()
