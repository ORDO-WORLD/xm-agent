'use client';

import dynamic from 'next/dynamic';
import { Toast } from '@heroui/react';
import { AppShell } from '@/components/app/app-shell';
import { LoadingRows } from '@/components/app/primitives';
import { LockedScreen } from '@/components/app/locked-screen';
import { LoginScreen } from '@/components/app/login-screen';
import { LottiePlayer } from '@/components/lottie/lottie-player';
import { useRoute } from '@/lib/router';
import { CompanyProvider, ManageProvider, SessionProvider, useAuth, useCompany, useManage, useSession } from '@/lib/session';

const loading = () => <LoadingRows rows={3} />;
const DashboardPage = dynamic(() => import('@/components/pages/dashboard-page'), { ssr: false, loading });
const MatchPage = dynamic(() => import('@/components/pages/match-page'), { ssr: false, loading });
const RecentPage = dynamic(() => import('@/components/pages/recent-page'), { ssr: false, loading });
const StockPage = dynamic(() => import('@/components/pages/stock-page'), { ssr: false, loading });
const UploadPage = dynamic(() => import('@/components/pages/upload-page'), { ssr: false, loading });
const TeamPage = dynamic(() => import('@/components/pages/team-page'), { ssr: false, loading });
const SettingsPage = dynamic(() => import('@/components/pages/settings-page'), { ssr: false, loading });
const CompaniesPage = dynamic(() => import('@/components/pages/companies-page'), { ssr: false, loading });

function Workspace() {
  const { path, params, navigate } = useRoute();
  const { user } = useSession();
  const { company } = useCompany();
  const { target } = useManage();
  const perms = company?.permissions;

  // Pages a role may not open fall back to the home page rather than showing an error.
  let page = path;
  if (!company) page = 'beranda';
  else if (page === 'data' && !perms?.upload_data) page = 'beranda';
  else if (page === 'tim' && !perms?.manage_team) page = 'beranda';
  else if (page === 'perusahaan' && user.role !== 'admin') page = 'beranda';
  // The platform administrator starts in the company list, not in an empty personal workspace.
  if (user.role === 'admin' && !target && path === 'beranda' && !window.location.hash) page = 'beranda';

  const body = (() => {
    switch (page) {
      case 'cocokkan': return <MatchPage params={params} navigate={navigate} />;
      case 'match-baru': return <RecentPage navigate={navigate} />;
      case 'stok': return <StockPage navigate={navigate} />;
      case 'data': return <UploadPage navigate={navigate} />;
      case 'tim': return <TeamPage />;
      case 'pengaturan': return <SettingsPage params={params} navigate={navigate} />;
      case 'perusahaan': return <CompaniesPage />;
      default: return <DashboardPage navigate={navigate} params={params} />;
    }
  })();
  return <AppShell route={page} navigate={navigate}>{body}</AppShell>;
}

export default function Home() {
  const { user, setUser, logout, failed } = useAuth();
  let screen;
  if (user === undefined) {
    screen = <main className="flex min-h-dvh flex-col items-center justify-center bg-background"><LottiePlayer name="loading" className="w-32" label="Memuat aplikasi" /></main>;
  } else if (!user) {
    screen = <LoginScreen onLogin={setUser} offline={failed} />;
  } else if (user.is_locked) {
    screen = <LockedScreen onLogout={logout} />;
  } else {
    screen = (
      <SessionProvider key={user.id} user={user} logout={logout}>
        <ManageProvider user={user}>
          <CompanyProvider>
            <Workspace />
          </CompanyProvider>
        </ManageProvider>
      </SessionProvider>
    );
  }
  return <>{screen}<Toast.Provider placement="bottom end" /></>;
}
