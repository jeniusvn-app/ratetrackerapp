import { useState } from 'react';
import { AuthProvider, useAuth, isAdmin, canAccessPuReport, canUploadPuOnly } from '@/auth/AuthContext';
import { LoginScreen } from '@/components/LoginScreen';
import { Header, type PageKey } from '@/components/Header';
import { LookupCalendarPage } from '@/pages/LookupCalendarPage';
import { MasterPriceListPage } from '@/pages/MasterPriceListPage';
import { RateRequestsPage } from '@/pages/RateRequestsPage';
import { DailyRateUpdatePage } from '@/pages/DailyRateUpdatePage';
import { PUReportPage } from '@/pages/PUReportPage';
import { SystemAdminPage } from '@/pages/SystemAdminPage';

function Shell() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<PageKey>('lookup');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50">
        <div className="text-navy-400 text-sm">Đang tải…</div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  // Guard restricted pages: update/admin require admin; pu_report requires
  // admin, can_access_pu_report flag, or can_upload_pu_only flag.
  // Unauthorized users fall back to Lịch.
  const effectivePage: PageKey =
    ((page === 'update' || page === 'admin') && !isAdmin(user)) ||
    (page === 'pu_report' && !canAccessPuReport(user) && !canUploadPuOnly(user))
      ? 'lookup'
      : page;

  return (
    <div className="min-h-screen bg-navy-50/40">
      <Header page={effectivePage} setPage={setPage} />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        {effectivePage === 'lookup' && <LookupCalendarPage />}
        {effectivePage === 'price_list' && <MasterPriceListPage />}
        {effectivePage === 'rate_requests' && <RateRequestsPage />}
        {effectivePage === 'update' && isAdmin(user) && <DailyRateUpdatePage />}
        {effectivePage === 'pu_report' && (canAccessPuReport(user) || canUploadPuOnly(user)) && <PUReportPage />}
        {effectivePage === 'admin' && isAdmin(user) && <SystemAdminPage />}
      </main>
      <footer className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 text-center text-xs text-navy-300">
        RateTracker AI by Jenius — Hotel Rate Management System
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
