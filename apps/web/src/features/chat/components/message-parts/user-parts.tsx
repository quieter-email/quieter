import type { MessagePart } from "@tanstack/ai";
import { UserTextPart } from "./user-text-part";

export const UserParts = ({ parts }: { parts: MessagePart[] }) => (
  <>
    {parts.map((part, index) =>
      part.type === "text" ? (
        <UserTextPart key={`text:${index}:${part.content}`} text={part.content} />
      ) : null,
    )}
  </>
);
