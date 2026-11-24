/**
 * Page → memory text extraction (F-111 web page capture).
 *
 * Runs in the PAGE (injected via chrome.scripting.executeScript) or in a content
 * script, so it must be fully self-contained: no imports, no chrome.* access.
 * It only reads what the user is already looking at — it is called from a click,
 * never on page load.
 *
 * Shape returned: { title, url, text }.
 */

export const MAX_PAGE_CHARS = 20000;

/**
 * Collapse the noise a raw innerText carries so the stored page is readable:
 * trim trailing spaces, drop CRLF variance, and cap runs of blank lines.
 * Pure (string → string) so it is unit-testable without a DOM.
 */
export function cleanPageText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Human-readable header stored above the page body. Pure. */
export function buildPageContent({ title, url, text }) {
  const heading = (title || url || 'Untitled page').trim().slice(0, 200);
  const body = cleanPageText(text);
  return `# ${heading}\n${url || ''}\n\n${body}`.trim();
}

/**
 * Extract the readable text of the current document.
 *
 * IMPORTANT: this function is serialized by chrome.scripting.executeScript, so
 * it must be SELF-CONTAINED — no imports, no module-scope constants, no helper
 * calls. Everything it needs is defined inside its own body (the 20000 cap is
 * duplicated here for that reason; MAX_PAGE_CHARS stays the source of truth for
 * callers/tests and the unit test pins the behaviour).
 *
 * Preference order: <article> → <main> → [role=main] → body.innerText. This
 * mirrors what a reader mode would keep, without shipping a readability parser
 * (and without sending anything over the network).
 */
export function extractPageText(doc = document) {
  const normalize = (raw) => String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const read = (selector) => {
    try {
      const el = doc.querySelector(selector);
      return el ? el.innerText || el.textContent || '' : '';
    } catch {
      return '';
    }
  };

  const title = (doc.title || '').trim().slice(0, 200);
  const url = doc.location ? doc.location.href : '';

  let text = read('article') || read('main') || read('[role="main"]');
  if (!text) text = doc.body ? doc.body.innerText || '' : '';

  text = normalize(text);
  if (text.length > 20000) {
    text = `${text.slice(0, 20000)}…`;
  }

  return { title, url, text };
}
