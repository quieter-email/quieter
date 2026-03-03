import {
  ColorModeToggle,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@quietr/ui";

type SidebarProfileDialogProps = {
  initial: string;
  name: string;
  email: string;
};

export const SidebarProfileDialog = (props: SidebarProfileDialogProps) => (
  <div class="border-b border-border p-3">
    <Dialog>
      <DialogTrigger class="group block w-full">
        <div class="flex w-full items-center gap-3 bg-background px-3 py-3 text-left transition-all group-hover:-translate-y-px">
          <span class="grid size-9 shrink-0 place-items-center border bg-background-contrast text-sm font-semibold">
            {props.initial}
          </span>

          <span class="min-w-0">
            <span class="block truncate text-sm leading-tight font-semibold text-foreground">
              {props.name}
            </span>
            <span class="block truncate text-[11px] text-muted-foreground">{props.email}</span>
          </span>
        </div>
      </DialogTrigger>

      <DialogContent class="w-[min(92vw,26rem)] bg-background text-foreground">
        <DialogHeader class="bg-background-contrast">
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>Signed in account details.</DialogDescription>
        </DialogHeader>

        <DialogBody class="space-y-3">
          <div class="border bg-background-contrast p-3">
            <p class="text-sm text-muted-foreground">Name</p>
            <p class="mt-1 text-sm font-semibold text-foreground">{props.name}</p>
          </div>

          <div class="border bg-background-contrast p-3">
            <p class="text-sm text-muted-foreground">Email</p>
            <p class="mt-1 truncate text-sm text-foreground">{props.email}</p>
          </div>

          <div class="flex items-center justify-between gap-3 border bg-background-contrast p-3">
            <div>
              <p class="text-sm text-muted-foreground">Theme</p>
              <p class="mt-1 text-xs text-muted-foreground">System by default, then toggle.</p>
            </div>

            <ColorModeToggle size="sm" class="min-w-20" lightLabel="Light" darkLabel="Dark" />
          </div>
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton class="border-border bg-background text-foreground hover:bg-background-contrast">
            Close
          </DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
);
