import { useId } from "react";
import type { ReactNode } from "react";

export const ContentSection = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  title: string;
}) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div>
        <h2 className="text-body font-normal text-fg" id={id}>
          {title}
        </h2>
        {description !== undefined && description !== null ? (
          <div className="mt-1 max-w-3xl text-body/6 text-muted-fg">
            {description}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
};
