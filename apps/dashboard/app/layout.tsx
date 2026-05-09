import './globals.css';
import type { Metadata } from 'next';
import { AppNav } from '../components/AppNav';

export const metadata: Metadata = {
  title: 'RugSleuth',
  description: 'Autonomous onchain investigator. Pays for its own intel via x402.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-mono">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
