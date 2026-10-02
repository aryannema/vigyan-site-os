import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

/**
 * Web app manifest. background_color is the light ground from tokens.css;
 * theme_color is the deep surface, used for the browser chrome strip.
 *
 * The maskable icon is declared separately from the "any" icons: Android crops
 * maskable icons to its own shape, and only icon-maskable-512.png keeps the
 * mark inside the safe central 60%.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#020617',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
