/** Remove only retired TTS models/API keys; personal state and backup attachments are separate. */
export function removeRetiredAudioCache(database) {
  if (database === undefined) {
    try { database = globalThis.indexedDB; } catch { return Promise.resolve(false); }
  }
  if (!database) return Promise.resolve(false);
  return new Promise(resolve => {
    try {
      const request = database.deleteDatabase('zhekandus-tts');
      request.onsuccess = () => resolve(true);
      request.onerror = event => { event.preventDefault(); resolve(false); };
      // An old version may still be open. Do not block learning; deletion
      // finishes once its connection closes, or is retried next launch.
      request.onblocked = () => resolve(false);
    } catch { resolve(false); }
  });
}
