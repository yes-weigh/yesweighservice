import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, Phone, Send, ShieldCheck } from 'lucide-react';
import { Logo } from '../components/Logo';
import { TAGLINE } from '../constants/brand';
import { useAuth } from '../context/AuthContext';
import { landingPathForRole } from '../types';
import { isValidPhone, normalizePhone } from '../lib/loginAuth';
import {
  completeDealerPasswordReset,
  completeDealerSignup,
  lookupDealerByPhone,
  sendDealerLoginOtp,
  verifyDealerLoginOtp,
  type DealerLookupOption,
  type DealerLookupResult,
  type DealerOtpPurpose,
} from '../lib/dealerLogin';

type Step = 'phone' | 'select' | 'otp' | 'password';

export const DealerLogin: React.FC = () => {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [purpose, setPurpose] = useState<DealerOtpPurpose>(
    searchParams.get('mode') === 'reset' ? 'reset' : 'signup',
  );
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dealerInfo, setDealerInfo] = useState<DealerLookupResult | null>(null);
  const [dealerOptions, setDealerOptions] = useState<DealerLookupOption[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (!loading && user) {
      navigate(landingPathForRole(user.role), { replace: true });
    }
  }, [user, loading, navigate]);

  const normalizedPhone = normalizePhone(phone);
  const isReset = purpose === 'reset';

  const resetTransient = () => {
    setError('');
    setInfo('');
    setOtp('');
    setPassword('');
    setConfirmPassword('');
    setSetupToken('');
  };

  const applyDealerSelection = (dealer: DealerLookupOption) => {
    setSelectedDealerId(dealer.dealerId);
    setDealerInfo({
      found: true,
      multiple: false,
      dealerId: dealer.dealerId,
      displayName: dealer.displayName,
      hasPortalAccount: dealer.hasPortalAccount,
    });

    if (isReset) {
      if (!dealer.hasPortalAccount) {
        setInfo('This dealer has no portal account yet. Activate the portal first.');
        setStep('phone');
        return;
      }
      setStep('otp');
      return;
    }

    if (dealer.hasPortalAccount) {
      setInfo('You already have a portal account. Sign in with your phone number and password.');
      setStep('phone');
      return;
    }
    setStep('otp');
  };

  const handlePhoneContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!isValidPhone(normalizedPhone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await lookupDealerByPhone(normalizedPhone);
      if (!result.found) {
        setError('No dealer account matches this phone number.');
        return;
      }

      const options = result.multiple && result.dealers?.length
        ? result.dealers
        : result.dealerId
          ? [{
              dealerId: result.dealerId,
              displayName: result.displayName ?? 'Dealer',
              hasPortalAccount: Boolean(result.hasPortalAccount),
            }]
          : [];

      const filtered = isReset
        ? options.filter(d => d.hasPortalAccount)
        : options;

      if (isReset && filtered.length === 0) {
        setError('No active portal account for this phone. Activate your dealer portal first.');
        return;
      }

      if (filtered.length > 1) {
        setDealerOptions(filtered);
        setDealerInfo(null);
        setSelectedDealerId('');
        setStep('select');
        return;
      }

      const only = filtered[0];
      if (!only) {
        setError('Dealer lookup failed. Try again.');
        return;
      }
      applyDealerSelection(only);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendOtp = async () => {
    setError('');
    setInfo('');
    if (!selectedDealerId) {
      setError('Select which dealer account to use.');
      return;
    }
    setSubmitting(true);
    try {
      await sendDealerLoginOtp(normalizedPhone, selectedDealerId, purpose);
      setInfo('OTP sent to your WhatsApp number.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send OTP.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit OTP from WhatsApp.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyDealerLoginOtp(normalizedPhone, otp);
      setSetupToken(result.setupToken);
      setDisplayName(result.displayName);
      if (result.purpose === 'reset' || result.purpose === 'signup') {
        setPurpose(result.purpose);
      }
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.trim().length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (isReset) {
        await completeDealerPasswordReset(normalizedPhone, setupToken, password);
      } else {
        await completeDealerSignup(normalizedPhone, setupToken, password);
      }
      await login(normalizedPhone, password);
      navigate(landingPathForRole('dealer'), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (isReset ? 'Could not reset password.' : 'Could not complete signup.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const startResetMode = () => {
    setPurpose('reset');
    setStep('phone');
    setDealerInfo(null);
    setDealerOptions([]);
    setSelectedDealerId('');
    resetTransient();
    setInfo('Enter your registered mobile number to reset your password via WhatsApp OTP.');
  };

  const startSignupMode = () => {
    setPurpose('signup');
    setStep('phone');
    setDealerInfo(null);
    setDealerOptions([]);
    setSelectedDealerId('');
    resetTransient();
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
            <h2>{isReset ? 'Reset password' : 'Dealer Login'}</h2>
            <p className="brand-tagline">{TAGLINE}</p>
          </div>
          <p>
            {isReset
              ? 'Verify your phone on WhatsApp, then choose a new password'
              : 'Verify your phone to activate your dealer portal'}
          </p>
        </div>

        {step !== 'phone' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm dealer-login-back"
            onClick={() => {
              if (step === 'select') {
                setStep('phone');
              } else {
                setStep(dealerOptions.length > 1 ? 'select' : 'phone');
              }
              resetTransient();
            }}
          >
            <ArrowLeft size={16} /> {step === 'select' ? 'Change phone number' : 'Back'}
          </button>
        )}

        {error && <div className="login-error">{error}</div>}
        {info && <div className="dealer-login-info">{info}</div>}

        {step === 'phone' && (
          <form onSubmit={e => void handlePhoneContinue(e)} className="login-form">
            <div className="form-group">
              <label htmlFor="dealer-phone">Mobile number</label>
              <div className="input-icon-wrap">
                <Phone size={18} className="input-icon" />
                <input
                  id="dealer-phone"
                  type="tel"
                  inputMode="numeric"
                  className="input-field input-with-icon"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  autoFocus
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                />
              </div>
              <p className="text-muted text-sm login-id-hint">
                Use the phone number registered with your Interweighing dealer account
              </p>
            </div>

            <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
              {submitting ? <span className="spinner-inline" /> : <>Continue</>}
            </button>
          </form>
        )}

        {step === 'phone' && !isReset && dealerInfo?.found && dealerInfo.hasPortalAccount && (
          <div className="dealer-login-panel">
            <p className="text-sm">
              Welcome back{dealerInfo.displayName ? `, ${dealerInfo.displayName}` : ''}.
            </p>
            <Link to="/login" className="btn btn-primary w-full mt-2">
              Go to sign in
            </Link>
            <button
              type="button"
              className="btn btn-secondary w-full mt-2"
              onClick={startResetMode}
            >
              Forgot password?
            </button>
          </div>
        )}

        {step === 'select' && dealerOptions.length > 0 && (
          <div className="login-form">
            <p className="text-muted text-sm dealer-login-select-intro">
              Multiple dealer accounts use this phone number. Select yours to continue.
            </p>
            <ul className="dealer-login-picker" role="listbox" aria-label="Dealer accounts">
              {dealerOptions.map(dealer => {
                const location = [dealer.district, dealer.billingState].filter(Boolean).join(', ');
                return (
                  <li key={dealer.dealerId}>
                    <button
                      type="button"
                      role="option"
                      className="dealer-login-picker__option"
                      onClick={() => applyDealerSelection(dealer)}
                      disabled={submitting}
                    >
                      <div className="dealer-login-picker__body">
                        <strong>{dealer.displayName}</strong>
                        {dealer.companyName && dealer.companyName !== dealer.displayName && (
                          <span className="text-muted text-sm">{dealer.companyName}</span>
                        )}
                        {location && <span className="text-muted text-sm">{location}</span>}
                      </div>
                      <span
                        className={`dealer-login-picker__badge${
                          dealer.hasPortalAccount ? ' is-registered' : ''
                        }`}
                      >
                        {isReset
                          ? 'Reset password'
                          : dealer.hasPortalAccount
                            ? 'Portal active'
                            : 'Activate portal'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === 'otp' && dealerInfo?.found && (
          <div className="login-form">
            <div className="dealer-login-panel">
              <ShieldCheck size={18} />
              <div>
                <strong>{dealerInfo.displayName}</strong>
                <p className="text-muted text-sm">Phone ending {normalizedPhone.slice(-4)}</p>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary w-full mt-2"
              onClick={() => void handleSendOtp()}
              disabled={submitting}
            >
              {submitting ? <span className="spinner-inline" /> : <><Send size={18} /> Send OTP</>}
            </button>

            <form onSubmit={e => void handleVerifyOtp(e)} className="mt-3">
              <div className="form-group">
                <label htmlFor="dealer-otp">WhatsApp OTP</label>
                <div className="input-icon-wrap">
                  <KeyRound size={18} className="input-icon" />
                  <input
                    id="dealer-otp"
                    type="text"
                    inputMode="numeric"
                    className="input-field input-with-icon"
                    placeholder="6-digit code"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
                {submitting ? <span className="spinner-inline" /> : <>Verify OTP</>}
              </button>
            </form>
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={e => void handleSetPassword(e)} className="login-form">
            <div className="dealer-login-panel">
              <Lock size={18} />
              <div>
                <strong>{isReset ? 'Choose a new password' : 'Set your password'}</strong>
                <p className="text-muted text-sm">{displayName || dealerInfo?.displayName}</p>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="dealer-password">Password</label>
              <input
                id="dealer-password"
                type="password"
                className="input-field"
                name="yw-dealer-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>

            <div className="form-group">
              <label htmlFor="dealer-password-confirm">Confirm password</label>
              <input
                id="dealer-password-confirm"
                type="password"
                className="input-field"
                name="yw-dealer-password-confirm"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>

            <button type="submit" className="btn btn-primary w-full mt-2" disabled={submitting}>
              {submitting
                ? <span className="spinner-inline" />
                : (isReset ? <>Save password & sign in</> : <>Create account & sign in</>)}
            </button>
          </form>
        )}

        <div className="login-footer">
          {isReset ? (
            <p className="text-muted text-sm">
              Remembered it? <Link to="/login">Sign in</Link>
              {' · '}
              <button type="button" className="link-button" onClick={startSignupMode}>
                Activate new portal
              </button>
            </p>
          ) : (
            <p className="text-muted text-sm">
              Forgot password?{' '}
              <button type="button" className="link-button" onClick={startResetMode}>
                Reset via WhatsApp
              </button>
            </p>
          )}
          <p className="text-muted text-sm">
            Staff or admin? <Link to="/login">Sign in here</Link>
          </p>
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
