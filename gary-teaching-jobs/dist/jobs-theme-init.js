/* Before styles on public, candidate and staff pages; one preference, no hydration phase. */
(() => {
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  const read = () => { try { return valid(localStorage.getItem('gary-jobs-theme')); } catch { return 'system'; } };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = read();
  function apply() {
    const resolved = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.documentElement.dataset.jobsTheme = resolved;
    document.documentElement.dataset.jobsThemePreference = preference;
    document.documentElement.style.colorScheme = resolved;
    window.garyJobsTheme = { preference, resolved };
    document.dispatchEvent(new CustomEvent('gary-jobs:theme', { detail: window.garyJobsTheme }));
  }
  window.setGaryJobsTheme = value => { preference = valid(value); try { localStorage.setItem('gary-jobs-theme', preference); } catch {} apply(); };
  media.addEventListener('change', apply);
  addEventListener('storage', event => { if (event.key === 'gary-jobs-theme') { preference = read(); apply(); } });
  apply();
})();
