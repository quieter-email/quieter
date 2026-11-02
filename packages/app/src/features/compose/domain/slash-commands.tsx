import { CommandMenu } from "@quieter/ui/command-menu";
import type { CommandMenuItem } from "@quieter/ui/command-menu";
import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { exitSuggestion, Suggestion } from "@tiptap/suggestion";
import type { SuggestionProps } from "@tiptap/suggestion";

export type SlashCommand = CommandMenuItem & {
  run: (editor: Editor, range: Range) => void;
};

const slashCommandKey = new PluginKey("composeSlashCommands");

export const SlashCommands = Extension.create<{
  getItems: (query: string, editor: Editor) => SlashCommand[];
  getStatus: () => string | undefined;
  onOpenChange: ((open: boolean) => void) | null;
}>({
  addOptions() {
    return {
      getItems: () => [],
      getStatus: () => "",
      onOpenChange: null,
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommand, SlashCommand>({
        allow: ({ editor }) =>
          editor.isEditable &&
          !editor.isActive("codeBlock") &&
          !editor.isActive("code"),
        allowSpaces: true,
        allowedPrefixes: [" ", "\n"],
        char: "/",
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        editor: this.editor,
        items: ({ query, editor }) => this.options.getItems(query, editor),
        pluginKey: slashCommandKey,
        render: () => {
          let component: ReactRenderer | null = null;
          let unmount: (() => void) | null = null;
          let current: SuggestionProps<SlashCommand, SlashCommand> | null =
            null;
          let activeIndex = 0;
          const menuId = `compose-commands-${crypto.randomUUID()}`;
          const renderMenu = () => {
            if (!current || !component) {
              return;
            }
            const props = current;
            props.editor.view.dom.setAttribute("aria-controls", menuId);
            props.editor.view.dom.setAttribute("aria-expanded", "true");
            if (props.items.length > 0) {
              props.editor.view.dom.setAttribute(
                "aria-activedescendant",
                `${menuId}-${activeIndex}`
              );
            } else {
              props.editor.view.dom.removeAttribute("aria-activedescendant");
            }
            component.updateProps({
              activeIndex,
              id: menuId,
              items: props.items,
              onHighlight: (index: number) => {
                if (activeIndex !== index) {
                  activeIndex = index;
                  renderMenu();
                }
              },
              onSelect: (index: number) => {
                const item = props.items[index];
                if (index < props.items.length) {
                  props.command(item);
                }
              },
              status: this.options.getStatus(),
            });
          };
          return {
            onExit: (props) => {
              this.options.onOpenChange?.(false);
              props.editor.view.dom.removeAttribute("aria-controls");
              props.editor.view.dom.removeAttribute("aria-expanded");
              props.editor.view.dom.removeAttribute("aria-activedescendant");
              unmount?.();
              component?.destroy();
              component = null;
              current = null;
            },
            onKeyDown: ({ event }) => {
              if (event.isComposing || !current) {
                return false;
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                exitSuggestion(current.editor.view, slashCommandKey);
                return true;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const count = current.items.length;
                if (count > 0) {
                  activeIndex =
                    (activeIndex +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      count) %
                    count;
                  renderMenu();
                  component?.element
                    .querySelector(`#${menuId}-${activeIndex}`)
                    ?.scrollIntoView({ block: "nearest" });
                }
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = current.items[activeIndex];
                if (activeIndex < current.items.length) {
                  event.stopPropagation();
                  current.command(item);
                }
                return true;
              }
              return false;
            },
            onStart: (props) => {
              this.options.onOpenChange?.(true);
              current = props;
              activeIndex = 0;
              component = new ReactRenderer(CommandMenu, {
                editor: props.editor,
                props: {
                  activeIndex,
                  id: menuId,
                  items: props.items,
                  onHighlight: (index: number) => {
                    activeIndex = index;
                    renderMenu();
                  },
                  onSelect: (index: number) => {
                    if (index < props.items.length) {
                      props.command(props.items[index]);
                    }
                  },
                },
              });
              unmount = props.mount(component.element);
              renderMenu();
            },
            onUpdate: (props) => {
              if (current?.query !== props.query) {
                activeIndex = 0;
              }
              current = props;
              activeIndex = Math.min(
                activeIndex,
                Math.max(props.items.length - 1, 0)
              );
              renderMenu();
            },
          };
        },
      }),
    ];
  },
  name: "composeSlashCommands",
});
