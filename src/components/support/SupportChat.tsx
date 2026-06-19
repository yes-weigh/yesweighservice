import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isInternalOpsUser } from '../../lib/staffAccess';
import {
  sendSupportMessage,
  subscribeSupportMessages,
} from '../../lib/dealerSupport';
import type { DealerSupportRequest, SupportMessage } from '../../types/dealer-support';
import {
  SupportAttachmentPicker,
  cleanupPendingFiles,
  pendingFilesToUpload,
} from './SupportAttachmentPicker';
import type { PendingSupportFile } from '../../lib/supportAttachments';
import { formatInvoiceDate } from '../../lib/invoices';

interface SupportChatProps {
  request: DealerSupportRequest;
  readOnly?: boolean;
}

function roleLabel(role: string): string {
  if (role === 'staff' || role === 'super_admin') return 'YesWeigh';
  if (role === 'dealer') return 'Dealer';
  if (role === 'dealer_staff') return 'Dealer staff';
  return role;
}

function MessageBubble({ message, isOwn }: { message: SupportMessage; isOwn: boolean }) {
  return (
    <div className={`support-chat__bubble ${isOwn ? 'support-chat__bubble--own' : 'support-chat__bubble--other'}`}>
      <div className="support-chat__bubble-head">
        <strong>{message.authorName || roleLabel(message.authorRole)}</strong>
        <span className="support-chat__time">{formatInvoiceDate(message.createdAt)}</span>
      </div>
      {message.isInitial && (
        <span className="support-chat__initial-badge">Initial request</span>
      )}
      {message.text && <p className="support-chat__text">{message.text}</p>}
      {message.attachments.length > 0 && (
        <div className="support-chat__attachments">
          {message.attachments.map(att => (
            <div key={att.id} className="support-chat__attachment">
              {att.kind === 'video' ? (
                <video src={att.url} controls className="support-chat__attachment-media" />
              ) : (
                <a href={att.url} target="_blank" rel="noopener noreferrer">
                  <img src={att.url} alt={att.fileName} className="support-chat__attachment-media" />
                </a>
              )}
              <span className="support-chat__attachment-name text-muted text-sm">{att.fileName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const SupportChat: React.FC<SupportChatProps> = ({ request, readOnly }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingSupportFile[]>([]);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatDisabled = readOnly
    || (!isInternalOpsUser(user) && request.status === 'cancelled');

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeSupportMessages(
      request.id,
      next => {
        setMessages(next);
        setLoading(false);
      },
      err => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, [request.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  useEffect(() => () => cleanupPendingFiles(pendingFiles), [pendingFiles]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || chatDisabled || sending) return;
    if (!text.trim() && pendingFiles.length === 0) return;

    setSending(true);
    setError('');
    try {
      await sendSupportMessage(user, request.id, {
        text,
        files: pendingFilesToUpload(pendingFiles),
      });
      setText('');
      cleanupPendingFiles(pendingFiles);
      setPendingFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="support-chat panel glass">
      <header className="support-chat__header">
        <h3>Conversation</h3>
        <p className="text-muted text-sm">
          {chatDisabled && !readOnly && request.status === 'cancelled'
            ? 'This request is cancelled. History is read-only.'
            : readOnly
              ? 'Read-only history'
              : 'Messages are saved permanently — you can return anytime.'}
        </p>
      </header>

      {error && (
        <div className="products-inline-error support-chat__error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="support-chat__thread" aria-live="polite">
        {loading ? (
          <p className="support-chat__loading text-muted text-sm">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="support-chat__loading text-muted text-sm">No messages yet.</p>
        ) : (
          messages.map(message => (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.authorUid === user?.uid}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {!chatDisabled && (
        <form className="support-chat__composer" onSubmit={e => void handleSend(e)}>
          <textarea
            className="service-request-form__textarea support-chat__input"
            rows={3}
            placeholder={
              isInternalOpsUser(user)
                ? 'Write a message to the dealer…'
                : 'Write a message to YesWeigh support…'
            }
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={sending}
          />
          <SupportAttachmentPicker
            files={pendingFiles}
            onChange={setPendingFiles}
            disabled={sending}
          />
          <div className="support-chat__composer-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={sending}>
              <Send size={16} />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};
