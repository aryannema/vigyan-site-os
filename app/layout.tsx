import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'vigyan-site-os',
  description: 'Generic Next.js + Postgres site/CMS foundation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
