import { Fragment, type ReactNode } from "react";
/** Safe authored formatting: React text nodes only, no HTML parsing. */
function inline(text: string): ReactNode[] {
  const parts = text.split(
    /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^\s)]+\))/g,
  );
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={index}
          className="rounded bg-muted px-1 py-0.5 font-mono text-sm"
        >
          {part.slice(1, -1)}
        </code>
      );
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      try {
        const url = new URL(link[2]);
        if (!url.username && !url.password)
          return (
            <a
              key={index}
              href={url.href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-primary underline"
            >
              {link[1]}
            </a>
          );
      } catch {}
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
export function LearningText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let code: string[] | null = null;
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-6">
          {list.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList();
      if (code) {
        blocks.push(
          <pre
            key={blocks.length}
            className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm"
          >
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
      continue;
    }
    flushList();
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <p
          role="heading"
          aria-level={heading[1].length + 1}
          key={blocks.length}
          className={
            heading[1].length === 1
              ? "text-xl font-semibold"
              : "text-lg font-semibold"
          }
        >
          {inline(heading[2])}
        </p>,
      );
    } else if (line.trim())
      blocks.push(
        <p
          key={blocks.length}
          className="whitespace-pre-wrap break-words leading-relaxed"
        >
          {inline(line)}
        </p>,
      );
    else blocks.push(<div key={blocks.length} className="h-1" />);
  }
  flushList();
  if (code)
    blocks.push(
      <pre
        key={blocks.length}
        className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm"
      >
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <div className="min-w-0 space-y-2">{blocks}</div>;
}
