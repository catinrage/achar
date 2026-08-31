/**
 * A reader for emitted G-code.
 *
 * This is deliberately not the inverse of `Builder`. The verifier's whole
 * value rests on being an independent second opinion: it re-derives what a
 * program does by reading the characters a controller would read, with no
 * knowledge of how the post chose to write them. Sharing a model with the
 * emitter would make the two agree by construction and prove nothing.
 *
 * It parses the SINUMERIK subset these posts actually emit — words, tool
 * selections, cycle calls, `MSG`, `EXTCALL`, variable assignments — and keeps
 * anything it does not recognise as an opaque keyword rather than guessing.
 */

export interface GcodeWord {
  letter: string;
  value: number;
}

export interface GcodeCycle {
  name: string;
  /** Raw argument text, positionally. An omitted argument is an empty string. */
  args: string[];
}

export interface GcodeLine {
  /** 1-based line number within its own file, for reporting. */
  line: number;
  raw: string;
  /** The `N` prefix, when present. */
  number?: number;
  words: GcodeWord[];
  /** `T="END8Z3N"` — the selection, which `M6` later commits. */
  toolSelect?: string;
  /** `EXTCALL "D_drill4.SPF"` — the called file, verbatim. */
  call?: string;
  /** `MSG("F-contour4 , Tool : END8Z3N")` — the text inside the quotes. */
  message?: string;
  cycle?: GcodeCycle;
  comment?: string;
  /** Bare tokens: `SUPA`, `TRANS`, `DEF`, `REAL`, identifiers. */
  keywords: string[];
  isRet: boolean;
}

/**
 * One token of a code line.
 *
 * Order is load-bearing: `T="…"` has to be tried before the bare-word rule or
 * it reads as the word `T` followed by junk, and a cycle call has to be tried
 * before an identifier or `CYCLE81(` loses its arguments.
 */
const TOKEN =
  /(?<msg>MSG\s*\(\s*"(?<msgText>[^"]*)"\s*\))|(?<extcall>EXTCALL\s+"(?<callTarget>[^"]+)")|(?<tool>T\s*=\s*"(?<toolId>[^"]*)")|(?<cycle>(?<cycleName>[A-Z][A-Z0-9_]*)\s*\((?<cycleArgs>[^)]*)\))|(?<assign>(?<assignName>[A-Za-z_]\w*)\s*=\s*(?<assignValue>[^\s,]+))|(?<word>(?<letter>[A-Za-z])\s*(?<value>[-+]?(?:\d+\.?\d*|\.\d+)))|(?<keyword>[A-Za-z_][\w.]*)/g;

/** Splits a line at the first `;` that is not inside a quoted string. */
function splitComment(text: string): { code: string; comment?: string } {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') quoted = !quoted;
    else if (character === ';' && !quoted) {
      return {
        code: text.slice(0, index),
        comment: text.slice(index + 1).trim(),
      };
    }
  }
  return { code: text };
}

export function parseGcodeLine(raw: string, line: number): GcodeLine {
  const result: GcodeLine = {
    line,
    raw,
    words: [],
    keywords: [],
    isRet: false,
  };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return result;

  const numbered = /^N(\d+)\s*(.*)$/.exec(trimmed);
  const body = numbered ? numbered[2] : trimmed;
  if (numbered) result.number = Number(numbered[1]);

  const { code, comment } = splitComment(body);
  if (comment !== undefined) result.comment = comment;

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(code); match !== null; match = TOKEN.exec(code)) {
    const groups = match.groups;
    if (!groups) continue;

    if (groups.msg !== undefined) {
      result.message = groups.msgText ?? '';
    } else if (groups.extcall !== undefined) {
      result.call = groups.callTarget;
    } else if (groups.tool !== undefined) {
      result.toolSelect = groups.toolId ?? '';
    } else if (groups.cycle !== undefined) {
      result.cycle = {
        name: groups.cycleName ?? '',
        args: (groups.cycleArgs ?? '').split(',').map((arg) => arg.trim()),
      };
    } else if (groups.assign !== undefined) {
      // Variable assignments (`_camtolerance=0.003`) are not machine state
      // this verifier models; they are recorded as keywords so nothing is
      // silently dropped.
      result.keywords.push(groups.assignName ?? '');
    } else if (groups.word !== undefined) {
      result.words.push({
        letter: (groups.letter ?? '').toUpperCase(),
        value: Number(groups.value),
      });
    } else if (groups.keyword !== undefined) {
      const keyword = groups.keyword.toUpperCase();
      result.keywords.push(keyword);
      if (keyword === 'RET') result.isRet = true;
    }
  }

  return result;
}

export function parseGcodeFile(source: string): GcodeLine[] {
  return source
    .split(/\r?\n/)
    .map((raw, index) => parseGcodeLine(raw, index + 1));
}

/** The first word with this letter, or undefined. */
export function word(gcodeLine: GcodeLine, letter: string): number | undefined {
  return gcodeLine.words.find((entry) => entry.letter === letter)?.value;
}

/** Every value emitted for this letter on the line, in order. */
export function words(gcodeLine: GcodeLine, letter: string): number[] {
  return gcodeLine.words
    .filter((entry) => entry.letter === letter)
    .map((entry) => entry.value);
}
