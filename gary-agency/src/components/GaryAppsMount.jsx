import { createRoot } from 'react-dom/client';
import { GaryAppsMenu } from '../gary-apps/gary-apps';
import '../gary-apps/styles.css';
import './GaryAppsHeader.css';

export function mountGaryApps(element, { language, className = '', onFollow, onOpen } = {}) {
  if (!element) return { unmount() {} };
  const root = createRoot(element);
  root.render(
    <GaryAppsMenu
      language={language === 'vi' ? 'vi' : 'en'}
      currentApp="jobs"
      className={className}
      onFollow={onFollow}
      onOpen={onOpen}
    />,
  );
  return { unmount: () => root.unmount() };
}
