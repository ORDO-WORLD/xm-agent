import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Property Auto Audit · Property Matchmaker',
  description: 'Audit percakapan WhatsApp dan pencocokan otomatis buyer dengan listing property.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a3be0',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className="antialiased">{children}</body>
    </html>
  );
}
