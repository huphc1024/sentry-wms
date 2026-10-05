import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLocale } from '../i18n/locale.jsx';
import { useAuth } from '../auth.jsx';
import { friendlyErrorFromResponse } from '../utils/friendlyError.js';

export default function ChangePassword() {
  const { account, refresh } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const forced = Boolean(account?.must_change_password);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    const res = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    setBusy(false);
    if (!res || !res.ok) {
      setError(await friendlyErrorFromResponse(res, t('auth.failed')));
      setCurrentPassword('');
      return;
    }
    setDone(true);
    // The password change bumps password_changed_at, which invalidates
    // every token minted at or before that second -- including this
    // session's. Re-reading /auth/me tells us whether the cookie survived:
    // if it did not, send the user to the login screen instead of leaving
    // them on a page whose next request would 401.
    const identity = await refresh();
    if (!identity) {
      navigate('/login', { replace: true });
      return;
    }
    if (forced) navigate('/', { replace: true });
  }

  return (
    <div className="page page-narrow">
      <h1>{t('auth.changePassword')}</h1>
      {forced && (
        <div className="alert alert-warning" role="alert">
          {t('auth.forced')}
        </div>
      )}
      {done && !forced && (
        <div className="alert alert-success" role="status">{t('auth.changed')}</div>
      )}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <form className="card form-card" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="cur">{t('auth.currentPassword')}</label>
          <input
            id="cur"
            className="form-input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="new">{t('auth.newPassword')}</label>
          <input
            id="new"
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <span className="form-hint">
            {t('auth.passwordHint')}
          </span>
        </div>
        <div className="form-group">
          <label htmlFor="confirm">{t('auth.confirmPassword')}</label>
          <input
            id="confirm"
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? t('auth.saving') : t('auth.changePassword')}
        </button>
      </form>
    </div>
  );
}
