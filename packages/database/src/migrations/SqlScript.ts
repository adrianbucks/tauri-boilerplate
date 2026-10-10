/**
 * Splits a SQLite migration script into executable statements without splitting
 * quoted values, comments, or trigger bodies at their internal semicolons.
 */
export function splitSqlScript(script: string): string[] {
  const statements: string[] = [];
  const statementHead: string[] = [];
  let start = 0;
  let index = 0;
  let hasSqlToken = false;
  let inLineComment = false;
  let inBlockComment = false;
  let quoteEnd: "'" | '"' | "`" | "]" | null = null;
  let isTrigger = false;
  let inTriggerBody = false;
  let caseDepth = 0;

  const resetStatement = (nextStart: number): void => {
    start = nextStart;
    hasSqlToken = false;
    statementHead.length = 0;
    isTrigger = false;
    inTriggerBody = false;
    caseDepth = 0;
  };

  const recordWord = (word: string): void => {
    const normalized = word.toUpperCase();
    if (!inTriggerBody && statementHead.length < 3) {
      statementHead.push(normalized);
      isTrigger =
        (statementHead[0] === "CREATE" && statementHead[1] === "TRIGGER") ||
        (statementHead[0] === "CREATE" &&
          (statementHead[1] === "TEMP" || statementHead[1] === "TEMPORARY") &&
          statementHead[2] === "TRIGGER");
    }

    if (isTrigger) {
      if (!inTriggerBody && normalized === "BEGIN") {
        inTriggerBody = true;
      } else if (inTriggerBody && normalized === "CASE") {
        caseDepth += 1;
      } else if (inTriggerBody && normalized === "END") {
        if (caseDepth > 0) caseDepth -= 1;
        else inTriggerBody = false;
      }
    }
  };

  while (index < script.length) {
    const current = script[index]!;
    const next = script[index + 1];

    if (inLineComment) {
      if (current === "\n" || current === "\r") inLineComment = false;
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
      } else index += 1;
      continue;
    }
    if (quoteEnd !== null) {
      if (current === quoteEnd) {
        if (next === quoteEnd && quoteEnd !== "]") index += 2;
        else {
          quoteEnd = null;
          index += 1;
        }
      } else index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      hasSqlToken = true;
      quoteEnd = current;
      index += 1;
      continue;
    }
    if (current === "[") {
      hasSqlToken = true;
      quoteEnd = "]";
      index += 1;
      continue;
    }
    if (current === ";" && !inTriggerBody) {
      if (hasSqlToken) statements.push(script.slice(start, index + 1));
      resetStatement(index + 1);
      index += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(current)) {
      const wordStart = index;
      index += 1;
      while (index < script.length && /[A-Za-z0-9_]/.test(script[index]!)) index += 1;
      hasSqlToken = true;
      recordWord(script.slice(wordStart, index));
      continue;
    }

    if (!/\s/.test(current)) hasSqlToken = true;
    index += 1;
  }

  if (hasSqlToken) statements.push(script.slice(start));
  return statements;
}
