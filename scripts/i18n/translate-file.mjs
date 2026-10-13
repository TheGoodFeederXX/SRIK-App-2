#!/usr/bin/env node
/**
 * Translates one file's user-facing strings in a single pass.
 *
 * WHY NOT BY HAND. There are 3,300 strings across 393 files. Doing them one at a time by hand
 * is not finishing; it is starting 393 times. What IS mechanical is the DETECTION and the
 * REWRITE: find a string that is displayed, give it a stable key, replace it. What is NOT
 * mechanical is choosing the Malay. So this tool takes the translations as a MAP — the Malay
 * is still written deliberately, per file — and does the fiddly part.
 *
 * WHAT IT REFUSES. A bare word in JSX (`<span>Present</span>`) is a label. The same word in a
 * comparison (`status === 'Present'`) or as an object key is DATA, and translating it would
 * break behaviour. So it only rewrites:
 *   - JSX text nodes
 *   - values of display props (label, title, placeholder, message, header, description, alt…)
 *   - toast.success/error(...) and window.confirm(...) arguments
 *   - <option> label/value text inside JSX
 * It never touches comparisons, object keys, navigateTo ids, or className.
 *
 * Usage: node scripts/i18n/translate-file.mjs <file> <json-map> [--dry]
 *   json-map: { "English text": "Malay text", ... }
 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const mapPath = process.argv[3];
const dry = process.argv.includes('--dry');
if (!file || !mapPath) {
    console.error('usage: translate-file.mjs <file> <json-map> [--dry]');
    process.exit(1);
}

const MAP = JSON.parse(readFileSync(mapPath, 'utf8'));
let src = readFileSync(file, 'utf8');
const used = new Set();
const missed = new Set(Object.keys(MAP));

/** A stable camelCase key from the English text. */
const toKey = (text) => {
    const clean = text.replace(/[^A-Za-z0-9 ]/g, ' ').trim().replace(/\s+/g, ' ');
    const words = clean.split(' ');
    return words
        .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
        .join('')
        .slice(0, 46) || 'text';
};

// Every key is namespaced by the file it came from, so two screens can use the same English
// word with different Malay and not collide. Derived from the file name: components/student/
// StudentDashboard.tsx -> 'studentDashboard'.
const NAMESPACE = (() => {
    const base = file.split('/').pop().replace(/\.tsx?$/, '');
    return base[0].toLowerCase() + base.slice(1);
})();

const keys = new Map(); // English text -> chosen key

function keyFor(english) {
    if (keys.has(english)) return keys.get(english);
    let base = toKey(english);
    let key = base, n = 2;
    const taken = new Set(keys.values());
    while (taken.has(key)) key = `${base}${n++}`;
    const full = `${NAMESPACE}.${key}`;
    keys.set(english, full);
    return full;
}

const changes = [];

/**
 * Regions of the file where a text-match would be WRONG, replaced by inert placeholders and
 * put back afterwards.
 *
 * WHY. The JSX rule looks for `>Some Words<`. That pattern also occurs INSIDE a template
 * literal that generates HTML — for example a PDF transcript built as `<td>No published
 * results yet.</td>`. That is a generated string, and rewriting it destroyed the template and
 * broke the file. Template literals and comments are not display text in the sense this tool
 * means, so they are protected.
 */
const protected_ = [];
// The placeholder is plain ASCII on purpose. An earlier version used a NUL byte, which leaked
// into the output and made three files "binary" to every tool that read them.
const protect = (text) => {
    // The marker uses characters that do not occur in TypeScript source: a private-use
    // codepoint bracket. An earlier ASCII marker appeared inside a comment that had been
    // written by a previous run, producing a token inside a token that never restored.
    const token = `\uE000${protected_.length}\uE001`;
    protected_.push(text);
    return token;
};
// A TEMPLATE LITERAL whose literal text is a message we know:
// `\`Could not load the register: ${err.message}\``. The TEXT is translated and the
// INTERPOLATION is kept exactly as written, so the value still reaches the sentence. The label is
// looked up with a trailing period added (`...register.`), because the dictionary holds the
// sentence form; the template drops the period when it appends a value. The whole template is left
// alone if the label is unknown, which keeps SQL, filenames and HTML markup untouched. This must
// run BEFORE the protection step below, which hides templates from the later rules.
src = src.replace(/`([^`$]{2,120}?)\s*:\s*(\$\{[^`]*\})`/g, (full, lead, expr) => {
    const key = MAP[lead] ? lead : (MAP[lead + '.'] ? lead + '.' : null);
    if (!key) return full;
    used.add(key); missed.delete(key);
    changes.push(['template label', key]);
    return '`' + `\${t('${keyFor(key)}')}: ${expr}` + '`';
});
src = src.replace(/`(?:[^`\\]|\\.)*`/gs, protect);           // template literals
// Block and JSX comments: protect each physical line on its own, so every newline stays exactly
// where it was. Collapsing a multi-line comment removed newlines, which merged a component
// signature onto a code line and stopped the hook from being inserted.
src = src.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.split('\n').map((l) => protect(l)).join('\n'));
// Line comments: require start-of-line or whitespace before `//`, so a URL inside a string
// (`https://…`) is not mistaken for a comment.
// Keep the newline OUTSIDE the protected region. Protecting the whole match swallowed the
// line break, which glued 26 lines together and stopped `addHooks` from recognising a component
// head — so a screen with `t(` calls got no hook and did not compile.
// A trailing `// comment` used to be protected as a token at the END of its line, so a component
// head stopped ending in `=> {` and no hook was inserted — leaving a file that did not compile.
// Moving the comment's own text onto a line of its own keeps every CODE line exactly as it was.
// A line comment that FOLLOWS code on the same line (`illustration = "x.png" // why`) also has to
// be protected, and it must not leave the code line altered. It is protected from the `//` to the
// end of the line, with the code before it untouched, so the line still ends in whatever it ended
// in — which is what lets a component head be recognised. The `//` must not be inside a string,
// so the match requires a non-quote character (or start of line) before it.
src = src.replace(/(^|\n)([ \t]*)(\/\/[^\n]*)/g, (_m, lead, indent, c) => `${lead}${indent}${protect(c)}`);
src = src.replace(/([^:\/])([ \t]*)(\/\/[^\n]*)$/gm, (_m, before, gap, c) => `${before}${gap}${protect(c)}`);

// 1. JSX text nodes.
src = src.replace(/>(\s*)([A-Z][^<>{}]{1,90}?)(\s*)</g, (full, pre, text, post) => {
    const t = text.trim();
    if (!MAP[t]) return full;
    used.add(t); missed.delete(t);
    changes.push(['jsx', t]);
    return `>${pre}{t('${keyFor(t)}')}${post}<`;
});

// 2. Display props.
const PROPS = ['label', 'title', 'placeholder', 'message', 'description', 'header', 'subtitle', 'alt', 'confirmText', 'emptyMessage', 'helperText'];
for (const prop of PROPS) {
    const re = new RegExp(`\\b${prop}=(["'])([^"']{1,90})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([prop, text]);
        return `${prop}={t('${keyFor(text)}')}`;
    });
    // Also `{prop}="X"` inside objects: prop: 'X'
    const re2 = new RegExp(`\\b${prop}:\\s*(['"])([^'"]{1,90})\\1`, 'g');
    src = src.replace(re2, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([`${prop}:`, text]);
        return `${prop}: t('${keyFor(text)}')`;
    });
}

// 3. Toast and confirm calls — these are messages to the reader, always display.
for (const fn of ['toast.success', 'toast.error', 'toast', 'window.confirm', 'confirm']) {
    const re = new RegExp(`\\b${fn.replace('.', '\\.')}\\(\\s*(['"])([^'"]{2,200})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([fn, text]);
        return full.replace(`${q}${text}${q}`, `t('${keyFor(text)}')`);
    });
}

// 3a. TOAST MESSAGES. `toast.success('...')`, `toast.error('...')`, `toast.loading('...')` all
// render their argument to the reader, and `badge="..."` is a display prop on a local component.
// Both were missed by the prop rules because `toast.` is not a JSX attribute.
for (const fn of ['success', 'error', 'loading', 'message', 'info']) {
    const re = new RegExp(`\\btoast\\.${fn}\\(\\s*([\"'])([^\"']{1,90})\\1`, 'g');
    src = src.replace(re, (full, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push([`toast.${fn}`, text]);
        return full.replace(`${q}${text}${q}`, `t('${keyFor(text)}')`);
    });
}
// `badge="Subjects"` — a display prop on a local card component.
src = src.replace(/\bbadge=(["'])([^"']{1,60})\1/g, (full, q, text) => {
    if (!MAP[text]) return full;
    used.add(text); missed.delete(text);
    changes.push(['badge', text]);
    return `badge={t('${keyFor(text)}')}`;
});
// A literal FALLBACK after `||` inside JSX: `{student.name || 'Student Profile'}`. The literal is
// what the reader sees when the real value is missing, so it must follow the language.
src = src.replace(/(\{\s*[\w$.?[\]]+\s*\|\|\s*)(['"])([^'"]{1,90})\2(\s*\})/g,
    (full, pre, q, text, post) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push(['jsx fallback', text]);
        return `${pre}t('${keyFor(text)}')${post}`;
    });

// 3a-2. A LITERAL FALLBACK INSIDE A CALL: `toast.error(e?.message || 'Could not load history')`.
// The literal is what the reader sees when the real error carries no message.
src = src.replace(/\b(toast\.\w+\s*\(\s*)([^,)\n]{1,80}?\s*\|\|\s*)(['"])([^'"]{1,90})\3/g,
    (full, pre, mid, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push(['toast fallback', text]);
        return `${pre}${mid}t('${keyFor(text)}')`;
    });
// The same shape in an assignment: `const who = x || 'Unknown'` where `who` is rendered.
src = src.replace(/(\b(?:const|let|var)\s+\w+\s*=\s*[^;\n]{1,80}?\s*\|\s*\|\s*)(['"])([^'"]{1,90})\2/g,
    (full, pre, q, text) => {
        if (!MAP[text]) return full;
        // Only when the literal is a short label, never a URL or a data token.
        if (/^(?:https?:|\/|\.|[a-z_]+$)/.test(text)) return full;
        used.add(text); missed.delete(text);
        changes.push(['|| fallback', text]);
        return `${pre}t('${keyFor(text)}')`;
    });

// 3a-3. A MULTI-LINE CONCATENATION that forms ONE sentence:
// `'First part ' + 'second part.'`. Joined and translated as a single string, because
// translating the fragments separately would give the translator no whole sentence to work with.
src = src.replace(/(['"])((?:[^'"\n]|\\.){1,200}?)\1\s*\+\s*\n\s*(['"])((?:[^'"\n]|\\.){1,200}?)\3/g,
    (full, q1, a, q2, b) => {
        const whole = a + b;
        if (!MAP[whole]) return full;
        used.add(whole); missed.delete(whole);
        changes.push(['concat', whole]);
        return `t('${keyFor(whole)}')`;
    });

// 3a-4. A LIST OF DISPLAY INSTRUCTIONS RETURNED FOR RENDERING:
// `return ['Tap the Share button in Safari.', "Tap 'Add to Home Screen'."];`
// Each element is a sentence shown to the reader. Two restrictions keep this SAFE:
//   - the list must be RETURNED by the current component (`return [...]`), so a module-level
//     constant (where no `t` exists) and a list assigned to a typed data variable are both left
//     alone;
//   - every element must be a sentence present in the dictionary, so a list of view IDs or status
//     codes is never touched.
// Quote styles are matched independently: a double-quoted element may contain apostrophes.
src = src.replace(/(\breturn\s*)\[([^\[\]]{4,600})\]/g, (full, kw, inner) => {
    const parts = inner.match(/"[^"]{2,140}"|'[^']{2,140}'/g);
    if (!parts || parts.length < 2) return full;
    const texts = parts.map((x) => x.slice(1, -1));
    if (!texts.every((x) => MAP[x])) return full;
    texts.forEach((x) => { used.add(x); missed.delete(x); changes.push(['array', x]); });
    return `${kw}[${texts.map((x) => `t('${keyFor(x)}')`).join(', ')}]`;
});

// 3a-5. A LITERAL ERROR FALLBACK after `??` in a toast: `toast.error(result.error ?? 'Could not
// save the changes.')`. Same reasoning as the `||` form above.
src = src.replace(/\b(toast\.\w+\s*\(\s*)([^,)\n]{1,80}?\s*\?\?\s*)(['"])([^'"]{1,90})\3/g,
    (full, pre, mid, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push(['toast ??', text]);
        return `${pre}${mid}t('${keyFor(text)}')`;
    });
// An `Error`-guarded toast: `toast.error(err instanceof Error ? err.message : 'Something ...')`.
src = src.replace(/\b(toast\.\w+\s*\(\s*)(err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*)(['"])([^'"]{1,110})\3/g,
    (full, pre, mid, q, text) => {
        if (!MAP[text]) return full;
        used.add(text); missed.delete(text);
        changes.push(['toast err', text]);
        return `${pre}${mid}t('${keyFor(text)}')`;
    });

// 3b. A JSX TERNARY that CHOOSES BETWEEN TWO LITERALS: `{cond ? 'Class Report Cards' : 'Report
// Cards'}`. Whichever branch runs, a literal is rendered, so both must be translated. The
// condition is left untouched.
src = src.replace(/\{\s*([^{}?]{1,60}?)\s*\?\s*(['"])([^'"]{1,90})\2\s*:\s*(['"])([^'"]{1,90})\4\s*\}/g,
    (full, cond, q1, a, q2, b) => {
        if (!MAP[a] || !MAP[b]) return full;
        used.add(a); used.add(b); missed.delete(a); missed.delete(b);
        changes.push(['ternary', a, b]);
        return `{${cond} ? t('${keyFor(a)}') : t('${keyFor(b)}')}`;
    });

// 4. The DISPLAY TITLE passed to navigateTo. `navigateTo('view', 'My Assignments')` — the
// second argument becomes the header title the reader sees. This is display text and must follow
// the chosen language, but it is a positional ARGUMENT, not a prop, so the rules above miss it.
// Only the SECOND argument is touched: the first is a view ID the router matches on, and
// translating it would break navigation.
// `replaceView` and `useDashboardRouting` carry the SAME shape: (viewId, displayTitle). The
// title reaches the header/breadcrumb, so it must follow the language too. Grouped into one
// alternation so a single rule covers every function that navigates by (id, title).
src = src.replace(/\b(?:navigateTo|replaceView|useDashboardRouting)\s*\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]{1,90})\3/g,
    (full, q1, view, q2, title) => {
        if (!MAP[title]) return full;
        used.add(title); missed.delete(title);
        changes.push(['navigateTo title', title]);
        return full.replace(`${q2}${title}${q2}`, `t('${keyFor(title)}')`);
    });

if (changes.length === 0) {
    console.log(`  tiada perubahan: ${file}`);
    process.exit(0);
}

// Add the hook where it is MISSING. This must be checked per component body, not per file: a
// file often has several small components, and one of them already using the hook said nothing
// about the others. Assuming otherwise produced `t` calls with no `t` in scope — caught by tsc.
/**
 * Inserts `const { t } = useTranslation();` into every component that uses `t` without one.
 *
 * THREE THINGS MADE THIS HARD, AND EACH IS HANDLED EXPLICITLY:
 *
 *  1. A file here holds many small components, each with its own scope, so the hook is decided
 *     COMPONENT BY COMPONENT. Assuming one hook per file produced `t` with no `t` in scope.
 *  2. The characters `{` and `}` appear in the type annotation as well as the body. In
 *     `React.FC<{ ... }> = (...) => {` the `}` closes the TYPE and cancels the `{` from the
 *     same line, so counting from the line start reads balance zero and gives up at once.
 *     Counting from the LAST `{` on the line starts inside the body, which is what is needed.
 *  3. Some screens have a CONCISE body — `=> (` with no block at all. A hook cannot live there,
 *     so the body is converted to `=> { ... return ( ... ); };` first.
 *
 * Anything it cannot do confidently is left alone rather than guessed at.
 */
function addHooks(fileSource) {
    let lines = fileSource.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Only a body opening ends this way. `=> {` may follow a long multi-line generic.
        const trimmed = line.trim();
        // A control-flow statement also ends with `{` — `switch (x) {`, `if (y) {`, `else {`.
        // These are NOT component bodies, and putting a hook inside one is invalid.
        const isControlFlow = /^(?:switch|if|else|for|while|do|try|catch|finally)\b/.test(trimmed)
            || /^\}\s*(?:else|catch|finally)\b/.test(trimmed);
        const opensBlock = !isControlFlow && /(?:=>|\))\s*\{\s*$/.test(trimmed);
        const opensParen = /=>\s*\(\s*$/.test(trimmed);

        if (!opensBlock && !opensParen) { out.push(line); continue; }

        // Confirm a COMPONENT is being defined. The name must be on the OPENING line itself, or
        // on a line just above that is still part of the same signature (a multi-line generic
        // ends with `,` or `>` or `}> =`). Looking further back than that found an unrelated
        // `const Something` and mistook an inline `.map(...)` callback for a component.
        const nameOnLine = /^(?:export\s+(?:default\s+)?)?(?:const|function)\s+([A-Z]\w*)\b/;
        const head = line.trim();
        let name = (head.match(nameOnLine) || [])[1] || null;
        // A fallback or callback value is NOT a component: `const X = y || (() => {`,
        // `items.map((v) => {`. Both open a body but define no component.
        // A line that assigns from an expression is a VALUE. It opens a body but defines no
        // component, however it is named: `const X = y || (() => {`, `const X = a.map(v => {`.
        // A COMPONENT assigns an arrow function to a name: `const X: Type = (...) => {`.
        // A VALUE assigns an expression: `const X = y || (() => {`, `const X = a.map(v => {`.
        // The difference is what follows the `=` — an arrow function is a component, and any
        // other expression (a `||` fallback, a call, an array access) is not. Requiring this
        // to be about what FOLLOWS the `=` is what stops `React.FC = () => {` being rejected.
        // The assignment `=` is the one that is NOT part of an arrow `=>`. Using the first `=` on
        // the line picked up the `=>` inside a type annotation
        // (`navigateTo: (view: string) => void`), which made the component look like a value.
        const assignAt = head.search(/=(?!=|>)/);
        const afterAssign = assignAt === -1 ? '' : head.slice(assignAt + 1);
        const isArrowComponent = /^\s*(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>/.test(afterAssign);
        const assignsExpression = head.includes('=')
            && !isArrowComponent
            && (/\|\||&&|\?\./.test(afterAssign)
                || /\.(?:map|filter|forEach|reduce|sort)\s*\(/.test(afterAssign)
                || /^\s*\(\s*\)\s*=>/.test(afterAssign));
        // A callback opened with `(` and closed with `)` — `.map(...)`, `.filter(...)`,
        // `(() => ...)` — is a value wherever it appears, including inside JSX braces.
        const opensCallback = /\.(?:map|filter|forEach|reduce|sort|flatMap)\s*\(/.test(head)
            || /^\(\s*\)\s*=>/.test(head)
            || /\|\|\s*\(/.test(head);
        const looksLikeValue = assignsExpression || opensCallback;
        if (looksLikeValue) name = null;
        if (!name && !looksLikeValue) {
            for (let k = i - 1; k >= 0 && k > i - 40; k--) {
                const prev = lines[k].trim();
                const m = prev.match(nameOnLine);
                if (m) { name = m[1]; break; }
                // Only a signature CONTINUATION may sit between the name and the opening brace.
                // A generic type spans several lines and its members end in `;` or `,`, so those
                // are continuations too; a statement keyword or a closing brace is not.
                // A protected comment line is a bare token, which must also count as a
                // continuation — otherwise a JSDoc line inside a generic type ends the search.
                // A destructured prop with a default ends in a QUOTE (`newChatView = 'newChat'`),
                // and one with a type ends in a word. Both are continuations.
                const isContinuation = /[,>{=(]\s*$/.test(prev)
                    || (/;\s*$/.test(prev) && !/^(?:const|let|var|return|import|export\s+const)\b/.test(prev))
                    || /^\s*\/?\*/.test(prev)
                    || /^\uE000\d+\uE001$/.test(prev.trim())
                    || prev === ''
                    || /[\w$]\s*=\s*(?:'[^']*'|"[^"]*"|`[^`]*`|\d+|true|false|null)\s*$/.test(prev)
                    || /^[\w$]+\s*:\s*.+$/.test(prev)
                    // A bare destructured prop: `studentId`, `isOpen`. A single identifier with
                    // no assignment, punctuation or keyword is a prop, not a statement.
                    || /^[\w$]+$/.test(prev)
                    // A default value followed by an inline `// comment` (already protected).
                    || /^[\w$]+\s*=\s*.*\uE000\d+\uE001$/.test(prev);
                if (!isContinuation) break;
            }
        }
        // A CLASS component cannot use hooks, so adding one produces invalid code. Leave class
        // components alone entirely; their text is translated by hand with the i18n instance.
        const isClassComponent = /class\s+\w+\s+extends\s+(?:React\.)?(?:Component|PureComponent)/.test(fileSource);
        if (isClassComponent) { out.push(line); continue; }
        if (!name) { out.push(line); continue; }

        // The body's extent, for the uses/has decision only. Count from the body's own brace.
        // For a CONCISE body (`=> (`) the body starts AFTER this line, so the brace search must not
        // run at all: the line carries a `{` inside its type annotation (`React.FC<{ ... }>`), and
        // lastIndexOf('{') would land there and collapse the range to nothing.
        const from = opensBlock ? line.lastIndexOf('{') : line.length;
        let depth = 0, j = i, body = '';
        for (; j < lines.length; j++) {
            const chunk = j === i ? (opensBlock ? line.slice(from) : '') : lines[j];
            // RESOLVE placeholders while measuring. A template literal is protected, and the
            // template rule inserts a `t(...)` call INTO it before protection — so without this
            // the body looked as though it used no `t`, no hook was added, and `t` was undefined.
            const visible = chunk.replace(/\uE000(\d+)\uE001/g, (_m, n) => protected_[Number(n)] ?? '');
            body += `${visible}\n`;
            depth += (chunk.match(/\{/g) || []).length - (chunk.match(/\}/g) || []).length;
            if (opensBlock && depth <= 0) break;
            if (opensParen && (lines[j].trim() === ');' || lines[j].trim() === ')')) break;
        }

        const usesT = /(^|[^\w.$])t\(/.test(body);
        // Match the HOOK CALL, not the word `useTranslation`. The import statement contains the
        // same word, and a body range that happened to include it made a component look as
        // though it already had a hook — so the hook was never added and `t` stayed undefined.
        const hasT = /const\s*\{\s*t\s*\}\s*=\s*useTranslation\s*\(\s*\)/.test(body);
        if (!usesT || hasT) { out.push(line); continue; }

        if (opensBlock) {
            out.push(line);
            out.push('    const { t } = useTranslation();');
        } else {
            // Convert the concise body into a block body, then close it at the matching `);`.
            out.push(line.replace(/=>\s*\(\s*$/, '=> {\n    const { t } = useTranslation();\n    return ('));
            // Emit the body lines, replacing the terminating `);` with `);\n};`.
            for (let k = i + 1; k <= j; k++) {
                if (k === j) out.push(lines[k].replace(/^\s*\)\s*;?\s*$/, '    );\n};'));
                else out.push(lines[k]);
            }
            i = j;
        }
    }
    return out.join('\n');
}

if (!dry) {
    if (/^import .* from 'react';/m.test(src)) {
        if (!/react-i18next/.test(src)) {
            src = src.replace(/^(import .* from 'react';)/m, "$1\nimport { useTranslation } from 'react-i18next';");
        }
    } else if (!/react-i18next/.test(src)) {
        src = `import { useTranslation } from 'react-i18next';\n${src}`;
    }
}


// Put the protected regions back EXACTLY as they were. Anything matched inside them was never
// recorded as a change, so no key was created for it either.
// The hook pass runs AFTER the replacements (so `t(` calls exist to be found) and BEFORE the
// protected regions come back (comments and template literals never hold a component body, and
// their placeholders keep the line structure intact).
src = addHooks(src);

// Restore REPEATEDLY: a protected region's own text may itself contain a marker from an earlier
// pass, and one sweep would leave it behind.
for (let pass = 0; pass < 5 && /\uE000\d+\uE001/.test(src); pass++) {
    src = src.replace(/\uE000(\d+)\uE001/g, (_, n) => protected_[Number(n)] ?? '');
}

const out = { file, changes: changes.length, keys: Object.fromEntries(keys), unused: [...missed] };
if (dry) {
    console.log(JSON.stringify(out, null, 2));
} else {
    writeFileSync(file, src);

    // Write the keys into BOTH locale files. Skipping this was a real defect: the screen then
    // displayed `studentDashboard.yourFocus` to the reader, which is worse than English because
    // it means nothing at all. The Malay comes from the map; the English is the original text,
    // which is exactly right — the source strings were already English.
    if (keys.size) {
        for (const [localePath, isMalay] of [['lib/i18n/locales/ms.json', true], ['lib/i18n/locales/en.json', false]]) {
            const bundle = JSON.parse(readFileSync(localePath, 'utf8'));
            const group = NAMESPACE;
            bundle[group] = bundle[group] || {};
            for (const [english, fullKey] of keys) {
                const shortKey = fullKey.slice(group.length + 1);
                bundle[group][shortKey] = isMalay ? MAP[english] : english;
            }
            writeFileSync(localePath, `${JSON.stringify(bundle, null, 2)}\n`);
        }
    }
    console.log(`${file}: ${changes.length} diganti, ${keys.size} kunci ditulis, ${missed.size} tidak dijumpai`);
    if (missed.size) console.log('  tidak dijumpai:', [...missed].slice(0, 6));
}
