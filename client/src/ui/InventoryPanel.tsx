import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  COSMETIC_TYPE,
  COSMETIC_TYPES,
  type CosmeticDefinition,
  type CosmeticType,
  type EquippedCosmetics,
} from "@foghaven/shared";
import {
  CosmeticsError,
  equipCosmetic,
  fetchCatalog,
  fetchInventory,
  purchaseCosmetic,
  unequipCosmetic,
  type OwnedCosmetic,
} from "../net/cosmetics";
import { archetypeForColor } from "../game/characters/assign";
import { VICTORY_POSE_VISUALS } from "../game/characters/cosmeticVisuals";
import { RigPreview } from "./RigPreview";
import { Button, Card, Panel } from "./primitives";

interface InventoryPanelProps {
  token: string;
  /** Used only to pick a stable preview archetype (see the module doc below) — never sent anywhere. */
  username: string;
  onClose: () => void;
}

const ERROR_KEY: Record<string, string> = {
  not_found: "inventory.errors.notFound",
  already_owned: "inventory.errors.alreadyOwned",
  insufficient_coins: "inventory.errors.insufficientCoins",
  not_owned: "inventory.errors.notOwned",
};

/** Which `EquippedCosmetics` field a given cosmetic type occupies — mirrors `EQUIP_FIELD_BY_TYPE` on the server. */
const SLOT_FIELD: Record<CosmeticType, keyof EquippedCosmetics> = {
  [COSMETIC_TYPE.HAT]: "hatId",
  [COSMETIC_TYPE.ACCESSORY]: "accessoryId",
  [COSMETIC_TYPE.PET]: "petId",
  [COSMETIC_TYPE.OUTFIT]: "outfitId",
  [COSMETIC_TYPE.VICTORY_POSE]: "victoryPoseId",
  [COSMETIC_TYPE.DEATH_EFFECT]: "deathEffectId",
};

function previewPropsFor(archetypeId: string, type: CosmeticType, id: string) {
  return {
    archetypeId,
    hat: type === COSMETIC_TYPE.HAT ? id : undefined,
    accessory: type === COSMETIC_TYPE.ACCESSORY ? id : undefined,
    outfit: type === COSMETIC_TYPE.OUTFIT ? id : undefined,
    pet: type === COSMETIC_TYPE.PET ? id : undefined,
    pose: type === COSMETIC_TYPE.VICTORY_POSE ? VICTORY_POSE_VISUALS[id] : undefined,
  };
}

/**
 * The inventory/equip screen (and shop, in one — there is no separate
 * purchase flow to navigate to). Reachable from the main menu; equipping
 * here writes straight to the account, and the next room this player joins
 * picks it up automatically (`GameRoom.onJoin` snapshots the saved loadout —
 * see its own doc).
 *
 * `catalog` (what exists) and `owned` (what this account has) are kept as
 * two separate lists rather than merged into one, deliberately: merging them
 * would lose exactly the distinction the UI needs to decide "Buy" vs "Equip"
 * for a given row.
 *
 * The preview at the top uses `archetypeForColor` seeded with the player's
 * *username* rather than an in-room `color` — there is no room here to have
 * one — which gives a stable, personal-feeling preview across visits to this
 * screen even though the actual in-game archetype is re-rolled per room
 * (colour assignment is per-room by design). It's flavour, not a promise
 * about which costume they'll actually wear next game.
 */
export function InventoryPanel({ token, username, onClose }: InventoryPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<CosmeticType>(COSMETIC_TYPE.HAT);
  const [catalog, setCatalog] = useState<CosmeticDefinition[]>([]);
  const [coins, setCoins] = useState(0);
  const [owned, setOwned] = useState<Map<string, OwnedCosmetic>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [fullCatalog, inventory] = await Promise.all([fetchCatalog(), fetchInventory(token)]);
    setCatalog(fullCatalog);
    setCoins(inventory.coins);
    setOwned(new Map(inventory.owned.map((item) => [item.id, item])));
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    void action()
      .catch((err) =>
        setError(
          err instanceof CosmeticsError ? (ERROR_KEY[err.code] ?? "inventory.errors.unknown") : "inventory.errors.unknown",
        ),
      )
      .finally(() => setBusyId(null));
  };

  const loadout: Partial<EquippedCosmetics> = {};
  for (const item of owned.values()) {
    if (item.equipped) {
      loadout[SLOT_FIELD[item.type]] = item.id;
    }
  }

  const previewArchetype = archetypeForColor(username).id;

  return (
    <div className="inventory-overlay" role="dialog" aria-label={t("inventory.heading")}>
      <Panel className="inventory-panel">
        <div className="inventory-header">
          <h2>{t("inventory.heading")}</h2>
          <span className="inventory-coins">{t("inventory.coins", { count: coins })}</span>
          <Button type="button" variant="link" onClick={onClose}>
            {t("inventory.closeButton")}
          </Button>
        </div>

        <div className="inventory-preview">
          <Card>
            <RigPreview
              archetypeId={previewArchetype}
              hat={loadout.hatId}
              accessory={loadout.accessoryId}
              outfit={loadout.outfitId}
              pet={loadout.petId}
              pose={loadout.victoryPoseId ? VICTORY_POSE_VISUALS[loadout.victoryPoseId] : undefined}
              size={128}
            />
          </Card>
          <p className="hint">{t("inventory.previewHint")}</p>
        </div>

        <div className="inventory-tabs">
          {COSMETIC_TYPES.map((type) => (
            <Button
              key={type}
              className={tab === type ? "inventory-tab inventory-tab-active" : "inventory-tab"}
              onClick={() => setTab(type)}
            >
              {t(`cosmetics.types.${type}`)}
            </Button>
          ))}
        </div>

        <ul className="inventory-grid">
          {catalog
            .filter((def) => def.type === tab)
            .map((def) => {
              const item = owned.get(def.id);
              return (
                <li key={def.id}>
                  <Card selected={item?.equipped} className="inventory-item">
                    <RigPreview {...previewPropsFor(previewArchetype, def.type, def.id)} size={72} />
                    <span className="inventory-item-name">{t(`cosmetics.items.${def.id}`, def.name)}</span>
                    {item?.equipped && (
                      <span className="inventory-equipped-tag">{t("inventory.equippedTag")}</span>
                    )}

                    {item?.equipped ? (
                      <Button
                        type="button"
                        variant="default"
                        className="secondary"
                        disabled={busyId === def.id}
                        onClick={() =>
                          run(def.id, async () => {
                            await unequipCosmetic(token, def.type);
                            await refresh();
                          })
                        }
                      >
                        {t("inventory.unequipButton")}
                      </Button>
                    ) : item ? (
                      <Button
                        type="button"
                        variant="primary"
                        disabled={busyId === def.id}
                        onClick={() =>
                          run(def.id, async () => {
                            await equipCosmetic(token, def.id);
                            await refresh();
                          })
                        }
                      >
                        {t("inventory.equipButton")}
                      </Button>
                    ) : (
                      // Reached only for a paid item with no ownership row —
                      // starters are always present in `owned` already (see
                      // `CosmeticProvider.listOwned`), so there is no separate
                      // "claim your free item" step to design for here.
                      <Button
                        type="button"
                        variant="primary"
                        disabled={busyId === def.id || coins < def.priceCoins}
                        onClick={() =>
                          run(def.id, async () => {
                            await purchaseCosmetic(token, def.id);
                            await refresh();
                          })
                        }
                      >
                        {t("inventory.buyButton", { price: def.priceCoins })}
                      </Button>
                    )}
                  </Card>
                </li>
              );
            })}
        </ul>

        {error && <p className="error">{t(error)}</p>}
      </Panel>
    </div>
  );
}
