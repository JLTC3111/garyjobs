import { createRoot } from 'react-dom/client';
import { GaryAppsMenu } from '../gary-apps/gary-apps';
import { enhanceGaryApps } from '../gary-apps/brand-adapter';
import '../gary-apps/styles.css';
import './GaryAppsHeader.css';

export function mountGaryApps(element, { language, className = '', onFollow, onOpen } = {}) {
  if (!element) return { update() {}, unmount() {} };
  const container = document.createElement('div');
  container.style.display = 'contents';
  element.append(container);
  const root = createRoot(container);
  let props = { kind: 'menu', language: language === 'vi' ? 'vi' : 'en', currentApp: 'jobs', className, onFollow, onOpen };
  const branding = enhanceGaryApps(element, () => props.language);
  const render = () => root.render(<GaryAppsMenu {...props} />);
  render();
  return {
    update(nextProps) {
      props = { ...props, ...nextProps };
      render();
      branding.refresh();
    },
    unmount() {
      branding.disconnect();
      root.unmount();
      container.remove();
    },
  };
}
