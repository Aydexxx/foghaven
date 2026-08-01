import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AbilityTargetInfo } from "../game/GameScene";
import { Button } from "./primitives";

interface AbilityButtonProps {
  /** The ability's registry id — labels come from `abilities.<id>.*` i18n keys. */
  abilityId: string;
  /** Remaining cooldown in ms, as last told by the server. */
  cooldownMs: number;
  /** When that cooldown figure was received, for local countdown only. */
  cooldownSetAt: number;
  /**
   * The ability's full cooldown from the role definition — the denominator
   * for the sweep animation (a duration-remaining message alone can't say
   * how full the bar should look).
   */
  fullCooldownMs: number;
  /** Uses remaining, or null for unlimited. At 0 the button is spent for the game. */
  usesLeft: number | null;
  target: AbilityTargetInfo | null;
  onUse: (target: AbilityTargetInfo) => void;
}

/**
 * The generic ability button — rendered for any player whose own role has
 * an ability (see GameView), enabled only when a target is in range, the
 * cooldown has run out, and uses remain. What counts as "a target" depends
 * on the ability's `abilityTargetKind` (see `GameScene.getAbilityTarget`):
 * a player, a body, the room the local player stands in, or nothing at all.
 *
 * The countdown here is presentation: it ticks down a duration the server
 * sent, on the local clock, purely so the button can show a number. Whether
 * the ability actually fires is decided entirely by `GameRoom.handleAbility`.
 */
export function AbilityButton({
  abilityId,
  cooldownMs,
  cooldownSetAt,
  fullCooldownMs,
  usesLeft,
  target,
  onUse,
}: AbilityButtonProps) {
  const { t } = useTranslation();
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    const update = () => {
      const elapsed = Date.now() - cooldownSetAt;
      setRemainingMs(Math.max(0, cooldownMs - elapsed));
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [cooldownMs, cooldownSetAt]);

  const spent = usesLeft !== null && usesLeft <= 0;
  const onCooldown = remainingMs > 0;
  const disabled = spent || onCooldown || target === null;
  const seconds = Math.ceil(remainingMs / 1000);
  const progress = onCooldown ? 1 - remainingMs / Math.max(cooldownMs, fullCooldownMs, 1) : 1;

  // "none"-kind abilities (lamplighter, medium) have no referent to name in
  // the tooltip; "room"-kind names the room itself rather than a player.
  const targetLabel =
    target?.kind === "room" ? t(`rooms.${target.room}`) : (target?.name ?? undefined);

  return (
    <Button
      variant="destructive"
      className="ability-button"
      onClick={() => target && onUse(target)}
      disabled={disabled}
      data-ability-ready={!disabled}
      title={targetLabel ? t(`abilities.${abilityId}.target`, { name: targetLabel }) : undefined}
    >
      <span
        className="ability-button-cooldown"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />
      <span className="ability-button-label">
        {spent
          ? t("abilities.spent")
          : onCooldown
            ? t("abilities.cooldown", { seconds })
            : t(`abilities.${abilityId}.button`)}
      </span>
    </Button>
  );
}
