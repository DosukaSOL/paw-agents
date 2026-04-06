// ─── Input Sanitization & Prompt Injection Defense ───
import sanitizeHtml from 'sanitize-html';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*/i,
  /\boverride\b.*\brules?\b/i,
  /\bforget\b.*\binstructions?\b/i,
  /\bact\s+as\b/i,
  /\bpretend\b.*\byou\b/i,
  /\bdo\s+not\s+follow\b/i,
  /\bjailbreak\b/i,
  /\bDAN\b/,
  /\b(reveal|show|print|output)\b.*\b(system\s*prompt|secret|key|password|token)\b/i,
  /```\s*(system|admin|root)/i,
  /\{\{.*\}\}/,
  /<\s*script/i,
  /\$\{.*\}/,
];

const MAX_INPUT_LENGTH = 4096;

export interface SanitizationResult {
  safe: boolean;
  sanitized: string;
  injection_detected: boolean;
  injection_patterns_matched: string[];
  original_length: number;
  truncated: boolean;
}

export function sanitizeInput(raw: string): SanitizationResult {
  const original_length = raw.length;
  const truncated = raw.length > MAX_INPUT_LENGTH;

  // Truncate
  let text = raw.slice(0, MAX_INPUT_LENGTH);

  // Strip HTML
  text = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });

  // Strip control characters (keep newlines, tabs)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Detect prompt injection
  const matched: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(pattern.source);
    }
  }

  return {
    safe: matched.length === 0,
    sanitized: text,
    injection_detected: matched.length > 0,
    injection_patterns_matched: matched,
    original_length,
    truncated,
  };
}
