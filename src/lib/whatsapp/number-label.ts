// Display helpers for an account's WhatsApp numbers (migration 044),
// shared by Settings → WhatsApp and the inbox number switcher.

export interface NumberLike {
  label?: string | null;
  verified_name?: string | null;
  display_phone_number?: string | null;
  phone_number_id: string;
}

// Calling code → flag for the regions numbers are likely to be in.
// ponytail: small table, unknown codes show 🌐 — add codes as regions are added.
const FLAGS: Record<string, string> = {
  '1': '🇺🇸', '44': '🇬🇧', '91': '🇮🇳', '61': '🇦🇺', '64': '🇳🇿', '971': '🇦🇪',
  '966': '🇸🇦', '65': '🇸🇬', '60': '🇲🇾', '62': '🇮🇩', '63': '🇵🇭', '81': '🇯🇵',
  '82': '🇰🇷', '86': '🇨🇳', '49': '🇩🇪', '33': '🇫🇷', '34': '🇪🇸', '39': '🇮🇹',
  '31': '🇳🇱', '353': '🇮🇪', '55': '🇧🇷', '52': '🇲🇽', '27': '🇿🇦', '234': '🇳🇬',
  '254': '🇰🇪', '92': '🇵🇰', '880': '🇧🇩', '94': '🇱🇰', '977': '🇳🇵',
};

export function flagForPhone(display?: string | null): string {
  const digits = (display ?? '').replace(/\D/g, '');
  for (let len = 3; len >= 1; len--) {
    const flag = FLAGS[digits.slice(0, len)];
    if (flag) return flag;
  }
  return '🌐';
}

/** "US Sales", else Meta's display name, else the number itself. */
export function numberName(n: NumberLike): string {
  return n.label || n.verified_name || n.display_phone_number || n.phone_number_id;
}
