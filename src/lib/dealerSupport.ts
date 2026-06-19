import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from '../types';
import {
  allowedSupportTypesForUser,
  canManageSupportOps,
  isInternalOpsUser,
} from '../lib/staffAccess';
import type {
  CreateSupportRequestInput,
  DealerSupportRequest,
  SendSupportMessageInput,
  SupportMessage,
  SupportRequestStatus,
  SupportRequestType,
} from '../types/dealer-support';
import { uploadSupportAttachments } from './supportAttachments';

const REQUEST_PREFIX: Record<SupportRequestType, string> = {
  service: 'SRV',
  return: 'RMA',
  complaint: 'CMP',
};

function resolveDealerId(user: User): string {
  if (user.role === 'dealer') return user.uid;
  if (user.dealerId) return user.dealerId;
  return user.uid;
}

function buildRequestNumber(type: SupportRequestType): string {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `${REQUEST_PREFIX[type]}-${year}-${suffix}`;
}

function previewText(text: string, attachmentCount: number): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 140);
  if (attachmentCount > 0) return `${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`;
  return 'New message';
}

function mapAttachment(raw: DocumentData): SupportMessage['attachments'][number] {
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind === 'video' ? 'video' : 'image',
    url: String(raw.url ?? ''),
    storagePath: String(raw.storagePath ?? ''),
    fileName: String(raw.fileName ?? 'file'),
    mimeType: String(raw.mimeType ?? ''),
    size: Number(raw.size ?? 0),
  };
}

function mapMessage(id: string, data: DocumentData): SupportMessage {
  const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
  return {
    id,
    text: String(data.text ?? ''),
    attachments: attachmentsRaw.map(item => mapAttachment(item as DocumentData)),
    authorUid: String(data.authorUid ?? ''),
    authorName: String(data.authorName ?? ''),
    authorRole: String(data.authorRole ?? ''),
    createdAt: String(data.createdAt ?? ''),
    isInitial: data.isInitial === true,
  };
}

export function mapSupportRequest(id: string, data: DocumentData): DealerSupportRequest {
  const product = data.product as DocumentData | undefined;

  return {
    id,
    type: (data.type ?? 'service') as SupportRequestType,
    requestNumber: String(data.requestNumber ?? ''),
    status: (data.status ?? 'pending') as SupportRequestStatus,
    invoiceId: data.invoiceId ? String(data.invoiceId) : null,
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
    salesOrderNumber: data.salesOrderNumber ? String(data.salesOrderNumber) : null,
    product: product
      ? {
          lineItemId: product.lineItemId ? String(product.lineItemId) : null,
          itemId: product.itemId ? String(product.itemId) : null,
          name: String(product.name ?? 'Product'),
          sku: product.sku ? String(product.sku) : null,
          quantity: Number(product.quantity ?? 1),
        }
      : null,
    category: String(data.category ?? ''),
    subject: data.subject ? String(data.subject) : null,
    description: String(data.description ?? ''),
    notes: data.notes ? String(data.notes) : null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? data.createdAt ?? ''),
    lastMessageAt: data.lastMessageAt ? String(data.lastMessageAt) : null,
    lastMessagePreview: data.lastMessagePreview ? String(data.lastMessagePreview) : null,
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: String(data.createdByName ?? ''),
    dealerId: String(data.dealerId ?? ''),
    dealerName: data.dealerName ? String(data.dealerName) : null,
  };
}

export function supportBasePath(role: User['role']): string {
  const base = role === 'dealer_staff' ? '/dealer-staff' : role === 'staff' ? '/staff' : '/dealer';
  return `${base}/warranty-support`;
}

export function supportDetailPath(role: User['role'], requestId: string): string {
  return `${supportBasePath(role)}/${requestId}`;
}

export function canUserAccessSupportRequest(user: User, request: DealerSupportRequest): boolean {
  if (user.role === 'super_admin') return true;
  if (user.role === 'staff') {
    const allowed = allowedSupportTypesForUser(user);
    if (allowed === 'all') return true;
    if (allowed.length === 0) return false;
    return allowed.includes(request.type);
  }
  const dealerId = resolveDealerId(user);
  return request.dealerId === dealerId;
}

export async function getSupportRequest(requestId: string): Promise<DealerSupportRequest | null> {
  const current = await getDoc(doc(db, 'dealerSupportRequests', requestId));
  if (!current.exists()) return null;
  return mapSupportRequest(current.id, current.data());
}

export async function sendSupportMessage(
  user: User,
  requestId: string,
  input: SendSupportMessageInput,
): Promise<SupportMessage> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');
  if (!canUserAccessSupportRequest(user, request)) {
    throw new Error('You do not have permission to message this request.');
  }
  if (!isInternalOpsUser(user) && request.status === 'cancelled') {
    throw new Error('This request is closed and cannot receive new messages.');
  }

  const text = input.text.trim();
  const files = input.files ?? [];
  if (!text && files.length === 0) {
    throw new Error('Enter a message or attach a file.');
  }

  const messageRef = doc(collection(db, 'dealerSupportRequests', requestId, 'messages'));
  const attachments = files.length
    ? await uploadSupportAttachments(requestId, messageRef.id, files)
    : [];

  const now = new Date().toISOString();
  const payload = {
    text,
    attachments,
    authorUid: user.uid,
    authorName: user.displayName,
    authorRole: user.role,
    createdAt: now,
    isInitial: input.isInitial === true,
  };

  await setDoc(messageRef, payload);

  const updates: Record<string, string> = {
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: previewText(text, attachments.length),
  };

  if (canManageSupportOps(user) && request.status === 'pending') {
    updates.status = 'in_progress';
  }

  await updateDoc(doc(db, 'dealerSupportRequests', requestId), updates);

  return mapMessage(messageRef.id, payload);
}

export async function createSupportRequest(
  user: User,
  input: CreateSupportRequestInput,
): Promise<DealerSupportRequest> {
  const now = new Date().toISOString();
  const hasProduct = Boolean(input.itemName?.trim() || input.invoiceNumber?.trim());

  const data = {
    type: input.type,
    requestNumber: buildRequestNumber(input.type),
    status: 'pending' as const,
    invoiceId: input.invoiceId ?? null,
    invoiceNumber: input.invoiceNumber?.trim() || null,
    salesOrderNumber: input.salesOrderNumber ?? null,
    product: hasProduct
      ? {
          lineItemId: input.lineItemId ?? null,
          itemId: input.itemId ?? null,
          name: input.itemName?.trim() || 'Product',
          sku: input.itemSku ?? null,
          quantity: input.quantity ?? 1,
        }
      : null,
    category: input.category.trim(),
    subject: input.subject?.trim() || null,
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdByUid: user.uid,
    createdByName: user.displayName,
    dealerId: resolveDealerId(user),
    dealerName: user.displayName,
  };

  const docRef = await addDoc(collection(db, 'dealerSupportRequests'), data);
  const request = mapSupportRequest(docRef.id, data);

  await sendSupportMessage(user, docRef.id, {
    text: input.description.trim(),
    files: input.attachmentFiles,
    isInitial: true,
  });

  return request;
}

export function subscribeSupportMessages(
  requestId: string,
  onData: (messages: SupportMessage[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'dealerSupportRequests', requestId, 'messages'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(docSnap => mapMessage(docSnap.id, docSnap.data())));
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load messages.')),
  );
}

export function subscribeSupportRequest(
  requestId: string,
  onData: (request: DealerSupportRequest | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'dealerSupportRequests', requestId), snap => {
    if (!snap.exists()) {
      onData(null);
      return;
    }
    onData(mapSupportRequest(snap.id, snap.data()));
  });
}

export async function fetchDealerSupportRequests(user: User): Promise<DealerSupportRequest[]> {
  const dealerId = resolveDealerId(user);

  const snap = await getDocs(
    query(
      collection(db, 'dealerSupportRequests'),
      where('dealerId', '==', dealerId),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
  );

  return snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data()));
}

export async function fetchOpsSupportRequests(): Promise<DealerSupportRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'dealerSupportRequests'),
      orderBy('updatedAt', 'desc'),
      limit(200),
    ),
  );
  return snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data()));
}

export async function updateSupportRequestStatus(
  user: User,
  requestId: string,
  status: SupportRequestStatus,
): Promise<void> {
  if (!canManageSupportOps(user)) {
    throw new Error('Only staff can update request status.');
  }
  await updateDoc(doc(db, 'dealerSupportRequests', requestId), {
    status,
    updatedAt: new Date().toISOString(),
  });
}
