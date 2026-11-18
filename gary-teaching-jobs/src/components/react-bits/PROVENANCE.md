# React Bits GlassIcons

Source: https://reactbits.dev/r/GlassIcons-TS-CSS.json

Upstream: https://github.com/DavidHDev/react-bits/tree/e8e0277a4e80540b38eb9e975dbd4c2b413905e5/src/ts-default/Components/GlassIcons

Retrieved 2026-11-16. The source and CSS implement the actual layered rear plates, WebGL refraction, bevel, shine, parallax, intro and press behavior. No replacement icon-card implementation is used.

The local integration sets the public component's supported props. Local vendor changes only cap DPR at 1.5 (1 on small screens), retain accessibility fallback geometry if WebGL cannot initialize, and explicitly release its WebGL context on unmount add explicit noopener to new-tab links, and respond to reduced-motion changes without a reload. Shaders, geometry, materials and interaction settings are retained. Full upstream license is in LICENSE.md.

The responsive hero integration adds an optional independent `rowGap` (the existing default remains unchanged). It updates dimensions on the existing rendering engine rather than recreating its context. Optical fallback map caching is bounded to the 16 most recently used sizes, and unused fallback maps are not rebuilt while GPU tilt rendering is active. Context loss restores the same original CSS optical fallback. The original shaders, tilted plates, refraction, shine, parallax, intro and press geometry are unchanged.

The feedback island also adapts [React Bits Swipe Toast](https://reactbits.dev/micro/swipe-toast) and the [Counter](https://reactbits.dev/components/counter) maintained in Gary Home. The two source ports keep the downward swipe and pausable fuse, and the rolling digits with a static reduced-motion mode. They use the React Bits license included in this repository.
