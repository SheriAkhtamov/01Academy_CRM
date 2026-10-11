import { useRef } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bold, Heading2, List, Code } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
export function StaffEditor({
  id,
  value,
  onChange,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLTextAreaElement>(null);
  const insert = (before: string, after = "") => {
    const textarea = input.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    onChange(
      value.slice(0, start) + before + selected + after + value.slice(end),
    );
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  };
  const tools: Array<{
    key: TranslationKey;
    icon: typeof Bold;
    before: string;
    after?: string;
  }> = [
    { key: "lmsStaffHeading", icon: Heading2, before: "## " },
    { key: "lmsStaffBold", icon: Bold, before: "**", after: "**" },
    { key: "lmsStaffList", icon: List, before: "- " },
    { key: "lmsStaffCode", icon: Code, before: "```\n", after: "\n```" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {tools.map((tool, index) => (
          <Button
            key={index}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t(tool.key)}
            onClick={() => insert(tool.before, tool.after)}
          >
            <tool.icon className="h-4 w-4" />
          </Button>
        ))}
      </div>
      <Textarea
        ref={input}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        rows={8}
      />
    </div>
  );
}
