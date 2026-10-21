// WhatsApp's inline formatting — *bold*, _italic_, ~strike~, ```mono``` —
// split into styled segments so previews show text the way the phone
// does. Like WhatsApp, a marker only counts when the text right inside it
// isn't a space, so "**x**" renders as a literal * around bold "x".

export interface WaSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}

// Markers also need a word boundary outside them: snake_case_name stays plain.
const RULES: { re: RegExp; style: keyof Omit<WaSegment, 'text'> }[] = [
  { re: /```([\s\S]+?)```/, style: 'mono' },
  { re: /(?<![\p{L}\p{N}])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}])/u, style: 'bold' },
  { re: /(?<![\p{L}\p{N}])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}])/u, style: 'italic' },
  { re: /(?<![\p{L}\p{N}])~(?=\S)([^~\n]*?\S)~(?![\p{L}\p{N}])/u, style: 'strike' },
];

export function waSegments(text: string, inherited: Omit<WaSegment, 'text'> = {}): WaSegment[] {
  if (!text) return [];
  // Earliest marker wins, so nesting like *_both_* works outside-in.
  let best: { index: number; length: number; inner: string; style: keyof Omit<WaSegment, 'text'> } | null =
    null;
  for (const { re, style } of RULES) {
    if (inherited[style]) continue;
    const m = re.exec(text);
    if (m && (!best || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, inner: m[1], style };
    }
  }
  if (!best) return [{ text, ...inherited }];
  const style = { ...inherited, [best.style]: true };
  return [
    ...(best.index > 0 ? [{ text: text.slice(0, best.index), ...inherited }] : []),
    ...(best.style === 'mono' ? [{ text: best.inner, ...style }] : waSegments(best.inner, style)),
    ...waSegments(text.slice(best.index + best.length), inherited),
  ];
}
