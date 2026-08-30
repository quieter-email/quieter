const fields = [
  {
    className: "-top-[12%] -left-[14%] h-[42%] w-[58%]",
    delay: "-8s",
    tone: "home-gradient-ink",
  },
  {
    className: "top-[4%] -right-[18%] h-[46%] w-[62%]",
    delay: "-23s",
    tone: "home-gradient-blue",
  },
  {
    className: "top-[38%] left-[8%] h-[38%] w-[68%]",
    delay: "-37s",
    tone: "home-gradient-blue-soft",
  },
  {
    className: "right-[2%] -bottom-[8%] h-[44%] w-[56%]",
    delay: "-51s",
    tone: "home-gradient-ink-soft",
  },
] as const;

export const SoftGradientField = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 overflow-hidden bg-bg-surface"
  >
    {fields.map((field) => (
      <div
        className={`home-gradient-field ${field.tone} ${field.className}`}
        key={field.className}
        style={{ animationDelay: field.delay }}
      />
    ))}
  </div>
);
