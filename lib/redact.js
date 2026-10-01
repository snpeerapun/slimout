'use strict';
// Secret masking. Runs on EVERY output we touch and on everything we ever store, before anything else happens.
// Deliberately conservative patterns: a false positive only hides a value, a false negative leaks a credential.

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-access-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED:github-token]'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:anthropic-key]'],
  [/\bsk-[A-Za-z0-9_-]{24,}\b/g, '[REDACTED:api-key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{16,}/g, '$1 [REDACTED]'],
  [/(:\/\/[^\/\s:@]+:)[^@\/\s]+(@)/g, '$1[REDACTED]$2'],                       // user:password@host
  // KEY=value / "key": "value" where the NAME looks secret (value masked, name kept). Values that look like code
  // (followed by "(" , or plain words with no digit and short) are left alone to avoid wrecking source listings.
  [/\b([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIALS?)[A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9_\-+\/=.:@!#$%^*~]{8,})(\3)(\()?/gi,
    (m, name, sep, q1, val, q2, paren) => (paren || (!/\d/.test(val) && val.length < 16)) ? m : `${name}${sep}${q1}[REDACTED]${q2}`],
];

function redact(text) {
  let out = String(text);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
module.exports = { redact };
