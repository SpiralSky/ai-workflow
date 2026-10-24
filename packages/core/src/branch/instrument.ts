import ts from "typescript-api";

const K = ts.SyntaxKind;

/** A text insertion into the original source; `seq` keeps same-offset inserts in push order. */
interface Insert {
  offset: number;
  text: string;
  seq: number;
}

/** Finds the first import/require/import() use in the wrapped source file, if any. */
export function findForbidden(sf: ts.SourceFile): { line: number; message: string } | undefined {
  let found: ts.Node | undefined;
  let what = "";
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n)) (found = n), (what = "import");
    else if (ts.isCallExpression(n) && n.expression.kind === K.ImportKeyword) (found = n), (what = "dynamic import()");
    else if (ts.isMetaProperty(n) && n.keywordToken === K.ImportKeyword) (found = n), (what = "import.meta");
    else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require")
      (found = n), (what = "require()");
    else ts.forEachChild(n, walk);
  };
  walk(sf);
  if (!found) return undefined;
  return {
    line: sf.getLineAndCharacterOfPosition(found.getStart(sf)).line + 1,
    message: `${what} is not allowed: the only external interface is \`tools\`.`,
  };
}

/**
 * Returns the root async arrow function of the wrapped source `(<source>)`, or undefined when the
 * program is not exactly one async arrow function expression.
 */
export function findRoot(sf: ts.SourceFile): ts.ArrowFunction | undefined {
  if (sf.statements.length !== 1) return undefined;
  const st = sf.statements[0];
  if (!ts.isExpressionStatement(st)) return undefined;
  let e: ts.Expression = st.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isArrowFunction(e)) return undefined;
  return e.modifiers?.some((m) => m.kind === K.AsyncKeyword) ? e : undefined;
}

/**
 * Instruments the branch program by text insertions only (never newlines), so line layout is
 * unchanged (core-branch §3). `sf` is the parse of `"(" + source + ")"`; node positions are shifted
 * by one to address `source`.
 * @param sf - wrapped source file
 * @param source - original source (the string the offsets refer to)
 * @param root - the root async arrow function (from {@link findRoot})
 * @returns the instrumented TypeScript source, same line count as `source`
 */
export function instrument(sf: ts.SourceFile, source: string, root: ts.ArrowFunction): string {
  const inserts: Insert[] = [];
  const add = (offset: number, text: string): void => void inserts.push({ offset, text, seq: inserts.length });
  // Wrapper positions are original + 1.
  const start = (n: ts.Node): number => n.getStart(sf) - 1;
  const end = (n: ts.Node): number => n.end - 1;
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const endLine = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.end).line + 1;

  /** Wraps an expression: opening text before it, closing text after it. Open pushed pre-order. */
  const wrapCond = (n: ts.Node, c: ts.Expression, kind: string): (() => void) => {
    add(start(c), `__t.cond(${line(n)}, "${kind}", (`);
    return () => add(end(c), `), ${start(c)}, ${end(c)})`);
  };

  const loopKind = (n: ts.Node): string | undefined =>
    ts.isForStatement(n) ? "for"
    : ts.isForOfStatement(n) ? "for-of"
    : ts.isForInStatement(n) ? "for-in"
    : ts.isWhileStatement(n) ? "while"
    : ts.isDoStatement(n) ? "do"
    : undefined;

  /** Wraps `outer` (the loop, or the labelled statement around it) in enter/try/finally. */
  const wrapLoop = (outer: ts.Node, loop: ts.Node, kind: string): (() => void) => {
    const L = line(loop);
    add(start(outer), `{__t.loopEnter(${L}, "${kind}", ${endLine(loop)});try{`);
    return () => add(end(outer), `}finally{__t.loopExit(${L})}}`);
  };

  const isFunctionLike = (n: ts.Node): boolean =>
    ts.isFunctionLike(n) || ts.isClassStaticBlockDeclaration(n);

  const visit = (n: ts.Node, ownReturn: boolean): void => {
    const closers: (() => void)[] = [];
    const kind = loopKind(n);

    if (ts.isLabeledStatement(n) && !ts.isLabeledStatement(n.parent)) {
      let inner: ts.Statement = n.statement;
      while (ts.isLabeledStatement(inner)) inner = inner.statement;
      const k = loopKind(inner);
      if (k) closers.push(wrapLoop(n, inner, k));
    }
    if (kind) {
      if (!ts.isLabeledStatement(n.parent)) closers.push(wrapLoop(n, n, kind));
      const body = (n as ts.IterationStatement).statement;
      const iter = `__t.loopIter(${line(n)});`;
      if (ts.isBlock(body)) add(body.getStart(sf), iter);
      else {
        add(start(body), `{${iter}`);
        closers.push(() => add(end(body), "}"));
      }
    } else if (ts.isIfStatement(n)) {
      closers.push(wrapCond(n, n.expression, "if"));
    } else if (ts.isConditionalExpression(n)) {
      closers.push(wrapCond(n, n.condition, "ternary"));
    } else if (ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      const colon = n.getChildren(sf).find((c) => c.kind === K.ColonToken)!;
      add(end(colon), `__t.case(${line(n)}, ${start(n)}, ${end(n)});`);
    } else if (ts.isCatchClause(n)) {
      add(n.block.getStart(sf), `__t.cond(${line(n)}, "catch", true, ${start(n)}, ${end(n)});`);
    } else if (ts.isReturnStatement(n) && ownReturn) {
      if (n.expression) {
        add(start(n.expression), `__t.ret(${line(n)}, (`);
        add(end(n.expression), "))");
      } else add(end(n) - (source[end(n) - 1] === ";" ? 1 : 0), ` __t.ret(${line(n)}, undefined)`);
    }

    ts.forEachChild(n, (c) => visit(c, ownReturn && !isFunctionLike(c)));
    for (let i = closers.length - 1; i >= 0; i--) closers[i]();
  };

  if (ts.isBlock(root.body)) ts.forEachChild(root.body, (c) => visit(c, true));
  else {
    add(start(root.body), `__t.ret(${line(root.body)}, (`);
    visit(root.body, false);
    add(end(root.body), "))");
  }
  // Parameters/initialisers of the root may hold nested functions with control flow.
  root.parameters.forEach((p) => visit(p, false));

  inserts.sort((a, b) => a.offset - b.offset || a.seq - b.seq);
  let out = "";
  let at = 0;
  for (const ins of inserts) {
    out += source.slice(at, ins.offset) + ins.text;
    at = ins.offset;
  }
  return out + source.slice(at);
}
