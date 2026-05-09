'use client';
import { useState } from 'react';

export function AddressInput({ onSubmit, onDemo, disabled }: {
  onSubmit: (address: string) => void;
  onDemo: () => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('0xc1fcc4300305a415a7ea894f71a0694e9f7831d3');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(value);

  return (
    <section className="border border-zinc-800 bg-zinc-950">
      <form
        className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(value.toLowerCase());
        }}
      >
        <label className="min-w-0">
          <span className="mb-2 block text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Base contract
          </span>
          <input
            className="h-11 w-full border border-zinc-700 bg-black px-3 font-mono text-sm text-zinc-100 outline-none transition focus:border-emerald-400"
            placeholder="0x... Base contract or wallet"
            value={value}
            onChange={(e) => setValue(e.target.value.trim())}
            disabled={disabled}
          />
        </label>
        <button
          className="h-11 self-end border border-emerald-400 bg-emerald-400 px-5 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
          disabled={disabled}
          type="button"
          onClick={onDemo}
        >
          Run demo
        </button>
        <button
          className="h-11 self-end border border-zinc-700 px-5 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:text-zinc-600"
          disabled={!valid || disabled}
          type="submit"
        >
          Live run
        </button>
      </form>
    </section>
  );
}
