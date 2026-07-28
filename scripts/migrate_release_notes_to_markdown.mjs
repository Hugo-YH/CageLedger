#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "src/react/releaseNotesCurrent.ts",
  "src/react/releaseNotesHistory.ts",
  "src/react/releaseNotesArchive.ts",
];
const outputPath = path.join(root, "wiki/更新日志.md");

function readString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  throw new Error(`Expected a string literal, received ${ts.SyntaxKind[node.kind]}.`);
}

function readNote(node) {
  if (!ts.isObjectLiteralExpression(node)) throw new Error("Release note must be an object literal.");
  const properties = new Map();
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))
      properties.set(property.name.text, property.initializer);
  }
  const itemsNode = properties.get("items");
  if (!itemsNode || !ts.isArrayLiteralExpression(itemsNode)) throw new Error("Release note requires an items array.");
  return {
    version: readString(properties.get("version")),
    releasedAt: properties.has("releasedAt") ? readString(properties.get("releasedAt")) : "",
    title: readString(properties.get("title")),
    items: itemsNode.elements.map(readString),
    note: properties.has("note")
      ? readString(properties.get("note"))
      : properties.has("notes")
        ? readString(properties.get("notes"))
        : "",
  };
}

function readReleaseNotes(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const program = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = program.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text.endsWith("RELEASE_NOTES"),
      ),
  );
  if (!declaration || !ts.isVariableStatement(declaration))
    throw new Error(`Unable to locate release notes in ${file}.`);
  const variable = declaration.declarationList.declarations.find((candidate) => ts.isIdentifier(candidate.name));
  if (!variable?.initializer || !ts.isArrayLiteralExpression(variable.initializer)) {
    throw new Error(`Unable to read release note array in ${file}.`);
  }
  return variable.initializer.elements.map(readNote);
}

const notes = sourceFiles.flatMap(readReleaseNotes);
const markdown = [
  "# 更新日志",
  "",
  "本页是 CageLedger 的正式发布记录。每次发布先更新本页，再由构建脚本同步系统内的更新记录。",
  "",
  ...notes.flatMap((note) => [
    `## v${note.version}${note.releasedAt ? ` · ${note.releasedAt}` : ""}`,
    "",
    `### ${note.title}`,
    "",
    ...note.items.map((item) => `- ${item}`),
    ...(note.note ? ["", `> 备注：${note.note}`] : []),
    "",
  ]),
];

fs.writeFileSync(outputPath, `${markdown.join("\n").trim()}\n`, "utf8");
console.log(`Migrated ${notes.length} release notes to ${path.relative(root, outputPath)}.`);
