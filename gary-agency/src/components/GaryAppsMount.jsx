import { createRoot } from 'react-dom/client';
import { GaryAppsMenu } from '../gary-apps/gary-apps';
import { connectGaryApps } from '../gary-apps/client';
import '../gary-apps/styles.css';
import './GaryAppsHeader.css';

export function mountGaryApps(element, { language, className = '', onFollow, onOpen } = {}) {
  if (!element) return { update() {}, unmount() {} };
  const fallback = document.createElement('div');
  fallback.style.display = 'contents';
  const remote = document.createElement('div');
  remote.style.display = 'none';
  remote.dataset.garyAppsRemote = '';
  element.append(fallback, remote);
  let fallbackRoot = createRoot(fallback);
  let props = { kind: 'menu', language: language === 'vi' ? 'vi' : 'en', currentApp: 'jobs', className, onFollow, onOpen };
  const renderFallback = () => fallbackRoot?.render(<GaryAppsMenu {...props} />);
  renderFallback();
  const connection = connectGaryApps(remote, props, {
    isBusy: () => Boolean(fallback.querySelector('details[open]') || fallback.contains(document.activeElement)),
    onReady() {
      remote.style.display = 'contents';
      fallbackRoot?.unmount();
      fallbackRoot = null;
      fallback.remove();
    },
  });
  return {
    update(nextProps) {
      props = { ...props, ...nextProps };
      renderFallback();
      connection.update(nextProps);
    },
    unmount() {
      connection.unmount();
      fallbackRoot?.unmount();
      fallbackRoot = null;
      fallback.remove();
      remote.remove();
    },
  };
}
