import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FlexCarousel from './FlexCarousel';
import photos from '../data/photos.json';
import './PhotoGallery.css';

const places = { hagiang: 'Hà Giang', hoian: 'Hội An', hanoi: 'Hà Nội' };
let lastAlbum = 'all';
const arrow = direction => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={direction === 'left' ? 'M19 12H5m6 6-6-6 6-6' : 'M5 12h14m-6-6 6 6-6 6'} /></svg>;

class GalleryBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function canRenderGlass() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

function PhotoGallery({ locale, onExploreRegion }) {
  const vi = locale === 'vi';
  const text = (en, vn) => vi ? vn : en;
  const outerRef = useRef(null);
  const stageRef = useRef(null);
  const [album, setAlbum] = useState(lastAlbum);
  const [active, setActive] = useState(0);
  const [renderer, setRenderer] = useState('waiting');
  const items = useMemo(() => photos.filter(photo => album === 'all' || photo.region === album).map(photo => ({
    src: photo.src,
    alt: photo.alt[locale],
    title: photo.title[locale],
    subtitle: `${places[photo.region]} · ${vi ? 'Việt Nam' : 'Vietnam'}`,
    width: photo.width,
    height: photo.height,
  })), [album, locale, vi]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setRenderer(canRenderGlass() ? 'glass' : 'photos');
        observer.disconnect();
      }
    }, { rootMargin: '300px' });
    if (outerRef.current) observer.observe(outerRef.current);
    return () => observer.disconnect();
  }, []);

  const changeAlbum = next => {
    lastAlbum = next;
    setAlbum(next);
    setActive(0);
  };

  const move = direction => {
    const canvasCarousel = stageRef.current?.querySelector('.flex-carousel');
    if (canvasCarousel) {
      // FlexCarousel exposes keyboard navigation; share it with the arrow buttons.
      canvasCarousel.dispatchEvent(new KeyboardEvent('keydown', {
        key: direction < 0 ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true,
      }));
      return;
    }
    const next = (active + direction + items.length) % items.length;
    setActive(next);
    stageRef.current?.querySelectorAll('.photo-gallery-fallback a')[next]?.scrollIntoView({
      block: 'nearest', inline: 'center', behavior: 'smooth',
    });
  };

  const fallback = <div className="photo-gallery-fallback" role="region" aria-roledescription="carousel" aria-label={text('Vietnam photo gallery', 'Thư viện ảnh Việt Nam')}>
    {items.map((item, index) => <a key={item.src} href={item.src} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} ${text('(open photo)', '(mở ảnh)')}`} onFocus={() => setActive(index)}>
      <img src={item.src} alt={item.alt} width={item.width} height={item.height} loading="lazy" />
      <span>{item.title}<small>{item.subtitle}</small></span>
    </a>)}
  </div>;

  return <div className="photo-gallery" ref={outerRef} data-photo-count={items.length} data-album={album}>
    <div className="photo-gallery-toolbar">
      <div className="photo-gallery-filters" role="group" aria-label={text('Choose a photo album', 'Chọn album ảnh')}>
        {['all', 'hagiang', 'hoian', 'hanoi'].map(key => {
          const count = key === 'all' ? photos.length : photos.filter(photo => photo.region === key).length;
          return <button key={key} className={`photo-gallery-filter ${album === key ? 'is-active' : ''}`} aria-pressed={album === key} aria-controls="vietnam-photo-stage" onClick={() => changeAlbum(key)}>
            {key === 'all' ? text('All photos', 'Tất cả ảnh') : places[key]}<span>{count}</span>
          </button>;
        })}
      </div>
      <span className="photo-gallery-total">{text(`${photos.length} moments. Three places. Your Vietnam.`, `${photos.length} khoảnh khắc. Ba điểm đến. Việt Nam của bạn.`)}</span>
    </div>

    <div id="vietnam-photo-stage" className="photo-gallery-stage" ref={stageRef}>
      {renderer === 'waiting' ? <div className="photo-gallery-loading" role="status">
        <div aria-hidden="true"><i /><i /><i /></div>
        <span>{text('Opening the photo diary…', 'Đang mở những trang ảnh…')}</span>
      </div> : renderer === 'glass' ? <GalleryBoundary key={`${album}-${locale}`} fallback={fallback}>
        <FlexCarousel
          items={items}
          preset="liquid"
          intro="rise"
          cardHeight={0.5}
          gap={12}
          squeeze={0.2}
          focusOnClick
          captions
          captureWheel={false}
          ariaLabel={text('Vietnam photos. Use arrow keys to browse, Enter to focus, and Escape to close.', 'Ảnh Việt Nam. Dùng phím mũi tên để xem, Enter để phóng ảnh, Escape để đóng.')}
          slideAnnouncement={(label, index, count) => text(`${label}, photo ${index} of ${count}`, `${label}, ảnh ${index} trên ${count}`)}
          onChange={setActive}
          className="gary-photo-carousel"
        />
      </GalleryBoundary> : fallback}
    </div>

    <div className="photo-gallery-footer">
      <p className="photo-gallery-hint">{text('Drag or swipe to explore. Click a photo to focus.', 'Kéo hoặc vuốt để khám phá. Bấm vào ảnh để phóng lớn.')}</p>
      <div className="photo-gallery-actions">
        {album !== 'all' && <button className="photo-gallery-explore" onClick={() => onExploreRegion?.(album)}>{text('Explore', 'Khám phá')} {places[album]}<span aria-hidden="true">↗</span></button>}
        <div className="photo-gallery-arrows" role="group" aria-label={text('Photo controls', 'Điều khiển ảnh')}>
          <button className="photo-gallery-arrow" aria-label={text('Previous photo', 'Ảnh trước')} onClick={() => move(-1)} disabled={renderer === 'waiting'}>{arrow('left')}</button>
          <button className="photo-gallery-arrow" aria-label={text('Next photo', 'Ảnh tiếp theo')} onClick={() => move(1)} disabled={renderer === 'waiting'}>{arrow('right')}</button>
        </div>
      </div>
    </div>
  </div>;
}

export function mountPhotoGallery(element, options) {
  const root = createRoot(element);
  root.render(<PhotoGallery {...options} />);
  return { unmount: () => root.unmount() };
}
