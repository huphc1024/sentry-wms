/**
 * Find user-visible string literals in a page or component.
 *
 * One detector, two callers: `tools/i18n-scan.mjs` prints what it finds
 * so a conversion can be worked through, and `src/test/i18n-guard.test.js`
 * fails on what it finds in a converted file. If they used separate
 * rules, the scanner would report a set the guard does not enforce, and
 * a page would look finished while the guard stayed red -- or worse,
 * look finished and pass.
 *
 * Line-based rather than a real JSX parse, which is the same trade the
 * mobile theming gate makes: cheap, no jsdom, exact file:line output,
 * and false positives handled by narrow ignore rules rather than by
 * loosening the match.
 */

/**
 * Props whose value a user reads. Deliberately a closed list -- a
 * catch-all would sweep in className, key, type and every data-*.
 */
export const TEXT_PROPS = [
  'title', 'placeholder', 'aria-label', 'alt', 'label',
  'emptyMessage', 'fallbackMessage', 'okText', 'cancelText',
  'confirmText', 'tooltip', 'description',
];

/**
 * Function names whose string argument is shown to somebody. Copy
 * handed to a setter is as user-visible as copy in the markup, and it
 * is the kind that only appears on an error path -- exactly what a
 * render-based check would miss.
 */
const MESSAGE_CALLS = [
  'setError', 'setNotice', 'setBanner', 'setSuccess', 'setSuccessBanner',
  'setActionError', 'setCancelError', 'setDeleteError', 'setFormError',
  'setMessage', 'setStatusMessage', 'throw new Error',
  'window.confirm', 'window.alert', 'confirm', 'alert',
  'Alert.alert', 'showError', 'showToast',
];

/** Callees whose string arguments are addresses and codes, never copy. */
const NOT_COPY = /\b(api\.(get|post|put|patch|delete)|fetch|navigate|URLSearchParams|querySelector(All)?|getItem|setItem|removeItem|console\.(log|warn|error|info)|new URL|encodeURIComponent|localStorage|sessionStorage|setLocale|setMode|setTheme)\s*\(/;

/**
 * Vietnamese lowercase letters, so a hardcoded Vietnamese string counts
 * as copy too. Twenty-two files write Vietnamese straight into their
 * markup -- those pages show Vietnamese even when English is selected,
 * which is the same bug as the English ones, just pointing the other
 * way. An ASCII-only test would walk straight past all of them.
 */
const VI = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const WORD = new RegExp(`[a-z${VI}]{2,}`);
const VOWEL = new RegExp(`[aeiou${VI}]`, 'i');

/** A string nobody reads as prose: codes, symbols, single glyphs. */
function looksLikeCopy(s) {
  // Strip HTML entities first: `&larr; Back` is a back link whose text
  // the entity would otherwise hide behind punctuation.
  const t = s.replace(/&[a-zA-Z]+;|&#\d+;/g, ' ').trim();
  if (t.length < 2) return false;
  // Anything the app already has a translation for is copy by
  // definition, whatever its shape. This is how short trade terms --
  // 'Qty', 'UPC', 'SKU', 'PO' -- get through a test that otherwise
  // rejects them as codes, and it needs no separate list to maintain.
  if (KNOWN_PHRASES.has(t)) return true;
  // Needs a word of two or more letters containing a vowel -- excludes
  // 'ID', '×', '▸', '—', 'N/A'.
  if (!WORD.test(t)) return false;
  if (!VOWEL.test(t)) return false;
  // Punctuation left over from a bad split, e.g. ', label:'. A
  // closing bracket leads the gap between two JSX branches --
  // `) : expandedSlug ? (` sits between a </div> and a <div> and
  // reads as text to a line-based scan. No sentence starts this way.
  if (/^[\s,;:.|/\\)}\]-]+/.test(t)) return false;
  // Markup, not prose. A page that builds a print window writes
  // `<html><head><title>` into a template; copy that needs emphasis
  // goes through RichText and never carries its own tags.
  if (/<\/?[a-z][a-z0-9]*\s*\/?>/i.test(t)) return false;
  // Identifiers and paths: snake_case, kebab-case, dotted, URLs.
  if (/^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(t)) return false;
  if (/^(https?:|\/|\.{1,2}\/)/.test(t)) return false;
  // A query-string fragment a URL template was built from:
  // `&warehouse_id=${id}`. It never reaches a screen as words.
  if (/^[?&]\w+=/.test(s.trim())) return false;
  // CSS values that happen to be words. The list holds only words no
  // screen would use as a label: `medium`, `cover` and `both` are CSS
  // too, and are left out, because a missed string ships untranslated
  // and nobody reports it -- the exact failure this gate exists for.
  if (/^(none|auto|inherit|initial|unset|center|left|right|top|bottom|flex|grid|block|inline|hidden|visible|pointer|nowrap|bold|normal|column|row|absolute|relative|fixed|sticky|small|middle|large|primary|default|horizontal|vertical|ascend|descend|checked|text|button|submit|number|email|password|date|search|file|wrap|uppercase|lowercase|capitalize|ellipsis|baseline|stretch|evenly|dashed|dotted)$/i.test(t)) return false;
  // Flags and enum values, lowercase only and deliberately
  // case-SENSITIVE: 'true' is an attribute value, 'True' is a word
  // somebody reads, and the same goes for 'all' beside 'All'.
  if (/^(true|false|asc|desc|all|any|vi|en)$/.test(t)) return false;
  // Code that happened to sit between a `>` and a `<`. An arrow
  // function inside a render prop is the common case:
  // `render: (r) => r.parent_so_number || <span>` reads to a line-based
  // scan as the text "r.parent_so_number ||".
  //
  // `{}` is exempt: it is the placeholder this module substitutes for an
  // interpolated value, so leaving it in the check rejected every
  // sentence built around one -- which is the class of string a
  // dictionary can never fix and the one most worth finding.
  const withoutPlaceholders = t.replace(/\{\}/g, '');
  // Code, not prose. Parentheses are judged by shape rather than by
  // presence: `foo(` is a call, `) =>` and `).` are expressions, but a
  // parenthesised word -- "(blank)", "(none)", "(no customer)" -- is
  // ordinary copy, and rejecting every paren threw all of those away.
  // A call has no space before its bracket. Requiring that is the
  // difference between rejecting `fn(x)` and rejecting
  // `Rate limit (req/sec)`, a slider label that sat on screen
  // untranslated because this filter read it as code.
  // A quoted token inside what looks like JSX text is a comparison
  // the scan cut in half: `cents > 0 ? 'up' : cents < 0` reads as text
  // between the `>` and the `<`. Matching the ternary shape rather
  // than the token catches `? '▲'` as well as `? 'up'`.
  // A semicolon reads as code when it ends the fragment or a statement
  // follows it. Prose uses it mid-sentence in both languages, and
  // treating every one as code hid three whole lines. `//` is a
  // comment marker a joined line drags in; a URL is excluded above.
  // `).` is a method chain only when a name follows the dot. In prose
  // it is a bracket closing before a full stop -- `(with a warning).`
  // -- which hid an entire settings note.
  const CODEISH = /[|&]{2}|=>|[{}]|;\s*(?:$|\w+\s*[({=])|\/\/|\w\.\w|\?\?|\+\+|===|!==|\w\(|\)\s*\.\w|\)\s*=|[?:]\s*'/;
  if (CODEISH.test(withoutPlaceholders)) return false;
  // A template that builds a class name or a DOM id, not a sentence:
  // `topbar-lang-btn${i}`, `col-${n}`, `modal modal-${size}`,
  // `create-rma-line-${id}`. They are lowercase ASCII tokens, possibly
  // hyphen-joined and space-separated, with no punctuation and no
  // capital -- which no sentence in either language looks like. Applied
  // only to strings carrying a placeholder, so an ordinary lowercase
  // fragment elsewhere is untouched.
  // Removing the placeholder leaves a dangling separator -- `col-${n}`
  // becomes `col-` -- so trim those before matching.
  const skeleton = withoutPlaceholders.replace(/^[-_. ]+|[-_. ]+$/g, '');
  // ...and only when it is short. A class list runs to two or three
  // words; a sentence runs longer, and an all-lowercase one with a
  // value in front of it --
  // `${channel} - orders that need to ship today` -- was being read as
  // a class name and dropped.
  const words = skeleton.split(/[-_. ]+/).filter(Boolean).length;
  if (t.includes('{}') && words <= 3
    && /^[a-z0-9]+([-_. ][a-z0-9]+)*$/.test(skeleton)) return false;
  return true;
}

/**
 * English phrases the app already knows how to translate.
 *
 * Set by `setKnownPhrases` so this module stays independent of the
 * message tables -- the guard and the scanner each load them their own
 * way, and neither should be forced through the other's.
 */
let KNOWN_PHRASES = new Set();

export function setKnownPhrases(phrases) {
  KNOWN_PHRASES = phrases instanceof Set ? phrases : new Set(phrases);
}

const COMMENT = /^\s*(\{?\/\*|\*|\/\/)/;

/**
 * Escape hatch for the cases a line-based scan gets wrong — an enum
 * value that reads like a sentence, a string built for a URL. Marks one
 * line, so each use is visible in review rather than a file-wide opt
 * out.
 *
 *   const kind = 'shrink'; // i18n-ignore
 */
const IGNORE = /\/\/\s*i18n-ignore|\/\*\s*i18n-ignore[^*]*\*\//;

/**
 * A download filename is built out of a template exactly the way a
 * sentence is, and the shape test cannot tell `productivity-{}_{}.csv`
 * from copy -- the separators run together where the values were.
 */
const FILENAME_ASSIGN = /\.\bdownload\s*=/;

/** ...and a template that ends in a file extension is one too. */
const FILENAME_SHAPE = /\.(?:csv|json|pdf|txt|xlsx|png|zip)$/i;

/**
 * @param {string} source  file contents
 * @returns {{line: number, text: string, kind: string}[]}
 */
export function detectLiterals(source) {
  const out = [];
  // JSX text often wraps: the opening tag, the sentence and the closing
  // tag land on three lines, and a line-based scan sees no `>text<` at
  // all. Joining a line to the next before matching catches those
  // without needing to parse the file.
  const srcLines = source.split('\n');
  const lines = srcLines.map(
    (line, i) => `${line} ${srcLines[i + 1] ?? ''} ${srcLines[i + 2] ?? ''}`,
  );
  let inBlockComment = false;

  lines.forEach((joined, i) => {
    const line = joined;
    const lineNo = i + 1;

    // Block comments, including the JSX `{/* ... */}` form.
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return;
    }
    if (COMMENT.test(line)) {
      if (/\/\*/.test(line) && !line.includes('*/')) inBlockComment = true;
      return;
    }
    if (/^\s*import\s|^\s*export\s+\{/.test(line)) return;
    if (IGNORE.test(line) || FILENAME_ASSIGN.test(line)) return;

    const add = (text, kind) => {
      if (looksLikeCopy(text)) out.push({ line: lineNo, text: text.trim(), kind });
    };

    // A string already wrapped in t() is done; blank the calls out so
    // their arguments are not re-reported.
    const scrubbed = line.replace(/\bt\(\s*'[^']*'(\s*,[^)]*)?\)/g, 't(_)');

    // 1. JSX text between tags, e.g. `>Keep Backorder<`
    for (const m of scrubbed.matchAll(/>([^<>{}\n]+)</g)) add(m[1], 'jsx-text');

    // 1a. Text a value interrupts: `>Order #{orderNumber}<` and
    //     `>Must ship by: {formatDateOnly(d)}<`. Rule 1 stops at the
    //     brace and sees two fragments too short to look like copy, so
    //     these read as fully translated when they are not translated
    //     at all. The value collapses to `{}` -- enough to name a key
    //     and to show the shape the sentence needs.
    for (const m of scrubbed.matchAll(/>([^<>\n]*\{[^<>\n]*)</g)) {
      // Collapse the template holes first. A container that holds a
      // template literal has nested braces, and collapsing the outer
      // shape first leaves the operators behind, so the whole sentence
      // reads as code and is dropped -- which is what happened to a
      // section title counting rows on a live page.
      const merged = m[1]
        .replace(/\$\{[^{}]*\}/g, 'x')
        .replace(/\{[^{}]*\}/g, '{}')
        .replace(/\s+/g, ' ')
        .trim();
      if (merged !== '{}') add(merged, 'jsx-split');
    }

    // 1b. Strings inside a JSX expression container, e.g.
    //     `{vi ? 'Đã xảy ra lỗi' : 'Something went wrong'}`.
    //     Rule 1 cannot see these -- it stops at the braces -- and this
    //     is where the hand-rolled locale ternaries live, which are
    //     exactly the ones this migration exists to delete.
    // A className is never copy, and it is built from string fragments
    // that read like words: `sidebar-link${isActive ? ' active' : ''}`.
    // Matched on this line alone, not the joined one. Joining serves
    // the two text rules above, where a sentence genuinely wraps. Here
    // it only pairs a block-opening brace with whatever follows on the
    // next line, so `if (open) {` + `addEventListener('mousedown', ...)`
    // reads as a container holding copy. A container that renders text
    // is written on one line; text that wraps is rule 1a's job.
    // A style object holds CSS, never copy, and some of its values are
    // ordinary words -- `borderCollapse: 'collapse'`. Emptying the
    // object beats adding those words to the CSS list, which would also
    // blind the scan to a button that genuinely says "Collapse".
    const own = srcLines[i]
      .replace(/\bstyle\s*=\s*\{\{[^{}]*\}\}/g, 'style={{}}')
      .replace(/\bt\(\s*'[^']*'(\s*,[^)]*)?\)/g, 't(_)');
    // Blank the attribute rather than skip the line. Skipping it lost
    // `<span><i className="x" /> {a ? 'Yesterday' : 'Prior day'}</span>`
    // entirely -- the class was never the point, the ternary was.
    const own2 = own.replace(
      // A class built from a template has braces inside it, so the
      // simple brace form cannot reach the end of it.
      /\bclassName\s*=\s*(?:"[^"]*"|\{`[^`]*`\s*\}|\{[^{}]*\})/g,
      'className=""',
    );

    for (const m of own2.matchAll(/\{[^{}]*\}/g)) {
      let expr = m[0];
      // `${...}` is a hole in a template literal, not a JSX container.
      // Rule 4 owns templates, and a class built from one --
      // `data-tab${isActive ? ' active' : ''}` -- read as copy here.
      if (own2[m.index - 1] === '$') continue;
      // `value={form.x || 'new'}` picks a stored value, never a label.
      // The attribute name sits outside the braces, so it has to be
      // read from what precedes the match.
      if (/\b(?:value|key|id|htmlFor|list|type|role)\s*=\s*$/
        .test(own2.slice(0, m.index))) continue;
      // An arrow function in a container is an event handler. Nothing
      // in it is rendered, and its strings are state values --
      // `onClick={() => setTab('productivity')}`. A message setter
      // inside one is still caught, by rule 3, on the same line.
      if (/^\{\s*\(?[\w, ]*\)?\s*=>/.test(expr)) continue;
      if (NOT_COPY.test(expr)) continue;
      // The right-hand side of a comparison is an enum value, not copy:
      // in `{mode === 'shrink' ? 'Reduce' : 'Add'}` only the last two
      // are read by anyone.
      expr = expr.replace(/[!=]==?\s*'[^']*'/g, '');
      // Same for the value of a key that names a variant rather than
      // carrying text -- `{ type: 'error', message: 'Chọn một pallet' }`
      // has one string a user reads and one the code branches on.
      const VARIANT_KEY = '\\w*(?:[Ss]tate|[Ss]tatus|[Kk]ind|[Tt]ype)|type|intent|kind|style|currency|month|day|hour|minute|second|weekday|year|timeZone|locale|era|dateStyle|timeStyle|status|variant|severity|level|tone|mode|role|key|name|id|field|direction|align|size|color|colour|pageKey|pageKeys|labelKey|titleKey|to|path|href|route|slug|icon|value|dataIndex|className|active|per_page|fontFamily|textAlign|textTransform|flexDirection|justifyContent|alignItems|alignSelf|whiteSpace|overflow|overflowY|overflowX|cursor|position|display|q|className|active|per_page';
      expr = expr.replace(new RegExp(`\\b(${VARIANT_KEY}):\\s*'[^']*'`, 'g'), '');
      // ...and their array form, e.g. `pageKeys: ['warehouses', 'bins']`.
      expr = expr.replace(new RegExp(`\\b(${VARIANT_KEY}):\\s*\\[[^\\]]*\\]`, 'g'), '');
      // A fallback for a status-ish field is a value, not copy:
      // `row.status || 'completed'`.
      expr = expr.replace(
        /\.\w*(?:[Ss]tatus|[Ss]tate|[Kk]ind|[Tt]ype)\s*\|\|\s*'[^']*'/g,
        '',
      );
      // A curried field setter names a form field, never copy:
      // `onChange={set('skus')}`.
      expr = expr.replace(/\bset\(\s*'[^']*'\s*\)/g, '');
      // A default in a destructured parameter list --
      // `function Editor({ listIdPrefix = 'order' })`. Object literals
      // in JSX assign with `:`, never `=`, so this cannot swallow copy.
      expr = expr.replace(/\b\w+(\[[^\]]*\])?\s*=\s*'[^']*'/g, '');

      for (const s of expr.matchAll(/'([^']{2,})'/g)) add(s[1], 'jsx-expr');
    }

    // 2. String props from the closed list above.
    for (const prop of TEXT_PROPS) {
      // The fourth form is a default in a parameter list --
      // `function Field({ placeholder = 'Gõ SKU…' })`. JSX never writes
      // a prop that way, so for a prop on this list the form can only be
      // a default, and a default placeholder is copy: it is what every
      // caller that passes nothing displays. The expression rule strips
      // the same shape, because there it is far more often
      // `listIdPrefix = 'order'`, which nobody reads.
      const re = new RegExp(`\\b${prop}\\s*=\\s*"([^"]+)"|\\b${prop}\\s*=\\s*\\{\\s*'([^']+)'\\s*\\}|\\b${prop}:\\s*'([^']+)'|\\b${prop}\\s*=\\s*'([^']+)'`, 'g');
      for (const m of scrubbed.matchAll(re)) add(m[1] ?? m[2] ?? m[3] ?? m[4], `prop:${prop}`);
    }

    // 3. Copy handed to a setter or thrown.
    for (const fn of MESSAGE_CALLS) {
      const re = new RegExp(`${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(\\s*'([^']+)'`, 'g');
      for (const m of scrubbed.matchAll(re)) add(m[1], 'message');
    }

    // 3a. A ternary assigned to a variable. `const priorLabel =
    //     isToday ? 'yesterday' : 'prior day'` is copy that reaches the
    //     screen through a prop, and no rule above looks outside JSX
    //     braces. Both branches must be strings, which is what tells a
    //     label apart from `x === 'a' ? fn() : 0`.
    for (const m of own2.matchAll(
      /[=(,]\s*[\w.?[\]()\s!=<>&|'"-]*\?\s*'([^']{2,})'\s*:\s*'([^']{2,})'/g,
    )) {
      // One branch has to read like a phrase. A pair of single words
      // is almost always an enum on its way to the API --
      // `next === 'paused' ? ... : 'active'` -- and reporting those
      // would train everyone to ignore this rule.
      if (!/\s/.test(m[1]) && !/\s/.test(m[2])) continue;
      // ...and a class list is not a phrase either, however many words
      // it has: `cond ? 'tag tag-success' : 'tag tag-info'`.
      const CLASSY = /^[a-z0-9]+([-_ ][a-z0-9]+)*$/;
      if ([m[1], m[2]].some((x) => /[-_]/.test(x) && CLASSY.test(x))) continue;
      add(m[1], 'ternary');
      add(m[2], 'ternary');
    }

    // 4. Template literals that build a sentence around a value. No
    //    dictionary can ever match these, so they are always work.
    // A className is assembled from template literals that read like
    //    words -- `sim2-slot-chip status-${status}` -- and the shape
    //    test cannot reliably tell those from a lowercase sentence.
    //    The attribute itself can: a class template always sits on a
    //    line that says `className=`.
    if (!NOT_COPY.test(own2)) {
      for (const m of own2.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
        const text = m[1].replace(/\$\{[^}]*\}/g, '{}');
        if (FILENAME_SHAPE.test(text)) continue;
        add(text, 'template');
      }
    }
  });

  // One report per distinct string per file: a column label repeated in
  // two tabs is one decision, not two.
  const seen = new Set();
  return out.filter((hit) => {
    const id = `${hit.kind}|${hit.text}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
