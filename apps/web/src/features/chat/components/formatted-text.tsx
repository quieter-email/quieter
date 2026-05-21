import { parseTextBlocks } from "../domain/chat-formatting";

export const FormattedText = ({ text }: { text: string }) => {
  const blocks = parseTextBlocks(text);

  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre
              className="overflow-x-auto rounded-md bg-muted/30 px-3 py-2 text-xs leading-5 text-foreground/80"
              key={index}
            >
              <code>{block.content}</code>
            </pre>
          );
        }

        if (block.type === "list") {
          return (
            <ul className="ml-4 list-disc space-y-0.5 text-foreground/85" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        return <p key={index}>{block.content}</p>;
      })}
    </div>
  );
};
