import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type PanelOwnProps<E extends ElementType> = {
  as?: E;
  className?: string;
  children: ReactNode;
};

type PanelProps<E extends ElementType> = PanelOwnProps<E> &
  Omit<ComponentPropsWithoutRef<E>, keyof PanelOwnProps<E>>;

/**
 * ART_BIBLE §8 Panel — the one surface every menu/dialog/list-holder screen
 * is built from. Flat `void` fill with no gradient and no grain texture (the
 * old parchment treatment this replaces), a 4px ink border, 14px radius, and
 * a 2px fogLight inner top highlight for the "plastic sticker" depth cue.
 *
 * `as` makes this polymorphic (a `<form>` panel still submits, a `<section>`
 * panel is still landmark-navigable) without every screen re-declaring the
 * border/fill/radius rules for its own root element.
 */
export function Panel<E extends ElementType = "div">({
  as,
  className,
  children,
  ...rest
}: PanelProps<E>) {
  const Component = (as ?? "div") as ElementType;
  const classes = className ? `ph-panel ${className}` : "ph-panel";
  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
