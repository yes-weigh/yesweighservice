import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertCircle, Check, CheckCheck, ChevronDown, Clock } from 'lucide-react';
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
import type { User } from '../../types';
import { expandMessageForDisplay } from '../../lib/supportChatDisplay';
import {
  createPendingSupportFile,
  isVideoFile,
  retainFileCopies,
  revokePendingSupportFiles,
  type PendingSupportFile,
} from '../../lib/supportAttachments';
import { captureVideoPoster } from '../../lib/captureMedia';
import {
  filterActiveOutgoing,
  outgoingToSupportMessage,
  type OutgoingChatMessage,
} from '../../lib/supportChatOutgoing';
import {
  cleanupPendingFiles,
  pendingFilesToUpload,
} from './SupportAttachmentPicker';
import { SupportChatComposer } from './SupportChatComposer';
import { SupportChatDocumentCard } from './SupportChatDocumentCard';
import { SupportChatUploadOverlay } from './SupportChatUploadOverlay';
import { SupportChatVideo } from './SupportChatVideo';
import { SupportChatVoiceNote } from './SupportChatVoiceNote';

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
      uploadState?: {
        progress: number | null;
        label: string;
        failed: boolean;
        onRetry?: () => void;
      };
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

function buildThreadItems(
  messages: SupportMessage[],
  outgoing: OutgoingChatMessage[],
  currentUid: string | undefined,
  user: User | null,
  onRetryOutgoing?: (clientId: string) => void,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  let lastDay = '';
  let lastAuthor = '';

  const activeOutgoing = filterActiveOutgoing(outgoing, messages);
  const syntheticMessages = user
    ? activeOutgoing.map(entry => ({
        entry,
        message: outgoingToSupportMessage(entry, user),
      }))
    : [];

  const combined = [
    ...messages.map(message => ({ message, entry: null as OutgoingChatMessage | null })),
    ...syntheticMessages.map(({ message, entry }) => ({ message, entry })),
  ].sort(
    (a, b) => new Date(a.message.createdAt).getTime() - new Date(b.message.createdAt).getTime(),
  );

  for (const { message, entry } of combined) {
    const day = dayKey(message.createdAt);
    if (day !== lastDay) {
      items.push({ kind: 'date', key: `date-${day}`, label: chatDateLabel(message.createdAt) });
      lastDay = day;
      lastAuthor = '';
    }

    const isOwn = message.authorUid === currentUid;
    const author = message.authorUid;
    const expanded = entry ? [message] : expandMessageForDisplay(message);

    expanded.forEach((part, index) => {
      const showAuthor = !isOwn && index === 0 && author !== lastAuthor;
      if (index === 0) lastAuthor = author;

      const uploadState = entry && index === 0
        ? {
            progress: entry.status === 'uploading' ? entry.uploadProgress : entry.status === 'done' ? 100 : null,
            label: entry.uploadLabel,
            failed: entry.status === 'failed',
            onRetry: entry.status === 'failed' ? () => onRetryOutgoing?.(entry.clientId) : undefined,
          }
        : undefined;

      items.push({
        kind: 'message',
        key: entry ? `out-${entry.clientId}` : part.id,
        message: part,
        isOwn,
        showAuthor,
        uploadState,
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

function isAudioAttachment(att: SupportMessage['attachments'][number]): boolean {
  return att.kind === 'audio' || att.mimeType.startsWith('audio/');
}

function MessageMetaFooter({
  message,
  isOwn,
  isUploading,
  uploadFailed,
}: {
  message: SupportMessage;
  isOwn: boolean;
  isUploading: boolean;
  uploadFailed: boolean;
}) {
  return (
    <footer className="support-chat__meta">
      <time dateTime={message.createdAt}>{formatChatTime(message.createdAt)}</time>
      {isOwn && (
        isUploading ? (
          <span className="support-chat__receipt support-chat__receipt--pending" aria-label="Sending" title="Sending">
            <Clock size={13} strokeWidth={2.5} />
          </span>
        ) : uploadFailed ? (
          <span className="support-chat__receipt support-chat__receipt--failed" aria-label="Failed to send" title="Failed to send">
            <AlertCircle size={13} strokeWidth={2.5} />
          </span>
        ) : (
          <MessageReceipt status={supportMessageReceiptStatus(message)} />
        )
      )}
    </footer>
  );
}

function MessageBubble({
  message,
  isOwn,
  showAuthor,
  onMediaLayout,
  uploadState,
}: {
  message: SupportMessage;
  isOwn: boolean;
  showAuthor: boolean;
  onMediaLayout?: () => void;
  uploadState?: {
    progress: number | null;
    label: string;
    failed: boolean;
    onRetry?: () => void;
  };
}) {
  const author = displayAuthor(message);
  const hasText = Boolean(message.text?.trim());
  const hasAttachments = message.attachments.length > 0;
  const mediaOnly = hasAttachments && !hasText;
  const audioOnly = mediaOnly && message.attachments.every(isAudioAttachment);
  const isUploading = Boolean(uploadState && !uploadState.failed && uploadState.progress !== 100);
  const uploadFailed = Boolean(uploadState?.failed);
  const voiceAvatarLabel = isOwn ? authorInitials(displayAuthor(message)) : authorInitials(author);
  const voiceMessageTime = formatChatTime(message.createdAt);

  const voiceReceipt = isOwn ? (
    isUploading ? (
      <span className="support-chat__receipt support-chat__receipt--pending" aria-label="Sending" title="Sending">
        <Clock size={13} strokeWidth={2.5} />
      </span>
    ) : uploadFailed ? (
      <span className="support-chat__receipt support-chat__receipt--failed" aria-label="Failed to send" title="Failed to send">
        <AlertCircle size={13} strokeWidth={2.5} />
      </span>
    ) : (
      <MessageReceipt status={supportMessageReceiptStatus(message)} />
    )
  ) : null;

  const renderVoiceNote = (att: SupportMessage['attachments'][number]) => {
    const note = (
      <SupportChatVoiceNote
        src={att.url}
        isOwn={isOwn}
        avatarLabel={voiceAvatarLabel}
        messageTime={voiceMessageTime}
        receipt={voiceReceipt}
        onLayout={onMediaLayout}
      />
    );

    if (isUploading || uploadFailed) {
      return (
        <div key={att.id} className="support-chat__attachment-upload-wrap support-chat__attachment-upload-wrap--voice">
          {note}
          {isUploading && <SupportChatUploadOverlay progress={uploadState?.progress ?? null} />}
          {uploadFailed && uploadState?.onRetry && (
            <button
              type="button"
              className="support-chat__upload-retry"
              onClick={uploadState.onRetry}
            >
              Tap to retry
            </button>
          )}
        </div>
      );
    }

    return <React.Fragment key={att.id}>{note}</React.Fragment>;
  };

  return (
    <div
      className={`support-chat__row ${isOwn ? 'support-chat__row--own' : 'support-chat__row--other'}${uploadFailed ? ' support-chat__row--failed' : ''}`}
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

        {audioOnly ? (
          <div
            className={`support-chat__bubble support-chat__bubble--voice ${isOwn ? 'support-chat__bubble--own' : 'support-chat__bubble--other'}`}
          >
            {message.attachments.map(att => renderVoiceNote(att))}
          </div>
        ) : (
        <div
          className={`support-chat__bubble ${isOwn ? 'support-chat__bubble--own' : 'support-chat__bubble--other'}${mediaOnly ? ' support-chat__bubble--media-only' : ''}`}
        >
          {hasAttachments && (
            <div className="support-chat__attachments">
              {message.attachments.map(att => (
                <div key={att.id} className="support-chat__attachment">
                  {att.kind === 'video' ? (
                    isUploading || uploadFailed ? (
                      <div className="support-chat__video-wrap">
                        {att.posterUrl ? (
                          <img
                            src={att.posterUrl}
                            alt=""
                            className="support-chat__attachment-media"
                            decoding="async"
                            onLoad={onMediaLayout}
                          />
                        ) : (
                          <video
                            src={att.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="support-chat__attachment-media"
                            onLoadedMetadata={onMediaLayout}
                          />
                        )}
                        {isUploading && <SupportChatUploadOverlay progress={uploadState?.progress ?? null} />}
                        {uploadFailed && uploadState?.onRetry && (
                          <button
                            type="button"
                            className="support-chat__upload-retry"
                            onClick={uploadState.onRetry}
                          >
                            Tap to retry
                          </button>
                        )}
                      </div>
                    ) : (
                      <SupportChatVideo
                        src={att.url}
                        storagePath={att.storagePath}
                        mimeType={att.mimeType}
                        posterUrl={att.posterUrl}
                        fileName={mediaOnly ? undefined : att.fileName}
                        className="support-chat__attachment-media"
                        onLayout={onMediaLayout}
                      />
                    )
                  ) : isAudioAttachment(att) ? (
                    renderVoiceNote(att)
                  ) : att.kind === 'document' ? (
                    <SupportChatDocumentCard
                      fileName={att.fileName}
                      mimeType={att.mimeType}
                      size={att.size}
                      url={att.url}
                      isOwn={isOwn}
                      onLayout={onMediaLayout}
                    />
                  ) : (
                    <div className="support-chat__attachment-upload-wrap">
                      {isUploading || uploadFailed ? (
                        <>
                          <img
                            src={att.url}
                            alt={att.fileName}
                            className="support-chat__attachment-media"
                            decoding="async"
                            onLoad={onMediaLayout}
                          />
                          {isUploading && <SupportChatUploadOverlay progress={uploadState?.progress ?? null} />}
                          {uploadFailed && uploadState?.onRetry && (
                            <button
                              type="button"
                              className="support-chat__upload-retry"
                              onClick={uploadState.onRetry}
                            >
                              Tap to retry
                            </button>
                          )}
                        </>
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
                            decoding="async"
                            onLoad={onMediaLayout}
                            onError={onMediaLayout}
                          />
                        </a>
                      )}
                    </div>
                  )}
                  {att.fileName && !mediaOnly && att.kind !== 'video' && att.kind !== 'document' && (
                    <span className="support-chat__attachment-name">{att.fileName}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasText && <p className="support-chat__text">{message.text}</p>}

          <MessageMetaFooter
            message={message}
            isOwn={isOwn}
            isUploading={isUploading}
            uploadFailed={uploadFailed}
          />
        </div>
        )}
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
  const [outgoingMessages, setOutgoingMessages] = useState<OutgoingChatMessage[]>([]);
  const [showJump, setShowJump] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const forcePinRef = useRef(true);
  const receiptPendingRef = useRef<{ delivered: Set<string>; read: Set<string> }>({
    delivered: new Set(),
    read: new Set(),
  });
  const [dockHeight, setDockHeight] = useState(0);

  const chatDisabled = readOnly
    || (!isInternalOpsUser(user) && isSupportClosed(request));

  const outgoingRef = useRef<OutgoingChatMessage[]>([]);

  const dispatchOutgoing = useCallback(async (entry: OutgoingChatMessage) => {
    if (!user) return;

    try {
      const result = await sendSupportMessage(
        user,
        request.id,
        { text: entry.text, files: entry.files },
        progress => {
          setOutgoingMessages(prev => prev.map(item =>
            item.clientId === entry.clientId
              ? {
                  ...item,
                  uploadProgress: progress.percent,
                  uploadLabel: progress.label,
                }
              : item,
          ));
        },
      );

      setOutgoingMessages(prev => prev.map(item =>
        item.clientId === entry.clientId
          ? {
              ...item,
              status: 'done',
              serverMessageId: result.id,
              uploadProgress: 100,
            }
          : item,
      ));
      wasAtBottomRef.current = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send message.';
      setOutgoingMessages(prev => prev.map(item =>
        item.clientId === entry.clientId
          ? { ...item, status: 'failed', error: message }
          : item,
      ));
      setError(message);
    }
  }, [user, request.id]);

  const retryOutgoing = useCallback((clientId: string) => {
    setOutgoingMessages(prev => {
      const entry = prev.find(item => item.clientId === clientId);
      if (!entry) return prev;

      const refreshed: OutgoingChatMessage = {
        ...entry,
        status: 'uploading',
        uploadProgress: 0,
        uploadLabel: 'Retrying…',
        error: undefined,
      };
      void dispatchOutgoing(refreshed);
      return prev.map(item => (item.clientId === clientId ? refreshed : item));
    });
  }, [dispatchOutgoing]);

  const queueOutgoingMessage = useCallback((
    textValue: string,
    uploadFiles: File[],
    pendingForDisplay: PendingSupportFile[],
  ) => {
    if (!user) return;

    const clientId = `out-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const entry: OutgoingChatMessage = {
      clientId,
      text: textValue,
      files: uploadFiles,
      pendingFiles: pendingForDisplay,
      createdAt: new Date().toISOString(),
      uploadProgress: uploadFiles.length > 0 ? 0 : null,
      uploadLabel: uploadFiles.length > 0 ? 'Preparing…' : 'Sending…',
      status: 'uploading',
    };

    setOutgoingMessages(prev => [...prev, entry]);
    wasAtBottomRef.current = true;
    forcePinRef.current = true;
    void dispatchOutgoing(entry);

    if (uploadFiles.length === 1 && isVideoFile(uploadFiles[0])) {
      void captureVideoPoster(uploadFiles[0])
        .then(posterBlob => {
          if (!posterBlob) return;
          const posterPreviewUrl = URL.createObjectURL(posterBlob);
          setOutgoingMessages(prev => prev.map(item => {
            if (item.clientId !== clientId) return item;
            return {
              ...item,
              pendingFiles: item.pendingFiles.map(pf => (
                pf.kind === 'video' ? { ...pf, posterPreviewUrl } : pf
              )),
            };
          }));
        })
        .catch(() => undefined);
    }
  }, [user, dispatchOutgoing]);

  const threadItems = useMemo(
    () => buildThreadItems(messages, outgoingMessages, user?.uid, user ?? null, retryOutgoing),
    [messages, outgoingMessages, user, retryOutgoing],
  );

  const statusHint = chatDisabled && !readOnly && isSupportClosed(request)
    ? request.lifecycle === 'cancelled'
      ? 'This request is cancelled. History is read-only.'
      : 'This request is resolved. History is read-only.'
    : readOnly
      ? 'Read-only history'
      : 'Enter for a new line · Send button to send';

  useEffect(() => {
    wasAtBottomRef.current = true;
    forcePinRef.current = true;
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = threadRef.current;
    if (!el) return;

    const applyScroll = () => {
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      if (behavior === 'smooth') {
        el.scrollTo({ top, behavior: 'smooth' });
      } else {
        el.scrollTop = top;
      }
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
    };

    applyScroll();
    setShowJump(false);
    wasAtBottomRef.current = true;
  }, []);

  const pinToBottomIfNeeded = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!wasAtBottomRef.current && !forcePinRef.current) return;
    scrollToBottom(behavior);
  }, [scrollToBottom]);

  const releaseForcedPin = useCallback(() => {
    const el = threadRef.current;
    if (!el) {
      forcePinRef.current = false;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 8) {
      forcePinRef.current = false;
    }
  }, []);

  const handleMediaLayout = useCallback(() => {
    pinToBottomIfNeeded('auto');
    requestAnimationFrame(releaseForcedPin);
  }, [pinToBottomIfNeeded, releaseForcedPin]);

  useLayoutEffect(() => {
    if (loading) return;
    scrollToBottom('auto');
    requestAnimationFrame(() => {
      scrollToBottom('auto');
      releaseForcedPin();
    });
  }, [loading, scrollToBottom, releaseForcedPin]);

  useLayoutEffect(() => {
    if (loading) return;
    scrollToBottom('auto');
  }, [loading, threadItems.length, outgoingMessages.length, scrollToBottom]);

  useEffect(() => {
    if (loading) return;
    const content = threadContentRef.current;
    if (!content) return;

    const pin = () => pinToBottomIfNeeded('auto');

    pin();
    const raf1 = requestAnimationFrame(() => {
      pin();
      requestAnimationFrame(() => {
        pin();
        releaseForcedPin();
      });
    });
    const ro = new ResizeObserver(pin);
    ro.observe(content);

    return () => {
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [loading, request.id, pinToBottomIfNeeded, releaseForcedPin]);

  useEffect(() => {
    if (loading || !wasAtBottomRef.current) return;
    const hasActiveUploads = outgoingMessages.some(item => item.status === 'uploading');
    scrollToBottom(hasActiveUploads || messages.length <= 1 ? 'auto' : 'smooth');
  }, [messages.length, outgoingMessages.length, loading, scrollToBottom]);

  useEffect(() => () => cleanupPendingFiles(pendingFiles), [pendingFiles]);

  useEffect(() => {
    const prev = outgoingRef.current;
    const removed = prev.filter(
      item => !outgoingMessages.some(next => next.clientId === item.clientId),
    );
    removed.forEach(item => revokePendingSupportFiles(item.pendingFiles));
    outgoingRef.current = outgoingMessages;
  }, [outgoingMessages]);

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
    if (!atBottom) {
      forcePinRef.current = false;
    }
    setShowJump(!atBottom);
  };

  const handleSend = async (filesOverride?: File[]) => {
    if (!user || chatDisabled) return;

    const textValue = filesOverride ? '' : text.trim();
    const rawFiles = filesOverride ?? pendingFilesToUpload(pendingFiles);
    if (!textValue && rawFiles.length === 0) return;

    let uploadFiles: File[];
    try {
      uploadFiles = await retainFileCopies(rawFiles);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not read attached files.';
      setError(message);
      return;
    }

    const pendingForDisplay = filesOverride
      ? uploadFiles.map(file => createPendingSupportFile(file))
      : [...pendingFiles];

    setError('');
    if (!filesOverride) {
      setText('');
      setPendingFiles([]);
    }

    queueOutgoingMessage(textValue, uploadFiles, pendingForDisplay);
  };

  const handleSendFiles = (files: File[]) => {
    void handleSend(files);
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
          <div ref={threadContentRef} className="support-chat__thread-inner">
            {loading ? (
              <div className="support-chat__empty">
                <span className="support-chat__typing" aria-hidden>
                  <span /><span /><span />
                </span>
                <p className="text-muted text-sm">Loading messages…</p>
              </div>
            ) : messages.length === 0 && outgoingMessages.length === 0 ? (
              <div className="support-chat__empty">
                <p className="text-muted text-sm">
                  {error
                    ? 'Could not load messages. Check your connection and try again.'
                    : request.lastMessagePreview
                      ? 'Messages are still loading…'
                      : 'No messages yet. Say hello to start the conversation.'}
                </p>
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
                    onMediaLayout={handleMediaLayout}
                    uploadState={item.uploadState}
                  />
                ),
              )
            )}
            <div ref={bottomRef} className="support-chat__thread-anchor" aria-hidden />
          </div>
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
