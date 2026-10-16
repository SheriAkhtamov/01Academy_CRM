import { MessageCircle } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { Label } from "@/components/ui/label";
import { Sheet, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PortalHelp } from "../lms/communication";
import {
  PortalFormScope,
  portalGrantFingerprint,
  usePortal,
  usePortalFormScope,
} from "./context";
import { PortalSelect } from "./controls";
import { PortalEmpty, PortalSheetContent } from "./ui";

export function PortalMessagesSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const scope = usePortalFormScope();
  const { account, subject, subjects, allowed, selectSubject } = usePortal();
  const recipients = subjects.filter((item) =>
    item.permissions.includes("communication.create"),
  );
  const selectedRecipient = recipients.find((item) => item.linkId === subject?.linkId);
  return (
    <PortalFormScope id={scope.id}>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (value) onOpenChange(true);
          else scope.guarded(() => onOpenChange(false));
        }}
      >
        <PortalSheetContent
          aria-describedby={undefined}
          side="right"
          className="flex w-[min(960px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-4xl"
        >
          <SheetHeader className="border-b border-border p-5 pr-12">
            <SheetTitle className="flex items-center gap-2">
              <MessageCircle />
              {t("messages")}
            </SheetTitle>
          </SheetHeader>
          {open && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-6">
              {recipients.length > 0 && (subjects.length > 1 || !selectedRecipient) && (
                <div className="space-y-2">
                  <Label htmlFor="messages-student">{t("student")}</Label>
                  <PortalSelect
                    id="messages-student"
                    value={selectedRecipient ? String(selectedRecipient.linkId) : ""}
                    onValueChange={(value) => selectSubject(Number(value))}
                    options={[
                      { value: "", label: t("selectStudent") },
                      ...recipients.map((item) => ({
                        value: String(item.linkId),
                        label: item.studentName,
                      })),
                    ]}
                  />
                </div>
              )}
              {allowed("communication.create") ? (
                <PortalHelp
                  key={`${account?.id}:${subject?.linkId}:${subject ? portalGrantFingerprint([subject]) : "family"}`}
                  embedded
                />
              ) : (
                <PortalEmpty labelKey="portalUnavailable" />
              )}
            </div>
          )}
        </PortalSheetContent>
      </Sheet>
    </PortalFormScope>
  );
}
