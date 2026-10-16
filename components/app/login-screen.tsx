'use client';
import type { User } from '@/lib/types';

/** Authentication belongs to AutoAudit, including configuration failures. */
export function LoginScreen({ offline }: { onLogin: (user: User) => void; offline?: boolean }) {
  return <main className="flex min-h-dvh items-center justify-center bg-background p-6"><section className="xm-card max-w-md space-y-5 p-8"><h1 className="text-2xl font-semibold">Masuk melalui AutoAudit</h1><p>{offline ? 'Layanan belum dapat dihubungi. Coba lagi setelah layanan tersedia.' : 'Property memakai akun dan akses tim dari AutoAudit.'}</p><a className="inline-flex rounded-xl bg-brand px-4 py-3 text-white" href="/api/auth/sso/start">Lanjut ke AutoAudit</a></section></main>;
}
