import { toastError } from "@quieter/app/lib/error-toast";
import { Button, LinkButton } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quieter/ui/dialog";
import { Surface } from "@quieter/ui/surface";
import { toast } from "@quieter/ui/toast";

export const TemplateCodeSetup = ({
  organizationId,
  templateId,
}: {
  organizationId: string;
  templateId?: string;
}) => {
  const commands = [
    "vp add quieter react react-dom react-email @react-email/render",
    "vp exec quieter templates init",
    'export QUIETER_MAIL_API_KEY="your-key"',
    ...(templateId
      ? [`vp exec quieter templates link welcome ${templateId}`]
      : []),
    "vp exec quieter templates dev",
  ].join("\n");
  const copyCommands = async () => {
    try {
      await navigator.clipboard.writeText(commands);
      toast.success("Setup commands copied.");
    } catch (error) {
      toastError(error, {
        boundary: "template-code-setup",
        fallback: "Could not copy commands. Please try again.",
      });
    }
  };
  return (
    <Dialog>
      <DialogTrigger render={<Button size="default" variant="secondary" />}>
        Code locally
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Design templates in code</DialogTitle>
          <DialogDescription>
            Edit React Email files locally and see saved changes here.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
          <div className="space-y-3">
            <p className="text-body-sm/5 text-muted-fg">
              Create a team key with Templates read and write permissions.
              Replace your-key below with that key in your terminal.
            </p>
            <LinkButton
              search={{
                organizationId,
                organizationView: "api-keys",
                tab: "organization",
              }}
              size="sm"
              to="/settings"
              variant="secondary"
            >
              Open API keys
            </LinkButton>
          </div>
          <Surface variant="detail">
            <pre className="overflow-x-auto font-mono text-caption break-all whitespace-pre-wrap">
              <code>{commands}</code>
            </pre>
          </Surface>
          <Button
            onClick={() => {
              void copyCommands();
            }}
            size="sm"
            variant="secondary"
          >
            Copy commands
          </Button>
          <p className="text-body-sm/5 text-muted-fg">
            Edit emails/welcome.tsx and add templates in quieter.templates.json.
            Keep the key in your shell or an ignored local environment file.
            Templates update while this page is open. Sending still requires
            campaign review.
          </p>
          {templateId ? (
            <p className="text-body-sm/5 text-muted-fg">
              Linking accepts this template&apos;s saved version. The next sync
              replaces it with your local code. Unsaved browser edits stay here
              until you choose to reload.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="shrink-0">
          <DialogCloseButton variant="secondary">Cancel</DialogCloseButton>
          <DialogCloseButton variant="default">Done</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
