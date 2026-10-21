import { useState } from 'react';
import { AuthProvider, useAuth, isAdmin, canViewCalendar, canEditRates, canManageUsers, canAccessMiniRms } from '@/auth/AuthContext';
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

  // Guard restricted pages based on granular permissions
  const effectivePage: PageKey =
    ((page === 'update') && !canEditRates(user)) ||
    ((page === 'admin') && !isAdmin(user) && !canManageUsers(user)) ||
    (page === 'pu_report' && !canAccessMiniRms(user)) ||
    (page === 'lookup' && !canViewCalendar(user))
      ? 'lookup'
      : page;

  return (
    <div className="min-h-screen bg-navy-50/40">
      <Header page={effectivePage} setPage={setPage} />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        {effectivePage === 'lookup' && canViewCalendar(user) && <LookupCalendarPage />}
        {effectivePage === 'price_list' && <MasterPriceListPage />}
        {effectivePage === 'rate_requests' && <RateRequestsPage />}
        {effectivePage === 'update' && canEditRates(user) && <DailyRateUpdatePage />}
        {effectivePage === 'pu_report' && canAccessMiniRms(user) && <PUReportPage />}
        {effectivePage === 'admin' && (isAdmin(user) || canManageUsers(user)) && <SystemAdminPage />}
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
/* ÉP TOÀN BỘ SỐ NGÀY VÀ CHỮ TRÊN LỊCH SANG MÀU ĐEN ĐẬM RÕ NÉT */
.calendar-grid span,
[class*="calendar"] span,
[class*="day"] span {
  color: #000000 !important;
  font-weight: 700 !important;
}

/* GIỮ CHO NGÀY CỦA THÁNG KHÁC MÀU XÁM DỊU ĐỂ DỄ PHÂN BIỆT (NẾU CÓ) */
.opacity-40 span,
.text-slate-400 span,
.outside-month span {
  color: #64748b !important;
  font-weight: 500 !important;
}