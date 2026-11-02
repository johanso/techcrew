/** Title block at the top of every dashboard page (the page's single h1). */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <p className="eyebrow text-brand-emphasis">{eyebrow}</p>}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Label/value pairs inside a surface, two columns from `sm`. */
export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-10 gap-y-6 p-6 sm:grid-cols-2">
      {items.map(({ label, value }) => (
        <div key={label} className="flex min-w-0 flex-col gap-1.5">
          <dt className="eyebrow text-muted-foreground">{label}</dt>
          <dd className="truncate text-sm font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Heading row for a `surface` card: optional icon tile, title, subtitle and trailing actions. */
export function SurfaceHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border/70 px-6 py-5">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-base font-bold">{title}</h2>
        {description && <div className="truncate text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions}
    </div>
  );
}
