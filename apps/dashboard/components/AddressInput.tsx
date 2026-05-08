'use client';
import { useState } from 'react';

export function AddressInput({ onSubmit, disabled }: {
  onSubmit: (address: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const valid = /^0x[a-fA-F0-9]{40}$/.test(value);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // Guard against held-Enter / rapid resubmits: form's onSubmit fires
        // independently of the button's disabled state.
        if (!valid || disabled) return;
        onSubmit(value.toLowerCase());
      }}
    >
      <input
        className="flex-1 bg-black border border-zinc-700 px-3 py-2 rounded font-mono text-sm"
        placeholder="0x… (Base contract or wallet)"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        disabled={disabled}
      />
      <button
        className="px-4 py-2 rounded bg-emerald-500 text-black font-semibold disabled:opacity-30"
        disabled={!valid || disabled}
        type="submit"
      >
        Investigate
      </button>
    </form>
  );
}
