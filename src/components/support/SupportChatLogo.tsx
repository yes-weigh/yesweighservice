interface SupportChatLogoProps {
  size?: number;
  className?: string;
}

/** Overlapping speech bubbles — used for Chat with Interweighing. */
export function SupportChatLogo({ size = 36, className }: SupportChatLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `support-chat-logo ${className}` : 'support-chat-logo'}
      aria-hidden
    >
      <path
        d="M30 8H18c-3.3 0-6 2.7-6 6v10c0 3.3 2.7 6 6 6h1.2l3.3 5.5c.4.7 1.4.7 1.8 0L27.8 30H30c3.3 0 6-2.7 6-6V14c0-3.3-2.7-6-6-6Z"
        fill="#94a3b8"
      />
      <circle cx="20" cy="19" r="1.6" fill="#475569" />
      <circle cx="24" cy="19" r="1.6" fill="#475569" />
      <circle cx="28" cy="19" r="1.6" fill="#475569" />
      <path
        d="M26 14H14c-3.3 0-6 2.7-6 6v10c0 3.3 2.7 6 6 6h1.2l3.3 5.5c.4.7 1.4.7 1.8 0L23.8 36H26c3.3 0 6-2.7 6-6V20c0-3.3-2.7-6-6-6Z"
        fill="#3b82f6"
      />
      <circle cx="16" cy="25" r="1.8" fill="#fff" />
      <circle cx="21" cy="25" r="1.8" fill="#fff" />
      <circle cx="26" cy="25" r="1.8" fill="#fff" />
    </svg>
  );
}
