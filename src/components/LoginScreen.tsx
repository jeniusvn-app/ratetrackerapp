import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Logo } from '@/components/Logo';
import { Button, Input, Field } from '@/components/ui';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username || !password) {
      setError('Vui lòng nhập tài khoản và mật khẩu');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await login(username, password);
    setBusy(false);
    if (!res.ok) setError(res.error || 'Đăng nhập thất bại');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FFDAB9] via-[#FFE4C4] to-[#FFDAB9] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-pop p-8 fade-in">
        <div className="flex items-center justify-center mb-6">
          <Logo className="w-12 h-12 mr-3" />
          <div>
            <h1 className="text-xl font-bold text-black leading-tight">RateTracker AI</h1>
            <p className="text-xs text-black/60">by Jenius</p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="Tài khoản">
            <Input
              value={username}
              onChange={setUsername}
              placeholder="Nhập tài khoản"
              onEnter={submit}
              autoFocus
            />
          </Field>
          <Field label="Mật khẩu">
            <Input
              value={password}
              onChange={setPassword}
              placeholder="Nhập mật khẩu"
              type="password"
              onEnter={submit}
            />
          </Field>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button variant="gold" size="md" onClick={submit} disabled={busy} className="w-full">
            {busy ? 'Đang xử lý…' : 'Đăng nhập'}
          </Button>
        </div>
      </div>
    </div>
  );
}
