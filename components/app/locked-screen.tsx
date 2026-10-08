'use client';

import { Button } from '@heroui/react';
import { LogOut, MessageCircle } from 'lucide-react';
import { LottiePlayer } from '@/components/lottie/lottie-player';

/** Shown when a company admin or the platform administrator has locked this account. */
export function LockedScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none p-8 opacity-70 blur-md">
        <div className="h-16 rounded-2xl bg-surface" />
        <div className="mt-6 grid grid-cols-3 gap-4">{[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className="h-44 rounded-2xl bg-surface" />)}</div>
      </div>
      <section className="xm-card relative w-full max-w-md bg-surface/95 p-8 text-center shadow-xl backdrop-blur-xl">
        <LottiePlayer name="padlock" className="mx-auto w-36" />
        <h1 className="mt-2 text-2xl font-bold">Akun Anda sedang dikunci</h1>
        <p className="mt-3 text-base leading-relaxed text-muted">Akses akun ini dinonaktifkan sementara. Hubungi super admin company Anda untuk membukanya kembali.</p>
        <a className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-success px-4 text-base font-semibold text-success-foreground hover:bg-success-hover"
          href="https://wa.me/6282233744657" target="_blank" rel="noopener noreferrer"><MessageCircle className="size-5" aria-hidden="true" />Hubungi admin via WhatsApp</a>
        <Button variant="tertiary" size="lg" fullWidth className="mt-3" onPress={onLogout}><LogOut className="size-4" aria-hidden="true" />Keluar</Button>
      </section>
    </main>
  );
}
