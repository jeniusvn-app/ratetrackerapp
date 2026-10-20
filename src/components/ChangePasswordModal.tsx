import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Button, Input, Field, Modal } from '@/components/ui';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword, user } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPw('');
    setPw2('');
    setErr(null);
    setOk(false);
  };

  const submit = async () => {
    setErr(null);
    if (!pw) return setErr('Vui lòng nhập mật khẩu mới');
    if (pw.length < 1) return setErr('Mật khẩu quá ngắn');
    if (pw !== pw2) return setErr('Mật khẩu xác nhận không khớp');
    setBusy(true);
    const res = await changePassword(pw);
    setBusy(false);
    if (!res.ok) return setErr(res.error || 'Không thể đổi mật khẩu');
    setOk(true);
    setTimeout(() => {
      reset();
      onClose();
    }, 1200);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Đổi mật khẩu"
    >
      <div className="space-y-4">
        <div className="text-sm text-navy-500">
          Tài khoản: <span className="font-semibold text-navy-800">{user?.username}</span>
        </div>
        <Field label="Mật khẩu mới">
          <Input value={pw} onChange={setPw} type="password" placeholder="Nhập mật khẩu mới" />
        </Field>
        <Field label="Xác nhận mật khẩu">
          <Input value={pw2} onChange={setPw2} type="password" placeholder="Nhập lại mật khẩu" />
        </Field>
        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {ok && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            Đổi mật khẩu thành công.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Hủy
          </Button>
          <Button variant="gold" onClick={submit} disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu mật khẩu'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
