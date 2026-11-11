import { buildGallery } from './gallery-build.mjs';
const builder = await buildGallery({ watch: true });
await import('../server.mjs');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => builder.dispose());
