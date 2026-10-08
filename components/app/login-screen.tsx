'use client';

import { useState, type SyntheticEvent } from 'react';
import { Input, Label, TextField } from '@heroui/react';
import { ArrowRight, Eye, EyeOff, LineChart, ShieldCheck, Sparkles } from 'lucide-react';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { BlurFade } from '@/components/magicui/blur-fade';
import { BorderBeam } from '@/components/magicui/border-beam';
import { DotPattern } from '@/components/magicui/dot-pattern';
import { Ripple } from '@/components/magicui/ripple';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { Notice } from '@/components/app/primitives';
import type { User } from '@/lib/types';

const highlights = [
  { icon: Sparkles, title: 'Match baru otomatis', text: 'Unggah chat, lihat buyer dan listing yang cocok tanpa mencari manual.' },
  { icon: LineChart, title: 'Statistik yang jelas', text: 'Demand buyer minggu ini, bulan ini, atau periode pilihan Anda.' },
  { icon: ShieldCheck, title: 'Data tiap company terpisah', text: 'Setiap company hanya melihat data miliknya sendiri.' },
];

export function LoginScreen({ onLogin, offline }: { onLogin: (user: User) => void; offline?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(offline ? 'Aplikasi belum dapat dihubungi. Pastikan layanan berjalan, lalu muat ulang halaman.' : '');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await response.json().catch(() => ({}))) as User & { detail?: unknown };
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Email atau password belum sesuai. Periksa lalu coba lagi.');
      onLogin(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login gagal. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[1.1fr_.9fr]">
      <section className="relative hidden overflow-hidden bg-brand p-12 text-brand-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,.55),transparent_45%),radial-gradient(circle_at_85%_90%,rgba(34,211,238,.25),transparent_40%)]" />
        <DotPattern className="text-white/20 [mask-image:radial-gradient(520px_circle_at_center,white,transparent)]" width={22} height={22} />
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-auto-audit.png" alt="Xavier Marks Auto Audit" width={1024} height={418} className="h-14 w-auto rounded-2xl bg-white px-4 py-2" />
        </div>
        <div className="relative max-w-xl">
          <BlurFade delay={0.1}>
            <p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">Property Matchmaker</p>
            <h1 className="mt-4 text-[2.6rem] leading-[1.1] font-bold tracking-tight">Temukan pasangan buyer dan properti, otomatis.</h1>
          </BlurFade>
          <ul className="mt-9 space-y-5">
            {highlights.map((item, index) => (
              <BlurFade key={item.title} delay={0.25 + index * 0.12}>
                <li className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/12 text-cyan-300"><item.icon className="size-5" aria-hidden="true" /></span>
                  <div><p className="text-lg font-semibold">{item.title}</p><p className="mt-0.5 leading-relaxed text-blue-100/85">{item.text}</p></div>
                </li>
              </BlurFade>
            ))}
          </ul>
        </div>
        <div className="relative flex items-end justify-between">
          <p className="text-sm text-blue-200/70">© Xavier Marks · Auto Audit</p>
          <div className="absolute right-0 bottom-0 w-44 translate-y-6 opacity-95"><LottiePlayer name="searching" /></div>
        </div>
        <Ripple mainCircleSize={260} mainCircleOpacity={0.12} numCircles={5} className="[&>div]:border-white/30 [&>div]:bg-white/5" />
      </section>

      <section className="flex flex-col items-center justify-center p-5 sm:p-10">
        {/* Phone: a compact brand header instead of the big panel */}
        <div className="mb-6 flex w-full max-w-md flex-col items-center text-center lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-auto-audit.png" alt="Xavier Marks Auto Audit" width={1024} height={418} className="h-14 w-auto" />
          <p className="mt-3 text-base text-muted">Pencocokan buyer dan properti, otomatis.</p>
        </div>
        <BlurFade className="w-full max-w-md">
          <form onSubmit={submit} className="xm-card relative w-full overflow-hidden p-6 shadow-xl sm:p-8">
            <BorderBeam size={150} duration={9} colorFrom="#0a3be0" colorTo="#5dd0ea" />
            <h2 className="text-2xl font-bold tracking-tight">Masuk ke akun Anda</h2>
            <p className="mt-1.5 text-base leading-relaxed text-muted">Gunakan email dan password yang diberikan oleh admin company Anda.</p>
            <div className="mt-6 space-y-5">
              <TextField isRequired name="email" type="email" value={email} onChange={setEmail} autoComplete="username" fullWidth>
                <Label className="text-base font-semibold">Email</Label>
                <Input className="h-12 text-base" placeholder="nama@perusahaan.com" />
              </TextField>
              <TextField isRequired name="password" type={show ? 'text' : 'password'} value={password} onChange={setPassword} autoComplete="current-password" fullWidth>
                <Label className="text-base font-semibold">Password</Label>
                <div className="relative">
                  <Input className="h-12 pr-12 text-base" placeholder="Masukkan password" />
                  <button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
                    className="absolute top-1/2 right-1.5 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-muted hover:bg-default">
                    {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </TextField>
            </div>
            {error && <div className="mt-5"><Notice status="danger">{error}</Notice></div>}
            <ShimmerButton type="submit" disabled={loading || !email || !password} background="oklch(0.48 0.235 265)" borderRadius="16px" shimmerColor="#a5f3fc"
              className="mt-6 h-14 w-full text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? 'Memeriksa akun…' : <>Masuk <ArrowRight className="ml-2 size-5" aria-hidden="true" /></>}
            </ShimmerButton>
            <p className="mt-5 text-center text-sm leading-relaxed text-muted">Lupa password? Hubungi super admin company Anda untuk mengatur ulang.</p>
          </form>
        </BlurFade>
      </section>
    </main>
  );
}
