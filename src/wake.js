// Keep the screen on during dictation / rehearsal.
export async function keepAwake() {
  let lock = null;
  try {
    lock = await navigator.wakeLock?.request('screen');
  } catch {
    /* unsupported or denied */
  }
  return () => lock?.release().catch(() => {});
}
