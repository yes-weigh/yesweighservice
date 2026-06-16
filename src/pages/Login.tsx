import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Lock, UserRound, Eye, EyeOff } from 'lucide-react';
import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { homePathForRole } from '../types';
import { parseLoginId } from '../lib/loginAuth';

export const Login: React.FC = () => {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) {
      navigate(homePathForRole(user.role), { replace: true });
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!parseLoginId(loginId)) {
      setError('Enter a valid email, 10-digit phone, or 12-digit Aadhaar number.');
      return;
    }
    setSubmitting(true);
    try {
      await login(loginId, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-container">
        <div className="loader-ring" />
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box glass">
        <div className="login-header">
          <div className="login-brand">
            <Logo size="lg" />
            <h2>YesWeigh Service</h2>
          </div>
          <p>Sign in with your ID and password</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="login-id">Login ID</label>
            <div className="input-icon-wrap">
              <UserRound size={18} className="input-icon" />
              <input
                id="login-id"
                type="text"
                className="input-field input-with-icon"
                placeholder="Email, phone, or Aadhaar"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <p className="text-muted text-sm login-id-hint">
              Use your email, 10-digit mobile number, or 12-digit Aadhaar
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>
            <div className="input-icon-wrap">
              <Lock size={18} className="input-icon" />
              <input
                id="login-password"
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

          <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
            {submitting ? <span className="spinner-inline" /> : <><LogIn size={18} /> Sign In</>}
          </button>
        </form>

        <div className="login-footer">
          <p className="text-muted text-sm">
            Dealer? <Link to="/dealer-login">Activate or verify your account</Link>
          </p>
          <p className="text-muted text-sm">© YesWeigh · service.yesweigh.in</p>
        </div>
      </div>

      <div className="bg-shapes">
        <div className="shape shape-1" />
        <div className="shape shape-2" />
        <div className="shape shape-3" />
      </div>
    </div>
  );
};
