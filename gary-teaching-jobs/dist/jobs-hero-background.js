const pearlChrome = {color: '#f4f6fb', metalColor: '#b9c8e2', spectrum: 'full', lightMode: true};
const chrome = {};

export function createHoloBackground(load = () => import('./jobs-holo-mosaic.js')) {
  let host = null, effect, theme, generation = 0;
  const props = () => theme === 'light' ? pearlChrome : chrome;

  return (target, resolvedTheme) => {
    if (target === host) {
      if (resolvedTheme !== theme) {
        theme = resolvedTheme;
        effect?.update(props());
      }
      return;
    }

    const request = ++generation;
    effect?.destroy();
    effect = undefined;
    host = target;
    theme = resolvedTheme;
    if (!host) return;

    // A preference or navigation change can arrive while the renderer loads.
    void load().then(({mountHoloMosaic}) => {
      if (request === generation && target.isConnected) effect = mountHoloMosaic(target, props());
    }).catch(() => { /* The existing hero surface is the fallback. */ });
  };
}
