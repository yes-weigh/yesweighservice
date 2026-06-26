import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, Lock, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { homePathForRole } from '../../types';
import { isValidUsername, normalizeUsername } from '../../lib/loginAuth';

export const WarehouseLogin: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'warehouse') {
        navigate('/warehouse', { replace: true });
      } else {
        navigate(homePathForRole(user.role), { replace: true });
      }
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const normalized = normalizeUsername(loginId);
    if (!isValidUsername(normalized)) {
      setError('Enter your warehouse User ID (letters, numbers, dots, dashes).');
      return;
    }
    setSubmitting(true);
    try {
      await login(normalized, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="warehouse-login">
        <div className="loader-ring" />
      </div>
    );
  }

  return (
    <div className="warehouse-login">
      <div className="warehouse-login__card">
        <header className="warehouse-login__header">
          <p className="warehouse-login__brand">YesStore</p>
          <h1>Warehouse</h1>
          <p className="text-muted text-sm">Sign in with your User ID</p>
        </header>

        <form onSubmit={handleSubmit} className="warehouse-login__form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="warehouse-login-id">User ID</label>
            <div className="input-icon-wrap">
              <UserRound size={18} className="input-icon" />
              <input
                id="warehouse-login-id"
                type="text"
                className="input-field input-with-icon"
                placeholder="e.g. warehouse1"
                value={loginId}
                onChange={e => setLoginId(e.target.value.toLowerCase())}
                required
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="warehouse-login-password">Password</label>
            <div className="input-icon-wrap">
              <Lock size={18} className="input-icon" />
              <input
                id="warehouse-login-password"
                type={showPassword ? 'text' : 'password'}
                className="input-field input-with-icon"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="input-icon-right"
                onClick={() => setShowPassword(p => !p)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
            {submitting ? <span className="spinner-inline" /> : <><LogIn size={18} /> Sign in</>}
          </button>
        </form>

        <p className="warehouse-login__footer text-muted text-sm">
          Staff or dealer? <Link to="/login">Main portal login</Link>
        </p>
      </div>
    </div>
  );
};
