// Emits the list of built files so the service worker can cache the whole app for offline use.
const precache = () => ({
  name: 'precache-manifest',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.wasm') && !f.endsWith('.map'));
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
  },
});

export default { base: './', plugins: [precache()] };
