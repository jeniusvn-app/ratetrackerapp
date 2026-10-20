import { useState } from 'react';
import { useAuth, isAdmin, canAccessPuReport } from '@/auth/AuthContext';
import { Logo } from '@/components/Logo';
import { Button, Badge } from '@/components/ui';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';

export type PageKey = 'lookup' | 'price_list' | 'rate_requests' | 'update' | 'pu_report' | 'admin';

interface NavItem {
  key: PageKey;
  label: string;
  restricted?: boolean;
}

const NAV: NavItem[] = [
  { key: 'lookup', label: 'Lịch' },
  { key: 'price_list', label: 'Bảng giá' },
  { key: 'rate_requests', label: 'Yêu cầu chỉnh giá' },
  { key: 'update', label: 'Cập nhật giá', restricted: true },
  { key: 'pu_report', label: 'PU Report', restricted: true },
  { key: 'admin', label: 'Quản trị', restricted: true },
];

export function Header({
  page,
  setPage,
}: {
  page: PageKey;
  setPage: (p: PageKey) => void;
}) {
  const { user, logout } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!user) return null;

  const visibleNav = NAV.filter((n) => {
    if (!n.restricted) return true;
    if (n.key === 'pu_report') return canAccessPuReport(user);
    return isAdmin(user);
  });

  return (
    <>
      <header className="sticky top-0 z-40 bg-navy-700 text-white shadow-md">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center flex-shrink-0">
              <Logo />
              <div className="leading-tight">
                <div className="font-bold text-sm sm:text-base">RateTracker AI</div>
                <div className="text-[10px] text-navy-200 -mt-0.5">by Jenius</div>
              </div>
            </div>

            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {visibleNav.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setPage(n.key)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    page === n.key
                      ? 'bg-white text-navy-800 shadow-sm'
                      : 'text-navy-100 hover:bg-navy-600'
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <Badge tone={isAdmin(user) ? 'gold' : 'navy'}>
                {isAdmin(user) ? 'Admin' : 'User'}
              </Badge>
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-sm font-medium">{user.username}</div>
                <div className="text-[10px] text-navy-200">{user.email || ''}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPwOpen(true)}
                className="hidden sm:inline-flex"
              >
                Đổi mật khẩu
              </Button>
              <Button variant="ghost" size="sm" onClick={logout} className="text-white hover:bg-navy-600">
                Đăng xuất
              </Button>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="lg:hidden p-2 rounded-md hover:bg-navy-600"
                aria-label="Menu"
              >
                <div className="space-y-1">
                  <span className="block w-5 h-0.5 bg-white" />
                  <span className="block w-5 h-0.5 bg-white" />
                  <span className="block w-5 h-0.5 bg-white" />
                </div>
              </button>
            </div>
          </div>

          {/* Mobile nav */}
          {menuOpen && (
            <nav className="lg:hidden pb-3 grid grid-cols-2 gap-1.5 fade-in">
              {visibleNav.map((n) => (
                <button
                  key={n.key}
                  onClick={() => {
                    setPage(n.key);
                    setMenuOpen(false);
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                    page === n.key
                      ? 'bg-white text-navy-800'
                      : 'text-navy-100 hover:bg-navy-600'
                  }`}
                >
                  {n.label}
                </button>
              ))}
              <button
                onClick={() => {
                  setPwOpen(true);
                  setMenuOpen(false);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-left text-navy-100 hover:bg-navy-600"
              >
                Đổi mật khẩu
              </button>
            </nav>
          )}
        </div>
      </header>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}
