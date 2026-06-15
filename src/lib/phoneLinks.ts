/** Build dialer and WhatsApp URLs from a dealer phone string (Indian + international). */
export function buildContactLinks(raw: string): { tel: string; whatsapp: string } | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;

  if (digits.length === 10) {
    return {
      tel: `tel:+91${digits}`,
      whatsapp: `https://wa.me/91${digits}`,
    };
  }

  if (digits.length === 12 && digits.startsWith('91')) {
    return {
      tel: `tel:+${digits}`,
      whatsapp: `https://wa.me/${digits}`,
    };
  }

  return {
    tel: `tel:+${digits}`,
    whatsapp: `https://wa.me/${digits}`,
  };
}
