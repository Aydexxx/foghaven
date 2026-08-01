import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface CardProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  selected?: boolean;
  dead?: boolean;
  children: ReactNode;
}

/**
 * ART_BIBLE §8 Card — players, roles, cosmetics. 3px ink border, 10px
 * radius. `selected` adds the 4px voteGold border + outer glow; `dead`
 * desaturates to 20% and overlays a 3px-equivalent ink ✕ at 60% alpha.
 *
 * Always expected to contain the character sprite: "a player card without a
 * face is a spreadsheet row" — this component doesn't enforce that (it has
 * no opinion on layout beyond the border treatment), but every call site
 * should be passing one.
 */
export function Card({ selected, dead, className, children, ...rest }: CardProps) {
  const classes = ["ph-card", selected && "ph-card--selected", dead && "ph-card--dead", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
