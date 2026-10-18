import Link from "next/link";
import { Icon } from "./ui";

export interface FilterChip {
  key: string;
  label: string;
  href: string;
}

/** the filters you have on, each one a link that drops that filter. */
export function FilterChips({ chips, clearHref = "/leads" }: { chips: FilterChip[]; clearHref?: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11.5px] text-faint">filters on</span>
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          title={`drop the ${chip.label} filter`}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink"
        >
          {chip.label}
          <Icon name="close" className="size-2.5 text-faint" />
        </Link>
      ))}
      <Link href={clearHref} className="text-[11.5px] text-accent-ink hover:underline">
        clear them all
      </Link>
    </div>
  );
}
