import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, BriefcaseBusiness, Heart, MapPin, Plane, MessageCircle } from 'lucide-react';
import GlassIcons from './react-bits/GlassIcons';
import { measureGlassHeroLayout } from './glass-hero-layout';

const iconComponents = [BriefcaseBusiness, BookOpen, Heart, MapPin, Plane, MessageCircle];
export const glassHeroSettings = Object.freeze({ roundness: 0.6, refraction: 0.8, bevel: 0.6, dispersion: 0, frost: 0.2, shine: 0.85, tint: '#dfdfdf', tintOpacity: 0.2, plate: 'tilt', tilt: 30, spread: 0.5, parallax: 1, hover: 'press', labels: 'hover', intro: true });
export function glassHeroItems(locale = 'en', guidesTarget = '#questions') {
  const vi = locale === 'vi';
  const labels = vi ? ['Tìm việc', 'Cẩm nang giảng dạy', 'Sống ở Việt Nam', 'Địa điểm', 'Hỗ trợ visa', 'Liên hệ hỗ trợ'] : ['Find Jobs', 'Teaching Guides', 'Life in Vietnam', 'Locations', 'Visa Support', 'Contact Support'];
  const hrefs = ['#opportunities', guidesTarget, '#life', '#location', 'https://visa.garyhome.vn/', '#contact'];
  return ['blue', 'purple', 'red', 'indigo', 'orange', 'green'].map((color, index) => ({ id: color, color, label: labels[index], href: hrefs[index], ...(index === 4 ? { target: '_blank' } : {}), icon: React.createElement(iconComponents[index], { strokeWidth: 1.65, 'aria-hidden': true }) }));
}

function Hub({ container, locale, guidesTarget }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.jobsTheme === 'dark' ? 'dark' : 'light');
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    let frame = 0, alive = true;
    const measure = () => {
      frame = 0;
      if (!alive) return;
      const bounds = container.getBoundingClientRect();
      const width = Math.round(container.clientWidth || bounds.width);
      const height = Math.round(container.clientHeight || bounds.height);
      setBox(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const schedule = () => { if (!frame && alive) frame = window.requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(container);
    window.addEventListener('resize', schedule);
    measure();
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [container]);
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.jobsTheme === 'dark' ? 'dark' : 'light');
    document.addEventListener('gary-jobs:theme', update);
    return () => document.removeEventListener('gary-jobs:theme', update);
  }, []);
  const layout = measureGlassHeroLayout(box.width, box.height);
  const items = glassHeroItems(locale, guidesTarget);
  if (!layout) return <div className="jobs-hub-fallback">{items.map(item => <a key={item.id} href={item.href} target={item.target} rel={item.target === '_blank' ? 'noopener noreferrer' : undefined} aria-label={item.label}>{item.icon}<span>{item.label}</span></a>)}</div>;
  const { size, gap, rowGap, columns, padding, frameWidth, frameHeight, labelWidth, labelOffset } = layout;
  return <div className="jobs-glass-layout" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="jobs-glass-frame" data-glass-columns={columns} data-glass-size={size} data-glass-row-gap={rowGap} data-glass-footprint-height={frameHeight} style={{ width: frameWidth, height: frameHeight, boxSizing: 'border-box', padding: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`, '--jobs-glass-label-width': `${labelWidth}px`, '--jobs-glass-label-offset': `${labelOffset}px` }}>
      <GlassIcons {...glassHeroSettings} size={size} gap={gap} rowGap={rowGap} columns={columns} items={items} theme={theme} iconColor={theme === 'dark' ? '#ffffff' : '#102d58'} className="jobs-glass-hub" />
    </div>
  </div>;
}

export function mountGlassHero(container, { locale = 'en', guidesTarget = '#questions' } = {}) {
  if (!container) return { unmount() {} };
  const root = createRoot(container);
  let unmounted = false, current = { locale, guidesTarget };
  const render = () => root.render(<Hub container={container} {...current} />); render();
  return { update(next) { if (!unmounted) { current = { ...current, ...next }; render(); } }, unmount() { if (!unmounted) { unmounted = true; root.unmount(); } } };
}
