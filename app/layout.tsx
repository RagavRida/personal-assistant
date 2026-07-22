import type { Metadata } from 'next';
import '../src/index.css';

export const metadata: Metadata = {
  title: 'Personal Assistant',
  description: 'A personal assistant with Google Calendar and Google Tasks OAuth.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
