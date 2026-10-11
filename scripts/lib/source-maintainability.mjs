import ts from 'typescript';

// Review signals, never CI gates. All files of the same role share a guideline.
const guidelines = {
  composition: 200,
  ui: 800,
  http: 600,
  persistence: 1_000,
  logic: 600,
};
const complexityGuideline = 20;

const sourceRole = (file) => {
  if (/\.d\.ts$/.test(file) || /^(?:shared\/contracts\/|server\/db\/schema\/)/.test(file)) {
    return 'declarations';
  }
  const facade = /^server\/modules\/([^/]+)\/([^/]+)$/.exec(file);
  if (
    /^(?:client\/src\/App\.tsx$|client\/src\/app\/|server\/index\.ts$|server\/app\/|server\/routes\/index\.ts$)/.test(file)
    || (facade && ['index.ts', `${facade[1]}.router.ts`].includes(facade[2]))
  ) return 'composition';
  if (file.startsWith('client/') && file.endsWith('.tsx')) return 'ui';
  if (/^server\/routes\//.test(file) || /\/http\/|\.router\.ts$/.test(file)) return 'http';
  if (/^server\/(?:db|storage|infrastructure)\/|\/infrastructure\//.test(file)) return 'persistence';
  return 'logic';
};

const isStaticData = (node) => {
  if (ts.isLiteralExpression(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
    return isStaticData(node.expression);
  }
  if (ts.isPrefixUnaryExpression(node)) return isStaticData(node.operand);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isStaticData);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name) && isStaticData(property.initializer));
  }
  return false;
};

const isMetadata = (node) => (
  ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)
  || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeNode(node)
  || (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)
);

// AST tokens distinguish real comments from URLs, template strings and JSX text.
// Count occupied lines only; imports, types and literal data do not measure logic.
const countCodeLines = (sourceFile) => {
  const lines = new Set();
  const visit = (node) => {
    if (isMetadata(node)) return;
    if ((ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) && isStaticData(node)) return;
    if (ts.isJsxExpression(node) && !node.expression) return;
    const children = node.getChildren(sourceFile);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const start = node.getStart(sourceFile);
    const text = sourceFile.text.slice(start, node.end);
    const firstLine = sourceFile.getLineAndCharacterOfPosition(start).line;
    text.split(/\r\n|\r|\n/).forEach((part, offset) => {
      if (part.trim()) lines.add(firstLine + offset);
    });
  };
  visit(sourceFile);
  return lines.size;
};

const branchingKinds = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause, ts.SyntaxKind.CatchClause,
]);
const shortCircuitKinds = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const functionComplexity = (body) => {
  let complexity = 1;
  const visit = (node) => {
    // A callback or local function is assessed separately from its parent.
    if (ts.isFunctionLike(node) || isMetadata(node)) return;
    if (branchingKinds.has(node.kind)
      || (ts.isBinaryExpression(node) && shortCircuitKinds.has(node.operatorToken.kind))) {
      complexity += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return complexity;
};

export const reviewMaintainability = (file, source) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const warnings = [];
  const role = sourceRole(file);
  const guideline = guidelines[role];
  if (guideline) {
    const lines = countCodeLines(sourceFile);
    if (lines > guideline) {
      warnings.push({
        file, line: 0, value: lines, guideline,
        message: `${file}: ${lines} code lines (${role} review guideline: ${guideline}); review responsibilities before splitting`,
      });
    }
  }
  const visit = (node) => {
    if (isMetadata(node)) return;
    if (ts.isFunctionLike(node) && node.body) {
      const complexity = functionComplexity(node.body);
      if (complexity > complexityGuideline) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const name = node.name ?? (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) ? node.parent.name : undefined);
        warnings.push({
          file, line, value: complexity, guideline: complexityGuideline,
          message: `${file}:${line}: ${name?.getText(sourceFile) ?? '<anonymous>'} has cyclomatic complexity ${complexity} (review guideline: ${complexityGuideline}); simplify branching`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return warnings;
};
