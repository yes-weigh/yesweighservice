import type { User } from '../types';
import type { SupportMessage } from '../types/dealer-support';
import type { PendingSupportFile } from './supportAttachments';

export type OutgoingChatMessage = {
  clientId: string;
  text: string;
  files: File[];
  pendingFiles: PendingSupportFile[];
  createdAt: string;
  uploadProgress: number | null;
  uploadLabel: string;
  status: 'uploading' | 'failed' | 'done';
  serverMessageId?: string;
  error?: string;
};

export function outgoingToSupportMessage(outgoing: OutgoingChatMessage, user: User): SupportMessage {
  return {
    id: outgoing.clientId,
    text: outgoing.text,
    attachments: outgoing.pendingFiles.map(pf => ({
      id: pf.id,
      kind: pf.kind,
      url: pf.previewUrl,
      storagePath: '',
      fileName: pf.file.name,
      mimeType:
        pf.file.type
        || (pf.kind === 'video' ? 'video/webm' : pf.kind === 'audio' ? 'audio/webm' : 'image/jpeg'),
      size: pf.file.size,
      posterUrl: pf.kind === 'video' ? (pf.posterPreviewUrl ?? pf.previewUrl) : null,
    })),
    authorUid: user.uid,
    authorName: user.displayName ?? '',
    authorRole: user.role,
    createdAt: outgoing.createdAt,
  };
}

export function filterActiveOutgoing(
  outgoing: OutgoingChatMessage[],
  messages: SupportMessage[],
): OutgoingChatMessage[] {
  return outgoing.filter(
    o => !o.serverMessageId || !messages.some(m => m.id === o.serverMessageId),
  );
}
