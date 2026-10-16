import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/hooks/useTranslation";
import { usePortal } from "./context";

export function PortalContextControl() {
  const { t } = useTranslation();
  const { subject, subjects, selectSubject } = usePortal();
  const label = (
    <>
      {subject && (
        <Avatar aria-hidden="true" className="h-8 w-8">
          <AvatarFallback className="text-sm">
            {subject.studentName.trim().split(/\s+/).slice(0, 2)
              .map((part) => Array.from(part)[0] ?? "").join("").toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 truncate text-sm">
        {subject?.studentName ?? t("portalFamily")}
      </span>
    </>
  );
  if (subjects.length < 2)
    return <div className="flex min-h-10 min-w-0 items-center gap-2">{label}</div>;
  const personal = subjects.filter((item) => item.kind === "self");
  const representatives = subjects.filter((item) => item.kind === "representative");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto min-w-0 max-w-full justify-start gap-2 px-2 py-1">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="portal-ui max-h-[60dvh] overflow-auto">
        {personal.length > 0 && (
          <>
            <DropdownMenuLabel>{t("portalMyLearning")}</DropdownMenuLabel>
            {personal.map((item) => (
              <DropdownMenuItem key={item.linkId} onSelect={() => selectSubject(item.linkId)}>
                {item.studentName}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {personal.length > 0 && representatives.length > 0 && <DropdownMenuSeparator />}
        {representatives.length > 0 && (
          <>
            <DropdownMenuLabel>{t("portalChildren")}</DropdownMenuLabel>
            {representatives.length > 1 && (
              <DropdownMenuItem onSelect={() => selectSubject(null)}>
                {t("portalFamilyOverview")}
              </DropdownMenuItem>
            )}
            {representatives.map((item) => (
              <DropdownMenuItem key={item.linkId} onSelect={() => selectSubject(item.linkId)}>
                {item.studentName}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
