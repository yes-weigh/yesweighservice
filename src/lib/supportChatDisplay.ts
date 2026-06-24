import type { SupportMessage } from '../types/dealer-support';

function shouldSplitMessage(message: SupportMessage): boolean {
  const hasText = Boolean(message.text?.trim());
  return message.attachments.length > 1 || (message.attachments.length > 0 && hasText);
}

/** Split bundled evidence + text into separate chat bubbles (WhatsApp-style). */
export function expandMessageForDisplay(message: SupportMessage): SupportMessage[] {
  if (!shouldSplitMessage(message)) return [message];

  const parts: SupportMessage[] = [];

  for (const att of message.attachments) {
    parts.push({
      ...message,
      id: `${message.id}__att_${att.id}`,
      text: '',
      attachments: [att],
      isInitial: false,
    });
  }

  if (message.text?.trim()) {
    parts.push({
      ...message,
      id: `${message.id}__text`,
      attachments: [],
      isInitial: message.isInitial,
    });
  }

  return parts.length > 0 ? parts : [message];
}
