import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  medications,
  pharmacyLots,
  pharmacyMovements,
  type Medication,
  type MedicationAdministration,
  type PharmacyLot,
} from "@shared/schema";

export type StockSyncResult = {
  stockWarning?: string | null;
};

const STOCK_OUT_STATUSES = new Set(["given", "late"]);

function isStockOutStatus(status: string): boolean {
  return STOCK_OUT_STATUSES.has(status);
}

async function findExistingDoseMovement(orgId: number, administrationId: number) {
  const [existing] = await db
    .select()
    .from(pharmacyMovements)
    .where(
      and(
        eq(pharmacyMovements.organizationId, orgId),
        eq(pharmacyMovements.medicationAdministrationId, administrationId),
      ),
    )
    .limit(1);
  return existing;
}

async function restoreLotQuantity(orgId: number, lotId: number | null | undefined, quantity: number) {
  if (!lotId || quantity <= 0) return;
  await db
    .update(pharmacyLots)
    .set({
      quantityOnHand: sql`${pharmacyLots.quantityOnHand} + ${quantity}`,
    })
    .where(and(eq(pharmacyLots.id, lotId), eq(pharmacyLots.organizationId, orgId)));
}

async function reverseDoseMovement(orgId: number, administrationId: number): Promise<void> {
  const existing = await findExistingDoseMovement(orgId, administrationId);
  if (!existing) return;

  // quantity on dose outs = amount actually deducted from lot
  if (existing.type === "out" && existing.lotId && existing.quantity > 0) {
    await restoreLotQuantity(orgId, existing.lotId, existing.quantity);
  }

  await db
    .delete(pharmacyMovements)
    .where(and(eq(pharmacyMovements.id, existing.id), eq(pharmacyMovements.organizationId, orgId)));
}

async function selectFefoLot(input: {
  organizationId: number;
  itemId: number;
  scope: string;
  residentId: number;
}): Promise<PharmacyLot | undefined> {
  const scopeFilters =
    input.scope === "resident"
      ? [eq(pharmacyLots.scope, "resident"), eq(pharmacyLots.residentId, input.residentId)]
      : [eq(pharmacyLots.scope, "org"), isNull(pharmacyLots.residentId)];

  const lots = await db
    .select()
    .from(pharmacyLots)
    .where(
      and(
        eq(pharmacyLots.organizationId, input.organizationId),
        eq(pharmacyLots.itemId, input.itemId),
        sql`${pharmacyLots.quantityOnHand} > 0`,
        ...scopeFilters,
      ),
    )
    .orderBy(
      sql`${pharmacyLots.expiryDate} ASC NULLS LAST`,
      asc(pharmacyLots.receivedAt),
      asc(pharmacyLots.id),
    )
    .limit(1);

  return lots[0];
}

/**
 * Sync pharmacy stock after a dose administration upsert.
 * Never throws for shortage — returns stockWarning instead.
 */
export async function syncPharmacyStockForAdministration(input: {
  administration: MedicationAdministration;
  previousStatus?: string | null;
  medication?: Medication | null;
}): Promise<StockSyncResult> {
  const { administration } = input;
  const orgId = administration.organizationId;

  let medication = input.medication ?? null;
  if (!medication) {
    const [row] = await db
      .select()
      .from(medications)
      .where(and(eq(medications.id, administration.medicationId), eq(medications.organizationId, orgId)))
      .limit(1);
    medication = row ?? null;
  }

  if (!medication?.pharmacyItemId) {
    return {};
  }

  const unitsPerDose = Number(medication.unitsPerDose ?? 1);
  const intended = Number.isFinite(unitsPerDose) && unitsPerDose > 0 ? unitsPerDose : 1;
  const scope = medication.stockScope === "resident" ? "resident" : "org";
  const wasOut = isStockOutStatus(input.previousStatus ?? "");
  const isOut = isStockOutStatus(administration.status);

  // Reversal: given/late -> skipped/refused
  if (wasOut && !isOut) {
    await reverseDoseMovement(orgId, administration.id);
    return {};
  }

  if (!isOut) {
    return {};
  }

  // Idempotent: already have movement for this administration
  const existing = await findExistingDoseMovement(orgId, administration.id);
  if (existing) {
    return existing.stockShortage
      ? {
          stockWarning:
            "Saldo insuficiente — dose registrada mesmo assim.",
        }
      : {};
  }

  const lot = await selectFefoLot({
    organizationId: orgId,
    itemId: medication.pharmacyItemId,
    scope,
    residentId: administration.residentId,
  });

  const available = lot ? Number(lot.quantityOnHand) : 0;
  const deducted = Math.min(Math.max(available, 0), intended);
  const stockShortage = deducted < intended;

  if (lot && deducted > 0) {
    await db
      .update(pharmacyLots)
      .set({ quantityOnHand: Math.max(0, available - deducted) })
      .where(and(eq(pharmacyLots.id, lot.id), eq(pharmacyLots.organizationId, orgId)));
  }

  await db.insert(pharmacyMovements).values({
    organizationId: orgId,
    type: "out",
    itemId: medication.pharmacyItemId,
    lotId: lot?.id ?? null,
    quantity: deducted > 0 ? deducted : intended,
    scope,
    residentId: scope === "resident" ? administration.residentId : null,
    staffId: administration.staffId ?? null,
    medicationAdministrationId: administration.id,
    reason: stockShortage
      ? `Baixa por dose (pretendido: ${intended}; disponível: ${available})`
      : "Baixa por administração de dose",
    stockShortage,
    occurredAt: administration.administeredAt ?? new Date(),
  });

  if (stockShortage) {
    return {
      stockWarning: "Saldo insuficiente — dose registrada mesmo assim.",
    };
  }

  return {};
}
