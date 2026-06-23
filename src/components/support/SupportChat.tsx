import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, ChevronDown, Paperclip, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { isSupportClosed } from '../../lib/supportStatus';
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
import type { SupportAttachmentPickerHandle } from './SupportAttachmentPicker';
import type { PendingSupportFile } from '../../lib/supportAttachments';

interface SupportChatProps {
  request: DealerSupportRequest;
  readOnly?: boolean;
}

type ThreadItem =
  | { kind: 'date'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      message: SupportMessage;
      isOwn: boolean;
      showAuthor: boolean;
    };

function roleLabel(role: string): string {
  if (role === 'staff' || role === 'super_admin') return 'YesOne';
  if (role === 'dealer') return 'Dealer';
  if (role === 'dealer_staff') return 'Dealer staff';
  return role;
}

function displayAuthor(message: SupportMessage): string {
  return message.authorName?.trim() || roleLabel(message.authorRole);
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function chatDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msgDay = new Date(d);
  msgDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function buildThreadItems(messages: SupportMessage[], currentUid: string | undefined): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDay = '';
  let lastAuthor = '';

  for (const message of messages) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      items.push({ kind: 'date', key: `date-${day}`, label: chatDateLabel(message.createdAt) });
      lastDay = day;
      lastAuthor = '';
    }

    const isOwn = message.authorUid === currentUid;
    const author = message.authorUid;
    const showAuthor = !isOwn && author !== lastAuthor;
    lastAuthor = author;

    items.push({
      kind: 'message',
      key: message.id,
      message,
      isOwn,
      showAuthor,
    });
  }

  return items;
}

function MessageBubble({
  message,
  isOwn,
  showAuthor,
}: {
  message: SupportMessage;
  isOwn: boolean;
  showAuthor: boolean;
}) {
  const author = displayAuthor(message);
  const hasText = Boolean(message.text?.trim());
  const hasAttachments = message.attachments.length > 0;

  return (
    <div
      className={`support-chat__row ${isOwn ? 'support-chat__row--own' : 'support-chat__row--other'}`}
    >
      {!isOwn && (
        <div className="support-chat__avatar" aria-hidden>
          {showAuthor ? authorInitials(author) : ''}
        </div>
      )}

      <div className="support-chat__bubble-wrap">
        {!isOwn && showAuthor && (
          <span className="support-chat__sender">{author}</span>
        )}

        <div
          className={`support-chat__bubble ${isOwn ? 'support-chat__bubble--own' : 'support-chat__bubble--other'}${hasAttachments && !hasText ? ' support-chat__bubble--media-only' : ''}`}
        >
          {message.isInitial && (
            <span className="support-chat__initial-badge">Initial request</span>
          )}

          {hasAttachments && (
            <div className="support-chat__attachments">
              {message.attachments.map(att => (
                <div key={att.id} className="support-chat__attachment">
                  {att.kind === 'video' ? (
                    <video
                      src={att.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="support-chat__attachment-media"
                    />
                  ) : (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="support-chat__attachment-link"
                    >
                      <img
                        src={att.url}
                        alt={att.fileName}
                        className="support-chat__attachment-media"
                        loading="lazy"
                      />
                    </a>
                  )}
                  {att.fileName && (
                    <span className="support-chat__attachment-name">{att.fileName}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasText && <p className="support-chat__text">{message.text}</p>}

          <footer className="support-chat__meta">
            <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
          </footer>
        </div>
      </div>
    </div>
  );
}

function resizeComposer(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

export const SupportChat: React.FC<SupportChatProps> = ({ request, readOnly }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingSupportFile[]>([]);
  const [sending, setSending] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachRef = useRef<SupportAttachmentPickerHandle>(null);
  const wasAtBottomRef = useRef(true);

  const chatDisabled = readOnly
    || (!isInternalOpsUser(user) && isSupportClosed(request));

  const threadItems = useMemo(
    () => buildThreadItems(messages, user?.uid),
    [messages, user?.uid],
  );

  const statusHint = chatDisabled && !readOnly && isSupportClosed(request)
    ? request.lifecycle === 'cancelled'
      ? 'This request is cancelled. History is read-only.'
      : 'This request is resolved. History is read-only.'
    : readOnly
      ? 'Read-only history'
      : 'Press Enter to send · Shift+Enter for a new line';

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

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
    setShowJump(false);
    wasAtBottomRef.current = true;
  };

  useEffect(() => {
    if (wasAtBottomRef.current) {
      scrollToBottom(messages.length <= 1 ? 'auto' : 'smooth');
    }
  }, [messages.length, sending]);

  useEffect(() => () => cleanupPendingFiles(pendingFiles), [pendingFiles]);

  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 72;
    wasAtBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const handleSend = async () => {
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
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      wasAtBottomRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const canSend = Boolean(text.trim() || pendingFiles.length > 0);

  return (
    <section className="support-chat panel glass">
      <header className="support-chat__header">
        <h3>Conversation</h3>
        <p className="support-chat__subtitle text-muted text-sm">{statusHint}</p>
      </header>

      {error && (
        <div className="products-inline-error support-chat__error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="support-chat__body">
        <div
          ref={threadRef}
          className="support-chat__thread"
          aria-live="polite"
          onScroll={handleThreadScroll}
        >
          {loading ? (
            <div className="support-chat__empty">
              <span className="support-chat__typing" aria-hidden>
                <span /><span /><span />
              </span>
              <p className="text-muted text-sm">Loading messages…</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="support-chat__empty">
              <p className="text-muted text-sm">No messages yet. Say hello to start the conversation.</p>
            </div>
          ) : (
            threadItems.map(item =>
              item.kind === 'date' ? (
                <div key={item.key} className="support-chat__date">
                  <span>{item.label}</span>
                </div>
              ) : (
                <MessageBubble
                  key={item.key}
                  message={item.message}
                  isOwn={item.isOwn}
                  showAuthor={item.showAuthor}
                />
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>

        {showJump && (
          <button
            type="button"
            className="support-chat__jump"
            aria-label="Jump to latest messages"
            onClick={() => scrollToBottom()}
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {!chatDisabled && (
        <form
          className="support-chat__composer"
          onSubmit={e => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <SupportAttachmentPicker
            ref={attachRef}
            files={pendingFiles}
            onChange={setPendingFiles}
            disabled={sending}
            compact
          />

          <div className="support-chat__composer-bar">
            <button
              type="button"
              className="support-chat__icon-btn"
              aria-label="Attach photos or videos"
              disabled={sending}
              onClick={() => attachRef.current?.openPicker()}
            >
              <Paperclip size={20} />
            </button>

            <textarea
              ref={inputRef}
              className="support-chat__input"
              rows={1}
              placeholder={
                isInternalOpsUser(user)
                  ? 'Message dealer…'
                  : 'Message YesOne support…'
              }
              value={text}
              onChange={e => {
                setText(e.target.value);
                resizeComposer(e.currentTarget);
              }}
              onKeyDown={handleComposerKeyDown}
              disabled={sending}
              aria-label="Message"
            />

            <button
              type="submit"
              className={`support-chat__send${canSend ? ' support-chat__send--active' : ''}`}
              disabled={sending || !canSend}
              aria-label={sending ? 'Sending' : 'Send message'}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
};
