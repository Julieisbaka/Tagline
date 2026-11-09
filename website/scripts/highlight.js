const tokenPattern =
  /\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|--?[a-zA-Z][\w-]*|\b(?:true|false|null|undefined|const|let|var|function|return|new|if|else|await|async|export|import|from|as|version|name|mode|colors|variables|settings|metadata|author|description|license|tags|accessibility|contrast|colorVision|reducedMotion|notes|id|type|default|min|max|unit|variable|sheets|rows|columns|title|mimeType|contentBase64|expectedAccount|secret|action|ok|code|message|account|document|displayName|url)\b|-?\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$.-]*(?=\s*:)|[A-Za-z_$][\w$.-]*|[{}[\]():,]/g;

const commandNames = new Set(["npm", "npx", "node", "python", "git", "cd", "mkdir"]);
const keywords = new Set([
  "const", "let", "var", "function", "return", "new", "if", "else", "await",
  "async", "export", "import", "from", "as"
]);
const booleans = new Set(["true", "false", "null", "undefined"]);

function tokenType(token, language, source, end) {
  if (token.startsWith("//") || (token.startsWith("#") && language !== "json")) return "comment";
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
    return /^\s*:/.test(source.slice(end)) ? "key" : "string";
  }
  if (/^-?\d/.test(token)) return "number";
  if (token.startsWith("-")) return "flag";
  if (/^[{}[\]():,]$/.test(token)) return "punctuation";
  if (booleans.has(token)) return "boolean";
  if (keywords.has(token)) return "keyword";
  if (language === "bash" && commandNames.has(token)) return "command";
  if (/^[A-Za-z_$][\w$.-]*$/.test(token) && /^\s*:/.test(source.slice(end))) return "key";
  return "";
}

for (const code of document.querySelectorAll("pre code[class*='language-']")) {
  const language = code.className.match(/language-([\w-]+)/)?.[1] || "text";
  const source = code.textContent;
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    if (start > cursor) fragment.append(source.slice(cursor, start));

    const type = tokenType(token, language, source, end);
    if (type) {
      const span = document.createElement("span");
      span.className = `token-${type}`;
      span.textContent = token;
      fragment.append(span);
    } else {
      fragment.append(token);
    }
    cursor = end;
  }

  if (cursor < source.length) fragment.append(source.slice(cursor));
  code.replaceChildren(fragment);
}
