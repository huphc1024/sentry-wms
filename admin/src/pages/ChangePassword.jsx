import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLocale } from '../i18n/locale.jsx';
import { friendlyError } from '../utils/friendlyError.js';

export default function ChangePassword() {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const forced = !!user?.must_change_password;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsMismatch'));
      return;
    }

    setSubmitting(true);
    const res = await api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });

    if (!res || !res.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setError(friendlyError(data, t('auth.changePasswordFailed')));
      setSubmitting(false);
      return;
    }

    try {
      sessionStorage.setItem(
        'login_flash_message',
        'Password changed. Please sign in with your new password.',
      );
    } catch {
      // Private mode or disabled storage
    }
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      {forced && (
        <div
          role="alert"
          className="forced-change-banner"
          style={{
            background: 'var(--danger)',
            color: 'var(--on-accent)',
            padding: '14px 18px',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          <strong>{t('auth.firstTimeSetup')}</strong> {t('auth.chooseNewPassword')}
        </div>
      )}

      <h2 style={{ marginTop: 0, marginBottom: 20 }}>{t('auth.changePassword')}</h2>

      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>{t('auth.currentPassword')}</label>
          <input
            className="form-input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>{t('auth.newPassword')}</label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>
            {t('auth.passwordHint')}
          </div>
        </div>

        <div className="form-group">
          <label>{t('auth.confirmPassword')}</label>
          <input
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? t('common.saving') : t('auth.changePassword')}
          </button>
          {!forced && (
            <button
              type="button"
              className="btn"
              onClick={() => navigate(-1)}
              disabled={submitting}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
