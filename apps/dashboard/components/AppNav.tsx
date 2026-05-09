'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/runs', label: 'Runs' },
  { href: '/about', label: 'About' },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-zinc-800 bg-black">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="text-sm font-semibold tracking-normal text-zinc-100">
          RugSleuth
        </Link>
        <div className="flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`border px-3 py-2 text-xs uppercase tracking-[0.14em] transition ${
                  active
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
