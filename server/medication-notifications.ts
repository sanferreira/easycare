import { storage } from "./storage";
import { sendWebPushNotifications } from "./web-push";
import type { AppNotification, InsertNotification, Medication, MedicationAdministration, StaffMember, User } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notifications";

type MedicationNotificationConfig = {
  enabled: boolean;
  intervalSeconds: number;
  reminderBeforeMinutes: number;
  overdueAfterMinutes: number;
};

type MedicationWithResident = Medication & { residentName?: string | null };

type MedicationDoseOccurrence = {
  medication: MedicationWithResident;
  scheduledFor: Date;
  doseKey: string;
};

type TimeClockEntryWithDetails = Awaited<ReturnType<typeof storage.getTimeClockEntries>>[number];

const MEDICATION_CARE_TEAM_ROLES = new Set(["cuidador", "tecnico_enfermagem", "enfermeiro"]);
const MEDICATION_FALLBACK_ROLES = new Set(["admin", "enfermeiro", "medico", "tecnico_enfermagem"]);
const MEDICATION_ESCALATION_ROLES = new Set(["admin", "enfermeiro"]);
const ACTIVE_TIME_CLOCK_STATUSES = new Set(["valid", "manual_adjusted", "pending_approval"]);
const WORKING_TIME_CLOCK_EVENTS = new Set(["clock_in", "break_end"]);
const MEDICATION_TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const HOUR_IN_MS = 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;

let started = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

function parseBoolean(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) return true;
  if (["0", "false", "no", "nao", "não"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value && value.trim() ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function loadMedicationNotificationConfig(): MedicationNotificationConfig {
  return {
    enabled: parseBoolean(process.env.MEDICATION_NOTIFICATIONS_ENABLED, true),
    intervalSeconds: parseInteger(process.env.MEDICATION_NOTIFICATION_WORKER_INTERVAL_SECONDS, 60, 15, 3600),
    reminderBeforeMinutes: parseInteger(process.env.MEDICATION_REMINDER_BEFORE_MINUTES, 10, 0, 240),
    overdueAfterMinutes: parseInteger(process.env.MEDICATION_OVERDUE_AFTER_MINUTES, 15, 0, 24 * 60),
  };
}

function parseDateOnly(value: string | Date | null | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return date;
  }

  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function parseMedicationScheduleTimes(scheduleTime: string | null | undefined) {
  const parsedTimes: Array<{ hour: number; minute: number; label: string }> = [];
  if (scheduleTime?.trim()) {
    const tokens = scheduleTime
      .split(/[\n,;|]+/g)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of tokens) {
      const match = token.match(MEDICATION_TIME_REGEX);
      if (!match) continue;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      parsedTimes.push({
        hour,
        minute,
        label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      });
    }
  }

  const dedupMap = new Map<string, { hour: number; minute: number; label: string }>();
  parsedTimes.forEach((item) => dedupMap.set(item.label, item));
  return Array.from(dedupMap.values()).sort((left, right) =>
    (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute),
  );
}

function parseMedicationIntervalHours(frequency: string | null | undefined): number | null {
  const normalizedFrequency = (frequency ?? "").trim().toLowerCase();
  if (!normalizedFrequency) return null;
  if (normalizedFrequency.includes("sob demanda")) return null;
  if (normalizedFrequency.includes("semanal")) return 24 * 7;

  const legacyEveryHourMatch = normalizedFrequency.match(/^(\d{1,2})\s*h\s*\/\s*\d{1,2}\s*h$/);
  if (legacyEveryHourMatch) {
    const legacyHours = Number(legacyEveryHourMatch[1]);
    if (legacyHours >= 1 && legacyHours <= 24) return legacyHours;
  }

  const everyHourMatch = normalizedFrequency.match(/(?:a cada\s*)?(\d{1,2})\s*h/);
  if (everyHourMatch) {
    const everyHours = Number(everyHourMatch[1]);
    if (everyHours >= 1 && everyHours <= 24) return everyHours;
  }

  const timesPerDayMatch = normalizedFrequency.match(/(\d{1,2})\s*x\s*ao\s*dia/);
  if (timesPerDayMatch) {
    const timesPerDay = Number(timesPerDayMatch[1]);
    if (timesPerDay >= 1 && timesPerDay <= 24 && 24 % timesPerDay === 0) {
      return 24 / timesPerDay;
    }
  }

  return null;
}

function isOnDemandFrequency(frequency: string | null | undefined): boolean {
  return (frequency ?? "").trim().toLowerCase().includes("sob demanda");
}

function buildDoseKey(medicationId: number, scheduledFor: Date): string {
  const minuteBucket = Math.round(scheduledFor.getTime() / MINUTE_IN_MS);
  return `${medicationId}:${minuteBucket}`;
}

function buildMedicationActionUrl(dose: MedicationDoseOccurrence): string {
  const params = new URLSearchParams({
    tab: "medications",
    medicationTab: "agenda",
    residentId: String(dose.medication.residentId),
    medicationId: String(dose.medication.id),
    scheduledFor: dose.scheduledFor.toISOString(),
  });
  return `/prontuario?${params.toString()}`;
}

function formatNotificationTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNotificationDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function administrationResolvesDose(status: string | null | undefined): boolean {
  return status === "given" || status === "skipped" || status === "refused" || status === "late";
}

function buildAdministrationStatusMap(administrations: MedicationAdministration[]) {
  const map = new Map<string, string | null>();
  administrations.forEach((administration) => {
    if (!administration.scheduledFor) return;
    const scheduledFor = new Date(administration.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return;
    map.set(buildDoseKey(administration.medicationId, scheduledFor), administration.status ?? null);
  });
  return map;
}

function buildMedicationDoseOccurrences(
  medications: MedicationWithResident[],
  from: Date,
  to: Date,
): MedicationDoseOccurrence[] {
  const occurrences: MedicationDoseOccurrence[] = [];

  for (const medication of medications) {
    if (medication.status !== "active" || isOnDemandFrequency(medication.frequency)) continue;

    const medicationStart = parseDateOnly(medication.startDate);
    const medicationEnd = parseDateOnly(medication.endDate, true);
    const effectiveStart = new Date(Math.max(from.getTime(), medicationStart?.getTime() ?? from.getTime()));
    const effectiveEnd = new Date(Math.min(to.getTime(), medicationEnd?.getTime() ?? to.getTime()));
    if (effectiveStart.getTime() > effectiveEnd.getTime()) continue;

    const scheduleTimes = parseMedicationScheduleTimes(medication.scheduleTime);
    const intervalHours = parseMedicationIntervalHours(medication.frequency);

    if (intervalHours !== null && scheduleTimes.length <= 1) {
      const baseScheduleTime = scheduleTimes[0] ?? { hour: 8, minute: 0, label: "08:00" };
      const stepInMs = intervalHours * HOUR_IN_MS;
      const anchorDate = medicationStart ?? effectiveStart;
      let occurrenceCursor = new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth(),
        anchorDate.getDate(),
        baseScheduleTime.hour,
        baseScheduleTime.minute,
        0,
        0,
      );

      if (occurrenceCursor.getTime() < effectiveStart.getTime()) {
        const diffInMs = effectiveStart.getTime() - occurrenceCursor.getTime();
        occurrenceCursor = new Date(occurrenceCursor.getTime() + Math.ceil(diffInMs / stepInMs) * stepInMs);
      }

      while (occurrenceCursor.getTime() <= effectiveEnd.getTime()) {
        occurrences.push({
          medication,
          scheduledFor: new Date(occurrenceCursor),
          doseKey: buildDoseKey(medication.id, occurrenceCursor),
        });
        occurrenceCursor = new Date(occurrenceCursor.getTime() + stepInMs);
      }
      continue;
    }

    const explicitTimes = scheduleTimes.length > 0 ? scheduleTimes : [{ hour: 8, minute: 0, label: "08:00" }];
    const dayCursor = new Date(
      effectiveStart.getFullYear(),
      effectiveStart.getMonth(),
      effectiveStart.getDate(),
      0,
      0,
      0,
      0,
    );
    const endCursor = new Date(
      effectiveEnd.getFullYear(),
      effectiveEnd.getMonth(),
      effectiveEnd.getDate(),
      0,
      0,
      0,
      0,
    );

    while (dayCursor.getTime() <= endCursor.getTime()) {
      for (const scheduledTime of explicitTimes) {
        const scheduledFor = new Date(
          dayCursor.getFullYear(),
          dayCursor.getMonth(),
          dayCursor.getDate(),
          scheduledTime.hour,
          scheduledTime.minute,
          0,
          0,
        );
        if (scheduledFor.getTime() < effectiveStart.getTime() || scheduledFor.getTime() > effectiveEnd.getTime()) {
          continue;
        }
        occurrences.push({
          medication,
          scheduledFor,
          doseKey: buildDoseKey(medication.id, scheduledFor),
        });
      }
      dayCursor.setDate(dayCursor.getDate() + 1);
    }
  }

  return occurrences.sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());
}

function normalizeComparableText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getActiveUserById(users: User[], userId: number | null | undefined): User | null {
  if (!Number.isInteger(userId) || Number(userId) <= 0) return null;
  return users.find((user) => user.id === userId && user.active !== false && !user.isSuperAdmin) ?? null;
}

function getFallbackMedicationUsers(users: User[]) {
  return users.filter((user) =>
    user.active !== false
    && !user.isSuperAdmin
    && MEDICATION_FALLBACK_ROLES.has(user.role),
  );
}

function getEscalationMedicationUsers(users: User[]) {
  return users.filter((user) =>
    user.active !== false
    && !user.isSuperAdmin
    && MEDICATION_ESCALATION_ROLES.has(user.role),
  );
}

function addUserForStaff(
  target: Map<number, User>,
  users: User[],
  staffMember: StaffMember | undefined,
  entry?: TimeClockEntryWithDetails,
) {
  const entryUser = getActiveUserById(users, entry?.userId ?? null);
  if (entryUser) target.set(entryUser.id, entryUser);

  const portalUser = getActiveUserById(users, staffMember?.portalUserId ?? null);
  if (portalUser) target.set(portalUser.id, portalUser);

  const normalizedStaffName = normalizeComparableText(staffMember?.name ?? entry?.staffName ?? null);
  if (!normalizedStaffName) return;
  users
    .filter((user) => user.active !== false && !user.isSuperAdmin)
    .filter((user) => normalizeComparableText(user.name) === normalizedStaffName)
    .forEach((user) => target.set(user.id, user));
}

function getCurrentCareTeamUsers(input: {
  users: User[];
  staffMembers: StaffMember[];
  entries: TimeClockEntryWithDetails[];
}) {
  const staffById = new Map(input.staffMembers.map((member) => [member.id, member]));
  const latestEntryByStaff = new Map<number, TimeClockEntryWithDetails>();

  for (const entry of input.entries) {
    if (!ACTIVE_TIME_CLOCK_STATUSES.has(String(entry.status))) continue;
    const current = latestEntryByStaff.get(entry.staffId);
    const entryTime = new Date(entry.eventTime).getTime();
    const currentTime = current ? new Date(current.eventTime).getTime() : 0;
    if (!current || entryTime > currentTime) {
      latestEntryByStaff.set(entry.staffId, entry);
    }
  }

  const workingUsers = new Map<number, User>();
  const onBreakUsers = new Map<number, User>();
  for (const entry of Array.from(latestEntryByStaff.values())) {
    const staffMember = staffById.get(entry.staffId);
    if (staffMember?.active === false) continue;
    if (staffMember?.role && !MEDICATION_CARE_TEAM_ROLES.has(staffMember.role)) continue;

    if (WORKING_TIME_CLOCK_EVENTS.has(entry.eventType)) {
      addUserForStaff(workingUsers, input.users, staffMember, entry);
    } else if (entry.eventType === "break_start") {
      addUserForStaff(onBreakUsers, input.users, staffMember, entry);
    }
  }

  return {
    working: Array.from(workingUsers.values()),
    onBreak: Array.from(onBreakUsers.values()),
  };
}

function uniqueUsers(...groups: User[][]) {
  const usersById = new Map<number, User>();
  groups.flat().forEach((user) => usersById.set(user.id, user));
  return Array.from(usersById.values());
}

function resolveMedicationNotificationUsers(input: {
  users: User[];
  staffMembers: StaffMember[];
  entries: TimeClockEntryWithDetails[];
  escalation: boolean;
}) {
  const currentCareTeam = getCurrentCareTeamUsers(input);
  const currentUsers = currentCareTeam.working.length > 0
    ? currentCareTeam.working
    : currentCareTeam.onBreak;
  const fallbackUsers = getFallbackMedicationUsers(input.users);
  const baseUsers = currentUsers.length > 0 ? currentUsers : fallbackUsers;

  if (!input.escalation) return baseUsers;
  return uniqueUsers(baseUsers, getEscalationMedicationUsers(input.users));
}

function buildNotificationForUsers(
  users: User[],
  payload: Omit<InsertNotification, "userId">,
): InsertNotification[] {
  return users.map((user) => ({
    ...payload,
    userId: user.id,
  }));
}

async function dispatchMedicationNotifications(config: MedicationNotificationConfig) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const workWindowStart = new Date(now.getTime() - 24 * HOUR_IN_MS);
    const reminderEnd = new Date(now.getTime() + config.reminderBeforeMinutes * MINUTE_IN_MS);
    const overdueEnd = new Date(now.getTime() - config.overdueAfterMinutes * MINUTE_IN_MS);
    let createdTotal = 0;

    const organizations = await storage.getOrganizations();
    for (const organization of organizations) {
      const [users, medications, administrations, staffMembers, timeClockEntries] = await Promise.all([
        storage.getUsersByOrganization(organization.id),
        storage.getMedications(organization.id),
        storage.getMedicationAdministrations(organization.id),
        storage.getStaff(organization.id),
        storage.getTimeClockEntries(organization.id, { start: workWindowStart, end: now }),
      ]);
      const reminderUsers = resolveMedicationNotificationUsers({
        users,
        staffMembers,
        entries: timeClockEntries,
        escalation: false,
      });
      const overdueUsers = resolveMedicationNotificationUsers({
        users,
        staffMembers,
        entries: timeClockEntries,
        escalation: true,
      });
      if (reminderUsers.length === 0 && overdueUsers.length === 0) continue;

      const activeMedications = medications.filter((medication) => medication.status === "active");
      const administrationStatusByDose = buildAdministrationStatusMap(administrations as MedicationAdministration[]);
      const notificationsToCreate: InsertNotification[] = [];

      if (config.reminderBeforeMinutes > 0) {
        const upcomingDoses = buildMedicationDoseOccurrences(activeMedications, now, reminderEnd);
        for (const dose of upcomingDoses) {
          if (administrationResolvesDose(administrationStatusByDose.get(dose.doseKey))) continue;
          const residentName = dose.medication.residentName || "Paciente";
          notificationsToCreate.push(...buildNotificationForUsers(reminderUsers, {
            organizationId: organization.id,
            staffId: null,
            type: NOTIFICATION_TYPES.medicationDoseReminder,
            severity: "warning",
            sourceModule: "medications",
            title: "Dose de medicamento em breve",
            message: `${residentName}: ${dose.medication.name} ${dose.medication.dosage} as ${formatNotificationTime(dose.scheduledFor)}.`,
            actionUrl: buildMedicationActionUrl(dose),
            entityType: "medication_dose",
            entityId: dose.medication.id,
            dedupeKey: `medication-dose:${dose.doseKey}:reminder`,
            metadata: JSON.stringify({
              medicationId: dose.medication.id,
              residentId: dose.medication.residentId,
              scheduledFor: dose.scheduledFor.toISOString(),
              notificationKind: "reminder",
            }),
            scheduledFor: now,
            deliveredAt: now,
            readAt: null,
            cancelledAt: null,
          }));
        }
      }

      if (overdueEnd.getTime() >= todayStart.getTime()) {
        const overdueDoses = buildMedicationDoseOccurrences(activeMedications, todayStart, overdueEnd);
        for (const dose of overdueDoses) {
          if (administrationResolvesDose(administrationStatusByDose.get(dose.doseKey))) continue;
          const residentName = dose.medication.residentName || "Paciente";
          notificationsToCreate.push(...buildNotificationForUsers(overdueUsers, {
            organizationId: organization.id,
            staffId: null,
            type: NOTIFICATION_TYPES.medicationDoseOverdue,
            severity: "error",
            sourceModule: "medications",
            title: "Dose de medicamento em atraso",
            message: `${residentName}: ${dose.medication.name} ${dose.medication.dosage} estava prevista para ${formatNotificationDateTime(dose.scheduledFor)}.`,
            actionUrl: buildMedicationActionUrl(dose),
            entityType: "medication_dose",
            entityId: dose.medication.id,
            dedupeKey: `medication-dose:${dose.doseKey}:overdue`,
            metadata: JSON.stringify({
              medicationId: dose.medication.id,
              residentId: dose.medication.residentId,
              scheduledFor: dose.scheduledFor.toISOString(),
              notificationKind: "overdue",
            }),
            scheduledFor: now,
            deliveredAt: now,
            readAt: null,
            cancelledAt: null,
          }));
        }
      }

      if (notificationsToCreate.length === 0) continue;
      const created = await storage.createNotifications(notificationsToCreate);
      createdTotal += created.length;
      void sendWebPushNotifications(created as AppNotification[]).catch((error) => {
        console.error("[medication-notifications] erro ao enviar Web Push", error);
      });
    }

    if (createdTotal > 0) {
      console.log(`[medication-notifications] notificações criadas=${createdTotal}`);
    }
  } catch (error) {
    console.error("[medication-notifications] erro no worker", error);
  } finally {
    running = false;
  }
}

export function startMedicationNotificationWorker() {
  if (started) return;
  started = true;
  const config = loadMedicationNotificationConfig();
  if (!config.enabled) {
    console.log("[medication-notifications] desabilitado");
    return;
  }

  console.log(
    `[medication-notifications] habilitado | intervalo=${config.intervalSeconds}s | lembrete=${config.reminderBeforeMinutes}min | atraso=${config.overdueAfterMinutes}min`,
  );
  void dispatchMedicationNotifications(config);
  timer = setInterval(() => {
    void dispatchMedicationNotifications(config);
  }, config.intervalSeconds * 1000);
}

export function stopMedicationNotificationWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  running = false;
}
