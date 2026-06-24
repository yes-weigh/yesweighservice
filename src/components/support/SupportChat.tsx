import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, Check, CheckCheck, ChevronDown } from 'lucide-react';
import { FIRM_NAME_SHORT } from '../../constants/brand';
import { useAuth } from '../../context/AuthContext';
import { isInternalOpsUser } from '../../lib/staffAccess';
import { isSupportClosed } from '../../lib/supportStatus';
import {
  markSupportMessageReceipts,
  sendSupportMessage,
  subscribeSupportMessages,
  supportMessageReceiptStatus,
} from '../../lib/dealerSupport';
import type {
  DealerSupportRequest,
  SupportMessage,
  SupportMessageReceiptStatus,
} from '../../types/dealer-support';
import { expandMessageForDisplay } from '../../lib/supportChatDisplay';
import {
  cleanupPendingFiles,
  pendingFilesToUpload,
} from './SupportAttachmentPicker';
import { SupportChatComposer } from './SupportChatComposer';
import { SupportChatVideo } from './SupportChatVideo';
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
  if (role === 'staff' || role === 'super_admin') return FIRM_NAME_SHORT;
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
    const expanded = expandMessageForDisplay(message);

    expanded.forEach((part, index) => {
      const showAuthor = !isOwn && index === 0 && author !== lastAuthor;
      if (index === 0) lastAuthor = author;

      items.push({
        kind: 'message',
        key: part.id,
        message: part,
        isOwn,
        showAuthor,
      });
    });
  }

  return items;
}

const RECEIPT_LABELS: Record<SupportMessageReceiptStatus, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

function MessageReceipt({ status }: { status: SupportMessageReceiptStatus }) {
  return (
    <span
      className={`support-chat__receipt support-chat__receipt--${status}`}
      aria-label={RECEIPT_LABELS[status]}
      title={RECEIPT_LABELS[status]}
    >
      {status === 'sent' ? <Check size={13} strokeWidth={2.5} /> : <CheckCheck size={13} strokeWidth={2.5} />}
    </span>
  );
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
  const mediaOnly = hasAttachments && !hasText;

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
          className={`support-chat__bubble ${isOwn ? 'support-chat__bubble--own' : 'support-chat__bubble--other'}${mediaOnly ? ' support-chat__bubble--media-only' : ''}`}
        >
          {hasAttachments && (
            <div className="support-chat__attachments">
              {message.attachments.map(att => (
                <div key={att.id} className="support-chat__attachment">
                  {att.kind === 'video' ? (
                    <SupportChatVideo
                      src={att.url}
                      fileName={mediaOnly ? undefined : att.fileName}
                      className="support-chat__attachment-media"
                    />
                  ) : att.kind === 'audio' ? (
                    <audio
                      src={att.url}
                      controls
                      preload="metadata"
                      className="support-chat__attachment-audio"
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
                  {att.fileName && !mediaOnly && att.kind !== 'video' && (
                    <span className="support-chat__attachment-name">{att.fileName}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasText && <p className="support-chat__text">{message.text}</p>}

          <footer className="support-chat__meta">
            <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
            {isOwn && <MessageReceipt status={supportMessageReceiptStatus(message)} />}
          </footer>
        </div>
      </div>
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
  const [showJump, setShowJump] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const receiptPendingRef = useRef<{ delivered: Set<string>; read: Set<string> }>({
    delivered: new Set(),
    read: new Set(),
  });
  const [dockHeight, setDockHeight] = useState(0);

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
      : 'Enter for a new line · Send button to send';

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

  const syncReceipts = useCallback(async (
    msgs: SupportMessage[],
    receipt: 'delivered' | 'read',
  ) => {
    if (!user) return;

    const pending = msgs
      .filter(m => m.authorUid !== user.uid)
      .filter(m => (receipt === 'delivered' ? !m.deliveredAt : !m.readAt))
      .map(m => m.id)
      .filter(id => !receiptPendingRef.current[receipt].has(id));

    if (pending.length === 0) return;

    pending.forEach(id => receiptPendingRef.current[receipt].add(id));
    try {
      await markSupportMessageReceipts(request.id, pending, receipt);
    } catch {
      pending.forEach(id => receiptPendingRef.current[receipt].delete(id));
    }
  }, [user, request.id]);

  useEffect(() => {
    if (loading || !user) return;
    void syncReceipts(messages, 'delivered');
  }, [messages, loading, user, syncReceipts]);

  useEffect(() => {
    if (loading || !user) return;

    const markRead = () => {
      if (document.visibilityState === 'visible') {
        void syncReceipts(messages, 'read');
      }
    };

    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [messages, loading, user, syncReceipts]);

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

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return undefined;

    const updateDockHeight = () => {
      setDockHeight(dock.offsetHeight);
    };

    updateDockHeight();
    const observer = new ResizeObserver(updateDockHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [chatDisabled, pendingFiles.length]);

  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 72;
    wasAtBottomRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const handleSend = async (filesOverride?: File[]) => {
    if (!user || chatDisabled || sending) return;
    const uploadFiles = filesOverride ?? pendingFilesToUpload(pendingFiles);
    if (!text.trim() && uploadFiles.length === 0) return;

    setSending(true);
    setError('');
    try {
      await sendSupportMessage(user, request.id, {
        text: filesOverride ? '' : text,
        files: uploadFiles,
      });
      if (!filesOverride) {
        setText('');
        cleanupPendingFiles(pendingFiles);
        setPendingFiles([]);
      }
      wasAtBottomRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const handleSendFiles = async (files: File[]) => {
    await handleSend(files);
  };

  return (
    <section
      className="support-chat support-chat--flat"
      style={{ '--support-chat-dock-height': `${dockHeight}px` } as React.CSSProperties}
    >
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

      <div
        className="support-chat__dock-spacer"
        style={{ height: dockHeight || undefined }}
        aria-hidden
      />

      <div ref={dockRef} className="support-chat__dock">
        {chatDisabled ? (
          <p className="support-chat__status-bar text-sm text-muted">{statusHint}</p>
        ) : (
          <SupportChatComposer
            text={text}
            onTextChange={setText}
            pendingFiles={pendingFiles}
            onPendingFilesChange={setPendingFiles}
            onSend={() => void handleSend()}
            onSendFiles={handleSendFiles}
            sending={sending}
            placeholder={
              isInternalOpsUser(user)
                ? 'Message dealer…'
                : `Message ${FIRM_NAME_SHORT} support…`
            }
          />
        )}
      </div>
    </section>
  );
};
