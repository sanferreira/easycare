import { db } from "./db";
import {
  users, organizations, notifications, pushSubscriptions, residents, medications, staff, occurrences, shiftAssignments,
  medicalRecords, comorbidities, familyMembers, patientDocuments, contracts, monthlyFees, accountsPayable, medicationAdministrations, crmOpportunities,
  timeClockLocations, timeClockEntries, timeClockAdjustmentRequests, timeClockAuditLogs, timeClockClosures,
  type User, type InsertUser,
  type Organization, type InsertOrganization,
  type AppNotification, type InsertNotification,
  type PushSubscriptionRecord, type InsertPushSubscription,
  type Resident, type InsertResident, type UpdateResidentRequest,
  type Medication, type InsertMedication, type UpdateMedicationRequest,
  type StaffMember, type InsertStaff, type UpdateStaffRequest,
  type Occurrence, type InsertOccurrence, type UpdateOccurrenceRequest,
  type ShiftAssignment, type InsertShiftAssignment, type UpdateShiftAssignmentRequest,
  type MedicalRecord, type InsertMedicalRecord,
  type Comorbidity, type InsertComorbidity,
  type FamilyMember, type InsertFamilyMember,
  type PatientDocument, type InsertPatientDocument,
  type Contract, type InsertContract, type UpdateContractRequest,
  type MonthlyFee, type InsertMonthlyFee, type UpdateMonthlyFeeRequest,
  type AccountPayable, type InsertAccountPayable, type UpdateAccountPayableRequest,
  type MedicationAdministration, type InsertMedicationAdministration,
  type CrmOpportunity, type InsertCrmOpportunity, type UpdateCrmOpportunityRequest,
  type TimeClockLocation, type InsertTimeClockLocation, type UpdateTimeClockLocationRequest,
  type TimeClockEntry, type InsertTimeClockEntry, type UpdateTimeClockEntryRequest,
  type TimeClockAdjustmentRequest, type InsertTimeClockAdjustmentRequest, type UpdateTimeClockAdjustmentRequest,
  type TimeClockAuditLog, type InsertTimeClockAuditLog,
  type TimeClockClosure, type InsertTimeClockClosure, type UpdateTimeClockClosureRequest,
  type DashboardStats,
} from "@shared/schema";
import { eq, like, desc, sql, and, gte, lte, ilike, asc, inArray, getTableColumns, isNull, or } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm/alias";
import { hashPassword, isPasswordHash } from "./security";

const normalizePortalUsername = (username: string) => username.trim().toLowerCase();
const normalizeOrganizationStatus = (org: Partial<Organization>): "active" | "inactive" | "restricted" => {
  const rawStatus = typeof org.status === "string" ? org.status.toLowerCase().trim() : "";
  if (rawStatus === "active" || rawStatus === "inactive" || rawStatus === "restricted") {
    return rawStatus;
  }
  return org.active === false ? "inactive" : "active";
};

const MEDICATION_TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const HOUR_IN_MS = 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;

type ParsedMedicationTime = { hour: number; minute: number; label: string };
type CrmOpportunityQuery = {
  stage?: string;
  search?: string;
  ownerId?: number;
  ownerStaffId?: number;
  source?: string;
  expectedCloseFrom?: string;
  expectedCloseTo?: string;
  followUpStatus?: "pending" | "overdue" | "today" | "none";
};
type PaginatedCrmOpportunities = {
  items: (CrmOpportunity & { ownerName?: string | null; ownerStaffName?: string | null })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalAmount: number;
  stageCounts: Array<{ stage: string; count: number; amount: number }>;
};

function parseDateOnly(value: string | Date | null | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    return date;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function parseMedicationScheduleTimes(scheduleTime: string | null | undefined): ParsedMedicationTime[] {
  const parsedTimes: ParsedMedicationTime[] = [];
  if (scheduleTime && scheduleTime.trim().length > 0) {
    const tokens = scheduleTime
      .split(/[\n,;|]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

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

  const dedupMap = new Map<string, ParsedMedicationTime>();
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

function buildMedicationDoseKey(medicationId: number, scheduledFor: Date): string {
  const minuteBucket = Math.round(scheduledFor.getTime() / MINUTE_IN_MS);
  return `${medicationId}:${minuteBucket}`;
}

function countOverdueMedicationDoses(
  activeMedications: Medication[],
  administrations: Array<Pick<MedicationAdministration, "medicationId" | "scheduledFor" | "status">>,
  now = new Date(),
): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const administrationByDoseKey = new Map<string, string | null>();

  administrations.forEach((admin) => {
    if (!admin.scheduledFor) return;
    const scheduledFor = new Date(admin.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return;
    administrationByDoseKey.set(buildMedicationDoseKey(admin.medicationId, scheduledFor), admin.status ?? null);
  });

  let overdueCount = 0;
  for (const medication of activeMedications) {
    if (isOnDemandFrequency(medication.frequency)) continue;

    const medicationStart = parseDateOnly(medication.startDate);
    const medicationEnd = parseDateOnly(medication.endDate, true);
    const effectiveStart = new Date(Math.max(todayStart.getTime(), medicationStart?.getTime() ?? todayStart.getTime()));
    const effectiveEnd = new Date(Math.min(now.getTime(), medicationEnd?.getTime() ?? now.getTime()));
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
        const status = administrationByDoseKey.get(buildMedicationDoseKey(medication.id, occurrenceCursor));
        if (status !== "given" && status !== "skipped" && status !== "refused" && status !== "late") {
          overdueCount++;
        }
        occurrenceCursor = new Date(occurrenceCursor.getTime() + stepInMs);
      }
      continue;
    }

    const explicitTimes = scheduleTimes.length > 0 ? scheduleTimes : [{ hour: 8, minute: 0, label: "08:00" }];
    for (const scheduledTime of explicitTimes) {
      const scheduledFor = new Date(
        todayStart.getFullYear(),
        todayStart.getMonth(),
        todayStart.getDate(),
        scheduledTime.hour,
        scheduledTime.minute,
        0,
        0,
      );
      if (scheduledFor.getTime() < effectiveStart.getTime() || scheduledFor.getTime() > effectiveEnd.getTime()) {
        continue;
      }
      const status = administrationByDoseKey.get(buildMedicationDoseKey(medication.id, scheduledFor));
      if (status !== "given" && status !== "skipped" && status !== "refused" && status !== "late") {
        overdueCount++;
      }
    }
  }

  return overdueCount;
}

export interface IStorage {
  // Organizations
  getOrganizations(includeInactive?: boolean): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationByCnpj(cnpj: string): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: number): Promise<void>;

  // Users
  getSuperAdminByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsernameAndOrganization(username: string, organizationId: number): Promise<User | undefined>;
  getUsersByOrganization(orgId: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  // Notifications
  getNotifications(orgId: number, userId: number, query?: { unreadOnly?: boolean; limit?: number }): Promise<AppNotification[]>;
  countUnreadNotifications(orgId: number, userId: number): Promise<number>;
  createNotification(notification: InsertNotification): Promise<AppNotification>;
  createNotifications(items: InsertNotification[]): Promise<AppNotification[]>;
  upsertPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscriptionRecord>;
  getActivePushSubscriptions(orgId: number, userId: number): Promise<PushSubscriptionRecord[]>;
  deactivatePushSubscription(orgId: number, userId: number, endpoint: string): Promise<number>;
  deactivatePushSubscriptionByEndpoint(endpoint: string): Promise<number>;
  cancelScheduledNotifications(
    orgId: number,
    query: { types?: string[]; entityType?: string; entityId?: number; staffId?: number; futureOnly?: boolean },
  ): Promise<number>;
  markNotificationRead(orgId: number, userId: number, id: number): Promise<AppNotification | undefined>;
  markAllNotificationsRead(orgId: number, userId: number): Promise<number>;
  getDueWhatsappNotifications(query: {
    limit?: number;
    lookbackMinutes?: number;
    maxAttempts?: number;
    sourceModule?: string;
    types?: string[];
  }): Promise<(AppNotification & {
    userName?: string | null;
    userPhone?: string | null;
    staffName?: string | null;
    staffPhone?: string | null;
    organizationName?: string | null;
  })[]>;
  markNotificationWhatsappSent(id: number, messageId?: string | null): Promise<void>;
  markNotificationWhatsappFailed(id: number, error: string): Promise<void>;
  markNotificationWhatsappSkipped(id: number, reason: string): Promise<void>;
  getDuePushNotifications(query: {
    limit?: number;
    lookbackMinutes?: number;
    maxAttempts?: number;
    sourceModule?: string;
    types?: string[];
  }): Promise<AppNotification[]>;
  markNotificationPushSent(id: number): Promise<void>;
  markNotificationPushFailed(id: number, error: string): Promise<void>;
  markNotificationPushSkipped(id: number, reason: string): Promise<void>;

  // Residents
  getResidents(orgId: number, query?: { search?: string; status?: string }): Promise<Resident[]>;
  getResident(orgId: number, id: number): Promise<Resident | undefined>;
  createResident(resident: InsertResident): Promise<Resident>;
  updateResident(orgId: number, id: number, updates: UpdateResidentRequest): Promise<Resident>;
  deleteResident(orgId: number, id: number): Promise<void>;

  // Family Members
  getFamilyMembers(orgId: number, residentId: number): Promise<FamilyMember[]>;
  getFamilyMemberByPortalUsername(username: string): Promise<FamilyMember | undefined>;
  getFamilyMembersByPortalUsername(username: string): Promise<FamilyMember[]>;
  createFamilyMember(member: InsertFamilyMember): Promise<FamilyMember>;
  updateFamilyMember(orgId: number, id: number, updates: Partial<InsertFamilyMember>): Promise<FamilyMember>;
  deleteFamilyMember(orgId: number, id: number): Promise<void>;

  // Patient Documents
  getPatientDocuments(orgId: number, residentId: number): Promise<PatientDocument[]>;
  createPatientDocument(document: InsertPatientDocument): Promise<PatientDocument>;
  deletePatientDocument(orgId: number, id: number): Promise<void>;

  // Comorbidities
  getComorbidities(orgId: number, residentId: number): Promise<Comorbidity[]>;
  createComorbidity(comorbidity: InsertComorbidity): Promise<Comorbidity>;
  updateComorbidity(orgId: number, id: number, updates: Partial<InsertComorbidity>): Promise<Comorbidity>;
  deleteComorbidity(orgId: number, id: number): Promise<void>;

  // Medical Records / Prontuário
  getMedicalRecords(orgId: number, residentId: number, type?: string): Promise<(MedicalRecord & { staffName?: string | null })[]>;
  getMedicalRecord(orgId: number, id: number): Promise<MedicalRecord | undefined>;
  createMedicalRecord(record: InsertMedicalRecord): Promise<MedicalRecord>;
  updateMedicalRecord(orgId: number, id: number, updates: Partial<InsertMedicalRecord>): Promise<MedicalRecord>;
  deleteMedicalRecord(orgId: number, id: number): Promise<void>;

  // Medications
  getMedications(orgId: number, residentId?: number): Promise<(Medication & { residentName?: string })[]>;
  createMedication(medication: InsertMedication): Promise<Medication>;
  updateMedication(orgId: number, id: number, updates: UpdateMedicationRequest): Promise<Medication>;
  deleteMedication(orgId: number, id: number): Promise<void>;

  // Medication Administrations
  getMedicationAdministrations(orgId: number, residentId?: number, medicationId?: number): Promise<(MedicationAdministration & { medicationName?: string; residentName?: string; administeredByName?: string })[]>;
  createMedicationAdministration(admin: InsertMedicationAdministration): Promise<MedicationAdministration>;
  upsertMedicationAdministrationForDose(input: {
    organizationId: number;
    medicationId: number;
    residentId: number;
    staffId: number | null;
    scheduledFor: Date;
    administeredAt: Date;
    status: "given" | "skipped" | "refused" | "late";
    notes: string | null;
  }): Promise<MedicationAdministration>;

  // Staff
  getStaff(orgId: number): Promise<StaffMember[]>;
  getStaffMember(orgId: number, id: number): Promise<StaffMember | undefined>;
  createStaff(member: InsertStaff): Promise<StaffMember>;
  updateStaff(orgId: number, id: number, updates: UpdateStaffRequest): Promise<StaffMember>;
  deleteStaff(orgId: number, id: number): Promise<void>;

  // Occurrences
  getOccurrences(orgId: number, residentId?: number): Promise<(Occurrence & { residentName?: string })[]>;
  createOccurrence(occurrence: InsertOccurrence): Promise<Occurrence>;
  updateOccurrence(orgId: number, id: number, updates: UpdateOccurrenceRequest): Promise<Occurrence>;
  deleteOccurrence(orgId: number, id: number): Promise<boolean>;

  // Shift Assignments
  getShiftAssignments(orgId: number, query?: { residentId?: number; staffId?: number; start?: Date; end?: Date }): Promise<(ShiftAssignment & { residentName?: string; staffName?: string })[]>;
  createShiftAssignment(assignment: InsertShiftAssignment): Promise<ShiftAssignment>;
  updateShiftAssignment(orgId: number, id: number, updates: UpdateShiftAssignmentRequest): Promise<ShiftAssignment>;
  deleteShiftAssignment(orgId: number, id: number): Promise<void>;

  // Time Clock
  getTimeClockLocations(orgId: number): Promise<TimeClockLocation[]>;
  createTimeClockLocation(location: InsertTimeClockLocation): Promise<TimeClockLocation>;
  updateTimeClockLocation(orgId: number, id: number, updates: UpdateTimeClockLocationRequest): Promise<TimeClockLocation>;
  getTimeClockEntries(
    orgId: number,
    query?: { staffId?: number; start?: Date; end?: Date; status?: string },
  ): Promise<(TimeClockEntry & { staffName?: string | null; locationName?: string | null; locationAddress?: string | null })[]>;
  getTimeClockEntry(orgId: number, id: number): Promise<TimeClockEntry | undefined>;
  createTimeClockEntry(entry: InsertTimeClockEntry): Promise<TimeClockEntry>;
  updateTimeClockEntry(orgId: number, id: number, updates: UpdateTimeClockEntryRequest): Promise<TimeClockEntry | undefined>;
  getTimeClockAdjustmentRequests(
    orgId: number,
    query?: { staffId?: number; status?: string; start?: Date; end?: Date },
  ): Promise<(TimeClockAdjustmentRequest & { staffName?: string | null; requestedByName?: string | null; reviewedByName?: string | null })[]>;
  getTimeClockAdjustmentRequest(orgId: number, id: number): Promise<TimeClockAdjustmentRequest | undefined>;
  createTimeClockAdjustmentRequest(request: InsertTimeClockAdjustmentRequest): Promise<TimeClockAdjustmentRequest>;
  updateTimeClockAdjustmentRequest(orgId: number, id: number, updates: UpdateTimeClockAdjustmentRequest): Promise<TimeClockAdjustmentRequest>;
  createTimeClockAuditLog(log: InsertTimeClockAuditLog): Promise<TimeClockAuditLog>;
  getTimeClockAuditLogs(orgId: number, query?: { staffId?: number; start?: Date; end?: Date }): Promise<(TimeClockAuditLog & { staffName?: string | null; performedByName?: string | null })[]>;
  getTimeClockClosure(orgId: number, referenceMonth: string): Promise<TimeClockClosure | undefined>;
  createTimeClockClosure(closure: InsertTimeClockClosure): Promise<TimeClockClosure>;
  updateTimeClockClosure(orgId: number, id: number, updates: UpdateTimeClockClosureRequest): Promise<TimeClockClosure>;

  // Contracts
  getContracts(orgId: number, residentId?: number): Promise<(Contract & { residentName?: string })[]>;
  getContract(orgId: number, id: number): Promise<Contract | undefined>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(orgId: number, id: number, updates: UpdateContractRequest): Promise<Contract>;
  deleteContract(orgId: number, id: number): Promise<void>;

  // Monthly Fees
  getMonthlyFees(
    orgId: number,
    query?: { contractId?: number; residentId?: number; status?: string; referenceMonth?: string },
  ): Promise<(MonthlyFee & { residentName?: string })[]>;
  createMonthlyFee(fee: InsertMonthlyFee): Promise<MonthlyFee>;
  updateMonthlyFee(orgId: number, id: number, updates: UpdateMonthlyFeeRequest): Promise<MonthlyFee>;
  deleteMonthlyFee(orgId: number, id: number): Promise<void>;

  // Accounts Payable
  getAccountsPayable(
    orgId: number,
    query?: { staffId?: number; status?: string; referenceMonth?: string },
  ): Promise<(AccountPayable & { staffName?: string })[]>;
  getAccountPayable(orgId: number, id: number): Promise<(AccountPayable & { staffName?: string }) | undefined>;
  createAccountPayable(item: InsertAccountPayable): Promise<AccountPayable>;
  updateAccountPayable(orgId: number, id: number, updates: UpdateAccountPayableRequest): Promise<AccountPayable>;
  deleteAccountPayable(orgId: number, id: number): Promise<void>;

  // CRM Opportunities
  getCrmOpportunities(
    orgId: number,
    query?: CrmOpportunityQuery,
  ): Promise<(CrmOpportunity & { ownerName?: string | null; ownerStaffName?: string | null })[]>;
  getCrmOpportunitiesPaginated(
    orgId: number,
    query?: CrmOpportunityQuery & { page?: number; pageSize?: number },
  ): Promise<PaginatedCrmOpportunities>;
  getCrmOpportunity(orgId: number, id: number): Promise<(CrmOpportunity & { ownerName?: string | null; ownerStaffName?: string | null }) | undefined>;
  createCrmOpportunity(item: InsertCrmOpportunity): Promise<CrmOpportunity>;
  updateCrmOpportunity(orgId: number, id: number, updates: UpdateCrmOpportunityRequest): Promise<CrmOpportunity>;
  deleteCrmOpportunity(orgId: number, id: number): Promise<void>;
  reassignCrmOpportunityStages(orgId: number, fromStages: string[], toStage: string): Promise<number>;

  // Stats
  getDashboardStats(orgId: number): Promise<DashboardStats>;
}

export class DatabaseStorage implements IStorage {
  // --- Organizations ---
  async getOrganizations(includeInactive = false): Promise<Organization[]> {
    const allOrganizations = await db.select().from(organizations).orderBy(organizations.name);
    if (includeInactive) return allOrganizations;
    return allOrganizations.filter((org) => normalizeOrganizationStatus(org) !== "inactive");
  }
  async getOrganization(id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }
  async getOrganizationByCnpj(cnpj: string): Promise<Organization | undefined> {
    const trimmed = cnpj.trim();
    if (!trimmed) return undefined;

    const [directMatch] = await db.select().from(organizations).where(eq(organizations.cnpj, trimmed));
    if (directMatch) return directMatch;

    const normalized = trimmed.replace(/\D/g, "");
    if (!normalized) return undefined;

    const [normalizedMatch] = await db
      .select()
      .from(organizations)
      .where(sql`regexp_replace(coalesce(${organizations.cnpj}, ''), '\D', '', 'g') = ${normalized}`);

    return normalizedMatch;
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [newOrg] = await db.insert(organizations).values(org).returning();
    return newOrg;
  }
  async updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization> {
    const [updated] = await db.update(organizations).set(updates).where(eq(organizations.id, id)).returning();
    return updated;
  }
  async deleteOrganization(id: number): Promise<void> {
    await db.delete(organizations).where(eq(organizations.id, id));
  }

  // --- Users ---
  async getSuperAdminByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(and(eq(users.username, username), eq(users.isSuperAdmin, true)));
    return user;
  }
  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  async getUserByUsernameAndOrganization(username: string, organizationId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(and(
      eq(users.username, username),
      eq(users.organizationId, organizationId),
      eq(users.isSuperAdmin, false),
    ));
    return user;
  }
  async getUsersByOrganization(orgId: number): Promise<User[]> {
    return await db.select().from(users).where(eq(users.organizationId, orgId));
  }
  async createUser(user: InsertUser): Promise<User> {
    const normalizedPassword = user.password.trim();
    if (!normalizedPassword) throw new Error("Senha do usuário não pode ser vazia");

    const payload: InsertUser = {
      ...user,
      password: isPasswordHash(normalizedPassword) ? normalizedPassword : hashPassword(normalizedPassword),
    };

    const [newUser] = await db.insert(users).values(payload).returning();
    return newUser;
  }
  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User> {
    const payload: Partial<InsertUser> = { ...updates };
    if (typeof payload.password === "string") {
      const normalizedPassword = payload.password.trim();
      if (!normalizedPassword) {
        delete payload.password;
      } else if (!isPasswordHash(normalizedPassword)) {
        payload.password = hashPassword(normalizedPassword);
      } else {
        payload.password = normalizedPassword;
      }
    }

    const [updated] = await db.update(users).set(payload).where(eq(users.id, id)).returning();
    return updated;
  }
  async deleteUser(id: number): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // --- Notifications ---
  async getNotifications(
    orgId: number,
    userId: number,
    query?: { unreadOnly?: boolean; limit?: number },
  ): Promise<AppNotification[]> {
    const now = new Date();
    const filters: any[] = [
      eq(notifications.organizationId, orgId),
      eq(notifications.userId, userId),
      isNull(notifications.cancelledAt),
      or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
    ];
    if (query?.unreadOnly) filters.push(isNull(notifications.readAt));
    const limit = Math.min(Math.max(query?.limit ?? 30, 1), 100);
    return await db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async countUnreadNotifications(orgId: number, userId: number): Promise<number> {
    const now = new Date();
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.cancelledAt),
        or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      ));
    return Number(row?.count ?? 0);
  }

  async createNotification(notification: InsertNotification): Promise<AppNotification> {
    const [created] = await db.insert(notifications).values(notification).returning();
    return created;
  }

  async createNotifications(items: InsertNotification[]): Promise<AppNotification[]> {
    if (items.length === 0) return [];
    return await db.insert(notifications).values(items).onConflictDoNothing().returning();
  }

  async upsertPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscriptionRecord> {
    const now = new Date();
    const payload: InsertPushSubscription = {
      ...subscription,
      active: true,
      lastSeenAt: now,
      updatedAt: now,
    };

    const [existing] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));

    if (existing) {
      const [updated] = await db
        .update(pushSubscriptions)
        .set(payload)
        .where(eq(pushSubscriptions.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(pushSubscriptions).values(payload).returning();
    return created;
  }

  async getActivePushSubscriptions(orgId: number, userId: number): Promise<PushSubscriptionRecord[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.organizationId, orgId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.active, true),
      ))
      .orderBy(desc(pushSubscriptions.lastSeenAt));
  }

  async deactivatePushSubscription(orgId: number, userId: number, endpoint: string): Promise<number> {
    const updated = await db
      .update(pushSubscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(pushSubscriptions.organizationId, orgId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ))
      .returning({ id: pushSubscriptions.id });
    return updated.length;
  }

  async deactivatePushSubscriptionByEndpoint(endpoint: string): Promise<number> {
    const updated = await db
      .update(pushSubscriptions)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning({ id: pushSubscriptions.id });
    return updated.length;
  }

  async cancelScheduledNotifications(
    orgId: number,
    query: { types?: string[]; entityType?: string; entityId?: number; staffId?: number; futureOnly?: boolean },
  ): Promise<number> {
    const filters: any[] = [
      eq(notifications.organizationId, orgId),
      isNull(notifications.cancelledAt),
    ];
    if (query.types && query.types.length > 0) filters.push(inArray(notifications.type, query.types));
    if (query.entityType) filters.push(eq(notifications.entityType, query.entityType));
    if (query.entityId) filters.push(eq(notifications.entityId, query.entityId));
    if (query.staffId) filters.push(eq(notifications.staffId, query.staffId));
    if (query.futureOnly !== false) filters.push(gte(notifications.scheduledFor, new Date()));
    const updated = await db
      .update(notifications)
      .set({ cancelledAt: new Date() })
      .where(and(...filters))
      .returning({ id: notifications.id });
    return updated.length;
  }

  async markNotificationRead(orgId: number, userId: number, id: number): Promise<AppNotification | undefined> {
    const [updated] = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.cancelledAt),
      ))
      .returning();
    return updated;
  }

  async markAllNotificationsRead(orgId: number, userId: number): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        isNull(notifications.cancelledAt),
      ))
      .returning({ id: notifications.id });
    return updated.length;
  }

  async getDueWhatsappNotifications(query: {
    limit?: number;
    lookbackMinutes?: number;
    maxAttempts?: number;
    sourceModule?: string;
    types?: string[];
  }): Promise<(AppNotification & {
    userName?: string | null;
    userPhone?: string | null;
    staffName?: string | null;
    staffPhone?: string | null;
    organizationName?: string | null;
  })[]> {
    const now = new Date();
    const lookbackMinutes = Math.min(Math.max(query.lookbackMinutes ?? 1440, 1), 60 * 24 * 30);
    const lookbackStart = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    const maxAttempts = Math.min(Math.max(query.maxAttempts ?? 3, 1), 10);
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const filters: any[] = [
      isNull(notifications.cancelledAt),
      or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      or(isNull(notifications.scheduledFor), gte(notifications.scheduledFor, lookbackStart)),
      or(isNull(notifications.whatsappStatus), inArray(notifications.whatsappStatus, ["pending", "failed"])),
      sql`coalesce(${notifications.whatsappAttempts}, 0) < ${maxAttempts}`,
    ];
    if (query.sourceModule) filters.push(eq(notifications.sourceModule, query.sourceModule));
    if (query.types && query.types.length > 0) filters.push(inArray(notifications.type, query.types));

    return await db
      .select({
        ...getTableColumns(notifications),
        userName: users.name,
        userPhone: users.phone,
        staffName: staff.name,
        staffPhone: staff.phone,
        organizationName: organizations.name,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.userId, users.id))
      .leftJoin(staff, eq(notifications.staffId, staff.id))
      .leftJoin(organizations, eq(notifications.organizationId, organizations.id))
      .where(and(...filters))
      .orderBy(asc(notifications.scheduledFor), asc(notifications.id))
      .limit(limit) as any;
  }

  async markNotificationWhatsappSent(id: number, messageId?: string | null): Promise<void> {
    await db
      .update(notifications)
      .set({
        whatsappStatus: "sent",
        whatsappSentAt: new Date(),
        whatsappMessageId: messageId ?? null,
        whatsappError: null,
      })
      .where(eq(notifications.id, id));
  }

  async markNotificationWhatsappFailed(id: number, error: string): Promise<void> {
    await db
      .update(notifications)
      .set({
        whatsappStatus: "failed",
        whatsappAttempts: sql`${notifications.whatsappAttempts} + 1` as any,
        whatsappError: error.slice(0, 1000),
      })
      .where(eq(notifications.id, id));
  }

  async markNotificationWhatsappSkipped(id: number, reason: string): Promise<void> {
    await db
      .update(notifications)
      .set({
        whatsappStatus: "skipped",
        whatsappError: reason.slice(0, 1000),
      })
      .where(eq(notifications.id, id));
  }

  async getDuePushNotifications(query: {
    limit?: number;
    lookbackMinutes?: number;
    maxAttempts?: number;
    sourceModule?: string;
    types?: string[];
  }): Promise<AppNotification[]> {
    const now = new Date();
    const lookbackMinutes = Math.min(Math.max(query.lookbackMinutes ?? 1440, 1), 60 * 24 * 30);
    const lookbackStart = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    const maxAttempts = Math.min(Math.max(query.maxAttempts ?? 3, 1), 10);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const filters: any[] = [
      isNull(notifications.cancelledAt),
      or(isNull(notifications.scheduledFor), lte(notifications.scheduledFor, now)),
      or(isNull(notifications.scheduledFor), gte(notifications.scheduledFor, lookbackStart)),
      or(isNull(notifications.pushStatus), inArray(notifications.pushStatus, ["pending", "failed"])),
      sql`coalesce(${notifications.pushAttempts}, 0) < ${maxAttempts}`,
      sql`${notifications.userId} IS NOT NULL`,
    ];
    if (query.sourceModule) filters.push(eq(notifications.sourceModule, query.sourceModule));
    if (query.types && query.types.length > 0) filters.push(inArray(notifications.type, query.types));

    return await db
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(asc(notifications.scheduledFor), asc(notifications.id))
      .limit(limit);
  }

  async markNotificationPushSent(id: number): Promise<void> {
    await db
      .update(notifications)
      .set({
        pushStatus: "sent",
        pushSentAt: new Date(),
        pushError: null,
      })
      .where(eq(notifications.id, id));
  }

  async markNotificationPushFailed(id: number, error: string): Promise<void> {
    await db
      .update(notifications)
      .set({
        pushStatus: "failed",
        pushAttempts: sql`${notifications.pushAttempts} + 1` as any,
        pushError: error.slice(0, 1000),
      })
      .where(eq(notifications.id, id));
  }

  async markNotificationPushSkipped(id: number, reason: string): Promise<void> {
    await db
      .update(notifications)
      .set({
        pushStatus: "skipped",
        pushError: reason.slice(0, 1000),
      })
      .where(eq(notifications.id, id));
  }

  // --- Residents ---
  async getResidents(orgId: number, query?: { search?: string; status?: string }): Promise<Resident[]> {
    const filters: any[] = [eq(residents.organizationId, orgId)];
    if (query?.search) filters.push(ilike(residents.name, `%${query.search}%`));
    if (query?.status) filters.push(eq(residents.status, query.status));
    return await db.select().from(residents).where(and(...filters)).orderBy(residents.name);
  }
  async getResident(orgId: number, id: number): Promise<Resident | undefined> {
    const [resident] = await db.select().from(residents).where(and(eq(residents.id, id), eq(residents.organizationId, orgId)));
    return resident;
  }
  async createResident(resident: InsertResident): Promise<Resident> {
    const [newResident] = await db.insert(residents).values(resident).returning();
    return newResident;
  }
  async updateResident(orgId: number, id: number, updates: UpdateResidentRequest): Promise<Resident> {
    const [updated] = await db.update(residents).set(updates).where(and(eq(residents.id, id), eq(residents.organizationId, orgId))).returning();
    return updated;
  }
  async deleteResident(orgId: number, id: number): Promise<void> {
    await db.delete(residents).where(and(eq(residents.id, id), eq(residents.organizationId, orgId)));
  }

  // --- Family Members ---
  async getFamilyMembers(orgId: number, residentId: number): Promise<FamilyMember[]> {
    return await db.select().from(familyMembers)
      .where(and(eq(familyMembers.organizationId, orgId), eq(familyMembers.residentId, residentId)))
      .orderBy(desc(familyMembers.isPrimary), familyMembers.name);
  }
  async getFamilyMembersByPortalUsername(username: string): Promise<FamilyMember[]> {
    const normalized = normalizePortalUsername(username);
    if (!normalized) return [];

    return await db
      .select()
      .from(familyMembers)
      .where(and(
        sql`lower(coalesce(${familyMembers.portalUsername}, '')) = ${normalized}`,
        eq(familyMembers.portalAccess, true),
      ));
  }
  async getFamilyMemberByPortalUsername(username: string): Promise<FamilyMember | undefined> {
    const [member] = await this.getFamilyMembersByPortalUsername(username);
    return member;
  }
  async createFamilyMember(member: InsertFamilyMember): Promise<FamilyMember> {
    const payload: InsertFamilyMember = { ...member };
    if (typeof payload.portalUsername === "string") {
      const normalizedUsername = normalizePortalUsername(payload.portalUsername);
      payload.portalUsername = normalizedUsername || null;
    }
    if (typeof payload.portalPassword === "string") {
      const normalizedPassword = payload.portalPassword.trim();
      payload.portalPassword = normalizedPassword ? hashPassword(normalizedPassword) : null;
    }

    const [newMember] = await db.insert(familyMembers).values(payload).returning();
    return newMember;
  }
  async updateFamilyMember(orgId: number, id: number, updates: Partial<InsertFamilyMember>): Promise<FamilyMember> {
    const payload: Partial<InsertFamilyMember> = { ...updates };
    if (typeof payload.portalUsername === "string") {
      const normalizedUsername = normalizePortalUsername(payload.portalUsername);
      payload.portalUsername = normalizedUsername || null;
    }
    if (typeof payload.portalPassword === "string") {
      const normalizedPassword = payload.portalPassword.trim();
      payload.portalPassword = normalizedPassword ? hashPassword(normalizedPassword) : null;
    }

    const [updated] = await db.update(familyMembers).set(payload).where(and(eq(familyMembers.id, id), eq(familyMembers.organizationId, orgId))).returning();
    return updated;
  }
  async deleteFamilyMember(orgId: number, id: number): Promise<void> {
    await db.delete(familyMembers).where(and(eq(familyMembers.id, id), eq(familyMembers.organizationId, orgId)));
  }

  // --- Patient Documents ---
  async getPatientDocuments(orgId: number, residentId: number): Promise<PatientDocument[]> {
    return await db
      .select()
      .from(patientDocuments)
      .where(and(
        eq(patientDocuments.organizationId, orgId),
        eq(patientDocuments.residentId, residentId),
      ))
      .orderBy(desc(patientDocuments.createdAt), desc(patientDocuments.id));
  }

  async createPatientDocument(document: InsertPatientDocument): Promise<PatientDocument> {
    const [created] = await db.insert(patientDocuments).values(document).returning();
    return created;
  }

  async deletePatientDocument(orgId: number, id: number): Promise<void> {
    await db
      .delete(patientDocuments)
      .where(and(eq(patientDocuments.id, id), eq(patientDocuments.organizationId, orgId)));
  }

  // --- Comorbidities ---
  async getComorbidities(orgId: number, residentId: number): Promise<Comorbidity[]> {
    return await db.select().from(comorbidities)
      .where(and(eq(comorbidities.organizationId, orgId), eq(comorbidities.residentId, residentId)))
      .orderBy(comorbidities.name);
  }
  async createComorbidity(comorbidity: InsertComorbidity): Promise<Comorbidity> {
    const [newC] = await db.insert(comorbidities).values(comorbidity).returning();
    return newC;
  }
  async updateComorbidity(orgId: number, id: number, updates: Partial<InsertComorbidity>): Promise<Comorbidity> {
    const [updated] = await db.update(comorbidities).set(updates).where(and(eq(comorbidities.id, id), eq(comorbidities.organizationId, orgId))).returning();
    return updated;
  }
  async deleteComorbidity(orgId: number, id: number): Promise<void> {
    await db.delete(comorbidities).where(and(eq(comorbidities.id, id), eq(comorbidities.organizationId, orgId)));
  }

  // --- Medical Records ---
  async getMedicalRecords(orgId: number, residentId: number, type?: string): Promise<(MedicalRecord & { staffName?: string | null })[]> {
    const filters: any[] = [eq(medicalRecords.organizationId, orgId), eq(medicalRecords.residentId, residentId)];
    if (type) filters.push(eq(medicalRecords.type, type));
    return await db
      .select({
        ...getTableColumns(medicalRecords),
        staffName: staff.name,
      })
      .from(medicalRecords)
      .leftJoin(staff, and(eq(medicalRecords.staffId, staff.id), eq(staff.organizationId, orgId)))
      .where(and(...filters))
      .orderBy(desc(medicalRecords.date), desc(medicalRecords.createdAt));
  }
  async getMedicalRecord(orgId: number, id: number): Promise<MedicalRecord | undefined> {
    const [record] = await db.select().from(medicalRecords).where(and(eq(medicalRecords.id, id), eq(medicalRecords.organizationId, orgId)));
    return record;
  }
  async createMedicalRecord(record: InsertMedicalRecord): Promise<MedicalRecord> {
    const [newRecord] = await db.insert(medicalRecords).values(record).returning();
    return newRecord;
  }
  async updateMedicalRecord(orgId: number, id: number, updates: Partial<InsertMedicalRecord>): Promise<MedicalRecord> {
    const [updated] = await db.update(medicalRecords).set(updates).where(and(eq(medicalRecords.id, id), eq(medicalRecords.organizationId, orgId))).returning();
    return updated;
  }
  async deleteMedicalRecord(orgId: number, id: number): Promise<void> {
    await db.delete(medicalRecords).where(and(eq(medicalRecords.id, id), eq(medicalRecords.organizationId, orgId)));
  }

  // --- Medications ---
  async getMedications(orgId: number, residentId?: number): Promise<(Medication & { residentName?: string })[]> {
    const filters: any[] = [eq(medications.organizationId, orgId)];
    if (residentId) filters.push(eq(medications.residentId, residentId));
    return await db.select({
      id: medications.id,
      organizationId: medications.organizationId,
      residentId: medications.residentId,
      name: medications.name,
      dosage: medications.dosage,
      frequency: medications.frequency,
      route: medications.route,
      scheduleTime: medications.scheduleTime,
      startDate: medications.startDate,
      endDate: medications.endDate,
      prescribedBy: medications.prescribedBy,
      notes: medications.notes,
      status: medications.status,
      nextDue: medications.nextDue,
      residentName: residents.name,
    }).from(medications).leftJoin(residents, eq(medications.residentId, residents.id)).where(and(...filters)).orderBy(medications.name) as any;
  }
  async createMedication(medication: InsertMedication): Promise<Medication> {
    const [newMed] = await db.insert(medications).values(medication).returning();
    return newMed;
  }
  async updateMedication(orgId: number, id: number, updates: UpdateMedicationRequest): Promise<Medication> {
    const [updated] = await db.update(medications).set(updates).where(and(eq(medications.id, id), eq(medications.organizationId, orgId))).returning();
    return updated;
  }
  async deleteMedication(orgId: number, id: number): Promise<void> {
    await db.delete(medications).where(and(eq(medications.id, id), eq(medications.organizationId, orgId)));
  }

  // --- Medication Administrations ---
  async getMedicationAdministrations(orgId: number, residentId?: number, medicationId?: number): Promise<(MedicationAdministration & { medicationName?: string; residentName?: string; administeredByName?: string })[]> {
    const filters: any[] = [eq(medicationAdministrations.organizationId, orgId)];
    if (residentId) filters.push(eq(medicationAdministrations.residentId, residentId));
    if (medicationId) filters.push(eq(medicationAdministrations.medicationId, medicationId));
    return await db.select({
      id: medicationAdministrations.id,
      organizationId: medicationAdministrations.organizationId,
      medicationId: medicationAdministrations.medicationId,
      residentId: medicationAdministrations.residentId,
      staffId: medicationAdministrations.staffId,
      scheduledFor: medicationAdministrations.scheduledFor,
      administeredAt: medicationAdministrations.administeredAt,
      status: medicationAdministrations.status,
      notes: medicationAdministrations.notes,
      medicationName: medications.name,
      residentName: residents.name,
      administeredByName: sql<string>`coalesce(${staff.name}, ${users.name})`,
    }).from(medicationAdministrations)
      .leftJoin(medications, eq(medicationAdministrations.medicationId, medications.id))
      .leftJoin(residents, eq(medicationAdministrations.residentId, residents.id))
      .leftJoin(users, eq(medicationAdministrations.staffId, users.id))
      .leftJoin(staff, eq(medicationAdministrations.staffId, staff.id))
      .where(and(...filters))
      .orderBy(desc(medicationAdministrations.administeredAt)) as any;
  }
  async createMedicationAdministration(admin: InsertMedicationAdministration): Promise<MedicationAdministration> {
    const [newAdmin] = await db.insert(medicationAdministrations).values(admin).returning();
    return newAdmin;
  }
  async upsertMedicationAdministrationForDose(input: {
    organizationId: number;
    medicationId: number;
    residentId: number;
    staffId: number | null;
    scheduledFor: Date;
    administeredAt: Date;
    status: "given" | "skipped" | "refused" | "late";
    notes: string | null;
  }): Promise<MedicationAdministration> {
    const toleranceInMs = 30 * 1000;
    const scheduledFrom = new Date(input.scheduledFor.getTime() - toleranceInMs);
    const scheduledTo = new Date(input.scheduledFor.getTime() + toleranceInMs);

    const existingMatches = await db.select()
      .from(medicationAdministrations)
      .where(and(
        eq(medicationAdministrations.organizationId, input.organizationId),
        eq(medicationAdministrations.medicationId, input.medicationId),
        eq(medicationAdministrations.residentId, input.residentId),
        gte(medicationAdministrations.scheduledFor, scheduledFrom),
        lte(medicationAdministrations.scheduledFor, scheduledTo),
      ))
      .orderBy(desc(medicationAdministrations.id));

    const existing = existingMatches[0];
    if (existing) {
      const [updated] = await db.update(medicationAdministrations)
        .set({
          staffId: input.staffId,
          scheduledFor: input.scheduledFor,
          administeredAt: input.administeredAt,
          status: input.status,
          notes: input.notes,
        })
        .where(and(
          eq(medicationAdministrations.id, existing.id),
          eq(medicationAdministrations.organizationId, input.organizationId),
        ))
        .returning();
      return updated;
    }

    const [created] = await db.insert(medicationAdministrations)
      .values({
        organizationId: input.organizationId,
        medicationId: input.medicationId,
        residentId: input.residentId,
        staffId: input.staffId,
        scheduledFor: input.scheduledFor,
        administeredAt: input.administeredAt,
        status: input.status,
        notes: input.notes,
      })
      .returning();
    return created;
  }

  // --- Staff ---
  async getStaff(orgId: number): Promise<StaffMember[]> {
    return await db.select().from(staff).where(eq(staff.organizationId, orgId)).orderBy(staff.name);
  }
  async getStaffMember(orgId: number, id: number): Promise<StaffMember | undefined> {
    const [member] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.organizationId, orgId)));
    return member;
  }
  async createStaff(member: InsertStaff): Promise<StaffMember> {
    const [newStaff] = await db.insert(staff).values(member).returning();
    return newStaff;
  }
  async updateStaff(orgId: number, id: number, updates: UpdateStaffRequest): Promise<StaffMember> {
    const [updated] = await db.update(staff).set(updates).where(and(eq(staff.id, id), eq(staff.organizationId, orgId))).returning();
    return updated;
  }
  async deleteStaff(orgId: number, id: number): Promise<void> {
    await db.delete(staff).where(and(eq(staff.id, id), eq(staff.organizationId, orgId)));
  }

  // --- Occurrences ---
  async getOccurrences(orgId: number, residentId?: number): Promise<(Occurrence & { residentName?: string })[]> {
    const filters: any[] = [eq(occurrences.organizationId, orgId)];
    if (residentId) filters.push(eq(occurrences.residentId, residentId));
    return await db.select({
      id: occurrences.id,
      organizationId: occurrences.organizationId,
      residentId: occurrences.residentId,
      authorId: occurrences.authorId,
      type: occurrences.type,
      description: occurrences.description,
      severity: occurrences.severity,
      status: occurrences.status,
      resolution: occurrences.resolution,
      resolvedAt: occurrences.resolvedAt,
      createdAt: occurrences.createdAt,
      residentName: residents.name,
    }).from(occurrences).leftJoin(residents, eq(occurrences.residentId, residents.id)).where(and(...filters)).orderBy(desc(occurrences.createdAt)) as any;
  }
  async createOccurrence(occurrence: InsertOccurrence): Promise<Occurrence> {
    const [newOcc] = await db.insert(occurrences).values(occurrence).returning();
    return newOcc;
  }
  async updateOccurrence(orgId: number, id: number, updates: UpdateOccurrenceRequest): Promise<Occurrence> {
    const [updated] = await db.update(occurrences).set(updates).where(and(eq(occurrences.id, id), eq(occurrences.organizationId, orgId))).returning();
    return updated;
  }
  async deleteOccurrence(orgId: number, id: number): Promise<boolean> {
    const deleted = await db
      .delete(occurrences)
      .where(and(eq(occurrences.id, id), eq(occurrences.organizationId, orgId)))
      .returning({ id: occurrences.id });
    return deleted.length > 0;
  }

  // --- Shift Assignments ---
  async getShiftAssignments(orgId: number, query?: { residentId?: number; staffId?: number; start?: Date; end?: Date }): Promise<(ShiftAssignment & { residentName?: string; staffName?: string })[]> {
    const filters: any[] = [eq(shiftAssignments.organizationId, orgId)];
    if (query?.residentId) filters.push(eq(shiftAssignments.residentId, query.residentId));
    if (query?.staffId) filters.push(eq(shiftAssignments.staffId, query.staffId));
    if (query?.start && query?.end) {
      // Include any shift that overlaps the period.
      filters.push(lte(shiftAssignments.startTime, query.end));
      filters.push(gte(shiftAssignments.endTime, query.start));
    } else {
      if (query?.start) filters.push(gte(shiftAssignments.endTime, query.start));
      if (query?.end) filters.push(lte(shiftAssignments.startTime, query.end));
    }
    return await db.select({
      id: shiftAssignments.id,
      organizationId: shiftAssignments.organizationId,
      residentId: shiftAssignments.residentId,
      staffId: shiftAssignments.staffId,
      shiftType: shiftAssignments.shiftType,
      startTime: shiftAssignments.startTime,
      endTime: shiftAssignments.endTime,
      notes: shiftAssignments.notes,
      createdAt: shiftAssignments.createdAt,
      residentName: residents.name,
      staffName: staff.name,
    }).from(shiftAssignments)
      .leftJoin(residents, eq(shiftAssignments.residentId, residents.id))
      .leftJoin(staff, eq(shiftAssignments.staffId, staff.id))
      .where(and(...filters))
      .orderBy(desc(shiftAssignments.startTime)) as any;
  }
  async createShiftAssignment(assignment: InsertShiftAssignment): Promise<ShiftAssignment> {
    const [newAssignment] = await db.insert(shiftAssignments).values(assignment).returning();
    return newAssignment;
  }
  async updateShiftAssignment(orgId: number, id: number, updates: UpdateShiftAssignmentRequest): Promise<ShiftAssignment> {
    const [updated] = await db.update(shiftAssignments).set(updates).where(and(eq(shiftAssignments.id, id), eq(shiftAssignments.organizationId, orgId))).returning();
    return updated;
  }
  async deleteShiftAssignment(orgId: number, id: number): Promise<void> {
    await db.delete(shiftAssignments).where(and(eq(shiftAssignments.id, id), eq(shiftAssignments.organizationId, orgId)));
  }

  // --- Time Clock ---
  async getTimeClockLocations(orgId: number): Promise<TimeClockLocation[]> {
    return await db
      .select()
      .from(timeClockLocations)
      .where(eq(timeClockLocations.organizationId, orgId))
      .orderBy(desc(timeClockLocations.active), asc(timeClockLocations.name));
  }
  async createTimeClockLocation(location: InsertTimeClockLocation): Promise<TimeClockLocation> {
    const [created] = await db.insert(timeClockLocations).values(location).returning();
    return created;
  }
  async updateTimeClockLocation(orgId: number, id: number, updates: UpdateTimeClockLocationRequest): Promise<TimeClockLocation> {
    const [updated] = await db
      .update(timeClockLocations)
      .set(updates)
      .where(and(eq(timeClockLocations.id, id), eq(timeClockLocations.organizationId, orgId)))
      .returning();
    return updated;
  }
  async getTimeClockEntries(
    orgId: number,
    query?: { staffId?: number; start?: Date; end?: Date; status?: string },
  ): Promise<(TimeClockEntry & { staffName?: string | null; locationName?: string | null; locationAddress?: string | null })[]> {
    const filters: any[] = [eq(timeClockEntries.organizationId, orgId)];
    if (query?.staffId) filters.push(eq(timeClockEntries.staffId, query.staffId));
    if (query?.status) filters.push(eq(timeClockEntries.status, query.status));
    if (query?.start) filters.push(gte(timeClockEntries.eventTime, query.start));
    if (query?.end) filters.push(lte(timeClockEntries.eventTime, query.end));

    return await db
      .select({
        ...getTableColumns(timeClockEntries),
        staffName: staff.name,
        locationName: timeClockLocations.name,
        locationAddress: timeClockLocations.address,
      })
      .from(timeClockEntries)
      .leftJoin(staff, eq(timeClockEntries.staffId, staff.id))
      .leftJoin(timeClockLocations, eq(timeClockEntries.locationId, timeClockLocations.id))
      .where(and(...filters))
      .orderBy(desc(timeClockEntries.eventTime));
  }
  async createTimeClockEntry(entry: InsertTimeClockEntry): Promise<TimeClockEntry> {
    const [created] = await db.insert(timeClockEntries).values(entry).returning();
    return created;
  }
  async getTimeClockEntry(orgId: number, id: number): Promise<TimeClockEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeClockEntries)
      .where(and(eq(timeClockEntries.id, id), eq(timeClockEntries.organizationId, orgId)));
    return entry;
  }
  async updateTimeClockEntry(orgId: number, id: number, updates: UpdateTimeClockEntryRequest): Promise<TimeClockEntry | undefined> {
    const [updated] = await db
      .update(timeClockEntries)
      .set(updates)
      .where(and(eq(timeClockEntries.id, id), eq(timeClockEntries.organizationId, orgId)))
      .returning();
    return updated;
  }
  async getTimeClockAdjustmentRequests(
    orgId: number,
    query?: { staffId?: number; status?: string; start?: Date; end?: Date },
  ): Promise<(TimeClockAdjustmentRequest & { staffName?: string | null; requestedByName?: string | null; reviewedByName?: string | null })[]> {
    const requestedUsers = aliasedTable(users, "time_clock_requested_users");
    const reviewedUsers = aliasedTable(users, "time_clock_reviewed_users");
    const filters: any[] = [eq(timeClockAdjustmentRequests.organizationId, orgId)];
    if (query?.staffId) filters.push(eq(timeClockAdjustmentRequests.staffId, query.staffId));
    if (query?.status) filters.push(eq(timeClockAdjustmentRequests.status, query.status));
    if (query?.start) filters.push(gte(timeClockAdjustmentRequests.requestedEventTime, query.start));
    if (query?.end) filters.push(lte(timeClockAdjustmentRequests.requestedEventTime, query.end));

    return await db
      .select({
        ...getTableColumns(timeClockAdjustmentRequests),
        staffName: staff.name,
        requestedByName: requestedUsers.name,
        reviewedByName: reviewedUsers.name,
      })
      .from(timeClockAdjustmentRequests)
      .leftJoin(staff, eq(timeClockAdjustmentRequests.staffId, staff.id))
      .leftJoin(requestedUsers, eq(timeClockAdjustmentRequests.requestedByUserId, requestedUsers.id))
      .leftJoin(reviewedUsers, eq(timeClockAdjustmentRequests.reviewedByUserId, reviewedUsers.id))
      .where(and(...filters))
      .orderBy(desc(timeClockAdjustmentRequests.createdAt)) as any;
  }
  async getTimeClockAdjustmentRequest(orgId: number, id: number): Promise<TimeClockAdjustmentRequest | undefined> {
    const [request] = await db
      .select()
      .from(timeClockAdjustmentRequests)
      .where(and(eq(timeClockAdjustmentRequests.id, id), eq(timeClockAdjustmentRequests.organizationId, orgId)));
    return request;
  }
  async createTimeClockAdjustmentRequest(request: InsertTimeClockAdjustmentRequest): Promise<TimeClockAdjustmentRequest> {
    const [created] = await db.insert(timeClockAdjustmentRequests).values(request).returning();
    return created;
  }
  async updateTimeClockAdjustmentRequest(orgId: number, id: number, updates: UpdateTimeClockAdjustmentRequest): Promise<TimeClockAdjustmentRequest> {
    const [updated] = await db
      .update(timeClockAdjustmentRequests)
      .set(updates)
      .where(and(eq(timeClockAdjustmentRequests.id, id), eq(timeClockAdjustmentRequests.organizationId, orgId)))
      .returning();
    return updated;
  }
  async createTimeClockAuditLog(log: InsertTimeClockAuditLog): Promise<TimeClockAuditLog> {
    const [created] = await db.insert(timeClockAuditLogs).values(log).returning();
    return created;
  }
  async getTimeClockAuditLogs(
    orgId: number,
    query?: { staffId?: number; start?: Date; end?: Date },
  ): Promise<(TimeClockAuditLog & { staffName?: string | null; performedByName?: string | null })[]> {
    const filters: any[] = [eq(timeClockAuditLogs.organizationId, orgId)];
    if (query?.staffId) filters.push(eq(timeClockAuditLogs.staffId, query.staffId));
    if (query?.start) filters.push(gte(timeClockAuditLogs.createdAt, query.start));
    if (query?.end) filters.push(lte(timeClockAuditLogs.createdAt, query.end));

    return await db
      .select({
        ...getTableColumns(timeClockAuditLogs),
        staffName: staff.name,
        performedByName: users.name,
      })
      .from(timeClockAuditLogs)
      .leftJoin(staff, eq(timeClockAuditLogs.staffId, staff.id))
      .leftJoin(users, eq(timeClockAuditLogs.performedByUserId, users.id))
      .where(and(...filters))
      .orderBy(desc(timeClockAuditLogs.createdAt)) as any;
  }
  async getTimeClockClosure(orgId: number, referenceMonth: string): Promise<TimeClockClosure | undefined> {
    const [closure] = await db
      .select()
      .from(timeClockClosures)
      .where(and(eq(timeClockClosures.organizationId, orgId), eq(timeClockClosures.referenceMonth, referenceMonth)))
      .orderBy(desc(timeClockClosures.id));
    return closure;
  }
  async createTimeClockClosure(closure: InsertTimeClockClosure): Promise<TimeClockClosure> {
    const [created] = await db.insert(timeClockClosures).values(closure).returning();
    return created;
  }
  async updateTimeClockClosure(orgId: number, id: number, updates: UpdateTimeClockClosureRequest): Promise<TimeClockClosure> {
    const [updated] = await db
      .update(timeClockClosures)
      .set(updates)
      .where(and(eq(timeClockClosures.id, id), eq(timeClockClosures.organizationId, orgId)))
      .returning();
    return updated;
  }

  // --- Contracts ---
  async getContracts(orgId: number, residentId?: number): Promise<(Contract & { residentName?: string })[]> {
    const filters: any[] = [eq(contracts.organizationId, orgId)];
    if (residentId) filters.push(eq(contracts.residentId, residentId));
    return await db.select({
      id: contracts.id,
      organizationId: contracts.organizationId,
      residentId: contracts.residentId,
      plan: contracts.plan,
      monthlyValue: contracts.monthlyValue,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
      paymentDay: contracts.paymentDay,
      paymentMethod: contracts.paymentMethod,
      notes: contracts.notes,
      createdAt: contracts.createdAt,
      residentName: residents.name,
    }).from(contracts).leftJoin(residents, eq(contracts.residentId, residents.id)).where(and(...filters)).orderBy(desc(contracts.createdAt)) as any;
  }
  async getContract(orgId: number, id: number): Promise<Contract | undefined> {
    const [contract] = await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.organizationId, orgId)));
    return contract;
  }
  async createContract(contract: InsertContract): Promise<Contract> {
    const [newContract] = await db.insert(contracts).values(contract).returning();
    return newContract;
  }
  async updateContract(orgId: number, id: number, updates: UpdateContractRequest): Promise<Contract> {
    const [updated] = await db.update(contracts).set(updates).where(and(eq(contracts.id, id), eq(contracts.organizationId, orgId))).returning();
    return updated;
  }
  async deleteContract(orgId: number, id: number): Promise<void> {
    await db.delete(contracts).where(and(eq(contracts.id, id), eq(contracts.organizationId, orgId)));
  }

  // --- Monthly Fees ---
  async getMonthlyFees(
    orgId: number,
    query?: { contractId?: number; residentId?: number; status?: string; referenceMonth?: string },
  ): Promise<(MonthlyFee & { residentName?: string })[]> {
    const filters: any[] = [eq(monthlyFees.organizationId, orgId)];
    if (query?.contractId) filters.push(eq(monthlyFees.contractId, query.contractId));
    if (query?.residentId) filters.push(eq(monthlyFees.residentId, query.residentId));
    if (query?.status) filters.push(eq(monthlyFees.status, query.status));
    if (query?.referenceMonth) filters.push(eq(monthlyFees.referenceMonth, query.referenceMonth));
    return await db.select({
      id: monthlyFees.id,
      organizationId: monthlyFees.organizationId,
      contractId: monthlyFees.contractId,
      residentId: monthlyFees.residentId,
      referenceMonth: monthlyFees.referenceMonth,
      dueDate: monthlyFees.dueDate,
      amount: monthlyFees.amount,
      discount: monthlyFees.discount,
      fine: monthlyFees.fine,
      status: monthlyFees.status,
      paidAt: monthlyFees.paidAt,
      paymentMethod: monthlyFees.paymentMethod,
      receiptNumber: monthlyFees.receiptNumber,
      notes: monthlyFees.notes,
      createdAt: monthlyFees.createdAt,
      residentName: residents.name,
    }).from(monthlyFees).leftJoin(residents, eq(monthlyFees.residentId, residents.id)).where(and(...filters)).orderBy(desc(monthlyFees.dueDate)) as any;
  }
  async createMonthlyFee(fee: InsertMonthlyFee): Promise<MonthlyFee> {
    const [newFee] = await db.insert(monthlyFees).values(fee).returning();
    return newFee;
  }
  async updateMonthlyFee(orgId: number, id: number, updates: UpdateMonthlyFeeRequest): Promise<MonthlyFee> {
    const [updated] = await db.update(monthlyFees).set(updates).where(and(eq(monthlyFees.id, id), eq(monthlyFees.organizationId, orgId))).returning();
    return updated;
  }
  async deleteMonthlyFee(orgId: number, id: number): Promise<void> {
    await db.delete(monthlyFees).where(and(eq(monthlyFees.id, id), eq(monthlyFees.organizationId, orgId)));
  }

  // --- Accounts Payable ---
  async getAccountsPayable(
    orgId: number,
    query?: { staffId?: number; status?: string; referenceMonth?: string },
  ): Promise<(AccountPayable & { staffName?: string })[]> {
    const filters: any[] = [eq(accountsPayable.organizationId, orgId)];
    if (query?.staffId) filters.push(eq(accountsPayable.staffId, query.staffId));
    if (query?.status) filters.push(eq(accountsPayable.status, query.status));
    if (query?.referenceMonth) filters.push(eq(accountsPayable.referenceMonth, query.referenceMonth));

    return await db.select({
      id: accountsPayable.id,
      organizationId: accountsPayable.organizationId,
      staffId: accountsPayable.staffId,
      title: accountsPayable.title,
      category: accountsPayable.category,
      referenceMonth: accountsPayable.referenceMonth,
      dueDate: accountsPayable.dueDate,
      amount: accountsPayable.amount,
      discount: accountsPayable.discount,
      extra: accountsPayable.extra,
      status: accountsPayable.status,
      paidAt: accountsPayable.paidAt,
      paymentMethod: accountsPayable.paymentMethod,
      notes: accountsPayable.notes,
      createdAt: accountsPayable.createdAt,
      staffName: staff.name,
    }).from(accountsPayable)
      .leftJoin(staff, eq(accountsPayable.staffId, staff.id))
      .where(and(...filters))
      .orderBy(desc(accountsPayable.dueDate)) as any;
  }
  async getAccountPayable(
    orgId: number,
    id: number,
  ): Promise<(AccountPayable & { staffName?: string }) | undefined> {
    const [payable] = await db.select({
      id: accountsPayable.id,
      organizationId: accountsPayable.organizationId,
      staffId: accountsPayable.staffId,
      title: accountsPayable.title,
      category: accountsPayable.category,
      referenceMonth: accountsPayable.referenceMonth,
      dueDate: accountsPayable.dueDate,
      amount: accountsPayable.amount,
      discount: accountsPayable.discount,
      extra: accountsPayable.extra,
      status: accountsPayable.status,
      paidAt: accountsPayable.paidAt,
      paymentMethod: accountsPayable.paymentMethod,
      notes: accountsPayable.notes,
      createdAt: accountsPayable.createdAt,
      staffName: staff.name,
    }).from(accountsPayable)
      .leftJoin(staff, eq(accountsPayable.staffId, staff.id))
      .where(and(eq(accountsPayable.organizationId, orgId), eq(accountsPayable.id, id))) as any;
    return payable;
  }
  async createAccountPayable(item: InsertAccountPayable): Promise<AccountPayable> {
    const [created] = await db.insert(accountsPayable).values(item).returning();
    return created;
  }
  async updateAccountPayable(
    orgId: number,
    id: number,
    updates: UpdateAccountPayableRequest,
  ): Promise<AccountPayable> {
    const [updated] = await db
      .update(accountsPayable)
      .set(updates)
      .where(and(eq(accountsPayable.id, id), eq(accountsPayable.organizationId, orgId)))
      .returning();
    return updated;
  }
  async deleteAccountPayable(orgId: number, id: number): Promise<void> {
    await db.delete(accountsPayable).where(and(eq(accountsPayable.id, id), eq(accountsPayable.organizationId, orgId)));
  }

  // --- CRM Opportunities ---
  private buildCrmOpportunityFilters(orgId: number, query?: CrmOpportunityQuery): any[] {
    const filters: any[] = [eq(crmOpportunities.organizationId, orgId)];
    if (query?.stage) filters.push(eq(crmOpportunities.stage, query.stage));
    if (query?.ownerId) filters.push(eq(crmOpportunities.ownerId, query.ownerId));
    if (query?.ownerStaffId) filters.push(eq(crmOpportunities.ownerStaffId, query.ownerStaffId));
    if (query?.source) {
      filters.push(sql`lower(coalesce(${crmOpportunities.source}, '')) = lower(${query.source})`);
    }
    if (query?.expectedCloseFrom) {
      filters.push(gte(crmOpportunities.expectedCloseDate, query.expectedCloseFrom));
    }
    if (query?.expectedCloseTo) {
      filters.push(lte(crmOpportunities.expectedCloseDate, query.expectedCloseTo));
    }
    if (query?.search) {
      const term = `%${query.search}%`;
      filters.push(sql`(
        ${crmOpportunities.title} ILIKE ${term}
        OR coalesce(${crmOpportunities.contactName}, '') ILIKE ${term}
        OR coalesce(${crmOpportunities.contactPhone}, '') ILIKE ${term}
        OR coalesce(${crmOpportunities.contactEmail}, '') ILIKE ${term}
        OR coalesce(${crmOpportunities.source}, '') ILIKE ${term}
      )`);
    }
    if (query?.followUpStatus) {
      const todayKey = this.todayDateKey();
      const followUpTasksJsonb = sql`
        CASE
          WHEN coalesce(${crmOpportunities.followUpTasks}, '') ~ '^\\s*\\['
            THEN ${crmOpportunities.followUpTasks}::jsonb
          ELSE '[]'::jsonb
        END
      `;
      const pendingFollowUpExists = sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${followUpTasksJsonb}) AS task(item)
        WHERE coalesce(task.item->>'done', 'false') <> 'true'
      )`;

      if (query.followUpStatus === "pending") {
        filters.push(pendingFollowUpExists);
      } else if (query.followUpStatus === "overdue") {
        filters.push(sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${followUpTasksJsonb}) AS task(item)
          WHERE coalesce(task.item->>'done', 'false') <> 'true'
            AND task.item->>'dueDate' < ${todayKey}
        )`);
      } else if (query.followUpStatus === "today") {
        filters.push(sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${followUpTasksJsonb}) AS task(item)
          WHERE coalesce(task.item->>'done', 'false') <> 'true'
            AND task.item->>'dueDate' = ${todayKey}
        )`);
      } else if (query.followUpStatus === "none") {
        filters.push(sql`NOT ${pendingFollowUpExists}`);
      }
    }
    return filters;
  }

  private todayDateKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  async getCrmOpportunities(
    orgId: number,
    query?: CrmOpportunityQuery,
  ): Promise<(CrmOpportunity & { ownerName?: string | null; ownerStaffName?: string | null })[]> {
    const filters = this.buildCrmOpportunityFilters(orgId, query);

    return await db.select({
      id: crmOpportunities.id,
      organizationId: crmOpportunities.organizationId,
      title: crmOpportunities.title,
      contactName: crmOpportunities.contactName,
      contactPhone: crmOpportunities.contactPhone,
      contactEmail: crmOpportunities.contactEmail,
      source: crmOpportunities.source,
      stage: crmOpportunities.stage,
      amount: crmOpportunities.amount,
      expectedCloseDate: crmOpportunities.expectedCloseDate,
      ownerId: crmOpportunities.ownerId,
      ownerStaffId: crmOpportunities.ownerStaffId,
      notes: crmOpportunities.notes,
      followUpTasks: crmOpportunities.followUpTasks,
      lostReason: crmOpportunities.lostReason,
      position: crmOpportunities.position,
      createdAt: crmOpportunities.createdAt,
      updatedAt: crmOpportunities.updatedAt,
      ownerName: users.name,
      ownerStaffName: staff.name,
    }).from(crmOpportunities)
      .leftJoin(users, eq(crmOpportunities.ownerId, users.id))
      .leftJoin(staff, eq(crmOpportunities.ownerStaffId, staff.id))
      .where(and(...filters))
      .orderBy(asc(crmOpportunities.position), desc(crmOpportunities.createdAt)) as any;
  }
  async getCrmOpportunitiesPaginated(
    orgId: number,
    query?: CrmOpportunityQuery & { page?: number; pageSize?: number },
  ): Promise<PaginatedCrmOpportunities> {
    const filters = this.buildCrmOpportunityFilters(orgId, query);
    const page = Math.max(1, Math.trunc(Number(query?.page ?? 1)));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(query?.pageSize ?? 10))));
    const offset = (page - 1) * pageSize;

    const [summary] = await db.select({
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(coalesce(${crmOpportunities.amount}, 0)), 0)::float8`,
    }).from(crmOpportunities)
      .where(and(...filters));

    const stageCounts = await db.select({
      stage: crmOpportunities.stage,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(coalesce(${crmOpportunities.amount}, 0)), 0)::float8`,
    }).from(crmOpportunities)
      .where(and(...filters))
      .groupBy(crmOpportunities.stage);

    const items = await db.select({
      id: crmOpportunities.id,
      organizationId: crmOpportunities.organizationId,
      title: crmOpportunities.title,
      contactName: crmOpportunities.contactName,
      contactPhone: crmOpportunities.contactPhone,
      contactEmail: crmOpportunities.contactEmail,
      source: crmOpportunities.source,
      stage: crmOpportunities.stage,
      amount: crmOpportunities.amount,
      expectedCloseDate: crmOpportunities.expectedCloseDate,
      ownerId: crmOpportunities.ownerId,
      ownerStaffId: crmOpportunities.ownerStaffId,
      notes: crmOpportunities.notes,
      followUpTasks: crmOpportunities.followUpTasks,
      lostReason: crmOpportunities.lostReason,
      position: crmOpportunities.position,
      createdAt: crmOpportunities.createdAt,
      updatedAt: crmOpportunities.updatedAt,
      ownerName: users.name,
      ownerStaffName: staff.name,
    }).from(crmOpportunities)
      .leftJoin(users, eq(crmOpportunities.ownerId, users.id))
      .leftJoin(staff, eq(crmOpportunities.ownerStaffId, staff.id))
      .where(and(...filters))
      .orderBy(asc(crmOpportunities.position), desc(crmOpportunities.createdAt))
      .limit(pageSize)
      .offset(offset) as any;

    const total = Number(summary?.count ?? 0);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalAmount: Number(summary?.totalAmount ?? 0),
      stageCounts: stageCounts.map((item) => ({
        stage: item.stage,
        count: Number(item.count ?? 0),
        amount: Number(item.amount ?? 0),
      })),
    };
  }
  async getCrmOpportunity(
    orgId: number,
    id: number,
  ): Promise<(CrmOpportunity & { ownerName?: string | null; ownerStaffName?: string | null }) | undefined> {
    const [opportunity] = await db.select({
      id: crmOpportunities.id,
      organizationId: crmOpportunities.organizationId,
      title: crmOpportunities.title,
      contactName: crmOpportunities.contactName,
      contactPhone: crmOpportunities.contactPhone,
      contactEmail: crmOpportunities.contactEmail,
      source: crmOpportunities.source,
      stage: crmOpportunities.stage,
      amount: crmOpportunities.amount,
      expectedCloseDate: crmOpportunities.expectedCloseDate,
      ownerId: crmOpportunities.ownerId,
      ownerStaffId: crmOpportunities.ownerStaffId,
      notes: crmOpportunities.notes,
      followUpTasks: crmOpportunities.followUpTasks,
      lostReason: crmOpportunities.lostReason,
      position: crmOpportunities.position,
      createdAt: crmOpportunities.createdAt,
      updatedAt: crmOpportunities.updatedAt,
      ownerName: users.name,
      ownerStaffName: staff.name,
    }).from(crmOpportunities)
      .leftJoin(users, eq(crmOpportunities.ownerId, users.id))
      .leftJoin(staff, eq(crmOpportunities.ownerStaffId, staff.id))
      .where(and(eq(crmOpportunities.organizationId, orgId), eq(crmOpportunities.id, id))) as any;
    return opportunity;
  }
  async createCrmOpportunity(item: InsertCrmOpportunity): Promise<CrmOpportunity> {
    const [created] = await db.insert(crmOpportunities).values({
      ...item,
      updatedAt: new Date(),
    }).returning();
    return created;
  }
  async updateCrmOpportunity(
    orgId: number,
    id: number,
    updates: UpdateCrmOpportunityRequest,
  ): Promise<CrmOpportunity> {
    const [updated] = await db
      .update(crmOpportunities)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.organizationId, orgId)))
      .returning();
    return updated;
  }
  async deleteCrmOpportunity(orgId: number, id: number): Promise<void> {
    await db.delete(crmOpportunities).where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.organizationId, orgId)));
  }
  async reassignCrmOpportunityStages(orgId: number, fromStages: string[], toStage: string): Promise<number> {
    const sanitizedFromStages = fromStages
      .map((stage) => stage.trim().toLowerCase())
      .filter((stage) => stage.length > 0)
      .filter((stage, index, source) => source.indexOf(stage) === index);

    if (sanitizedFromStages.length === 0) return 0;

    const moved = await db.update(crmOpportunities)
      .set({
        stage: toStage,
        updatedAt: new Date(),
      })
      .where(and(
        eq(crmOpportunities.organizationId, orgId),
        inArray(crmOpportunities.stage, sanitizedFromStages),
      ))
      .returning({ id: crmOpportunities.id });

    return moved.length;
  }

  // --- Dashboard Stats ---
  async getDashboardStats(orgId: number): Promise<DashboardStats> {
    const [resCount] = await db.select({ count: sql<number>`count(*)` }).from(residents).where(and(eq(residents.organizationId, orgId), eq(residents.status, "active")));
    const [medCount] = await db.select({ count: sql<number>`count(*)` }).from(medications).where(and(eq(medications.organizationId, orgId), eq(medications.status, "active")));
    const [occCount] = await db.select({ count: sql<number>`count(*)` }).from(occurrences).where(and(eq(occurrences.organizationId, orgId), eq(occurrences.status, "open")));
    const [contractCount] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(and(eq(contracts.organizationId, orgId), eq(contracts.status, "active")));
    const [overdueCount] = await db.select({ count: sql<number>`count(*)` }).from(monthlyFees).where(and(eq(monthlyFees.organizationId, orgId), eq(monthlyFees.status, "overdue")));
    const [pendingAmt] = await db.select({ total: sql<number>`coalesce(sum(amount + coalesce(fine,0) - coalesce(discount,0)),0)` }).from(monthlyFees).where(and(eq(monthlyFees.organizationId, orgId), eq(monthlyFees.status, "pending")));
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const activeMedicationRows = await db.select().from(medications).where(and(eq(medications.organizationId, orgId), eq(medications.status, "active")));
    const todayAdministrations = await db.select({
      medicationId: medicationAdministrations.medicationId,
      scheduledFor: medicationAdministrations.scheduledFor,
      status: medicationAdministrations.status,
    }).from(medicationAdministrations).where(and(
      eq(medicationAdministrations.organizationId, orgId),
      gte(medicationAdministrations.scheduledFor, todayStart),
      lte(medicationAdministrations.scheduledFor, now),
    ));
    const overdueMedicationDoses = countOverdueMedicationDoses(activeMedicationRows, todayAdministrations, now);

    const [timeClockPendingApprovalsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(timeClockEntries)
      .where(and(
        eq(timeClockEntries.organizationId, orgId),
        eq(timeClockEntries.status, "pending_approval"),
        gte(timeClockEntries.eventTime, currentMonthStart),
      ));
    const [timeClockPendingAdjustmentsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(timeClockAdjustmentRequests)
      .where(and(
        eq(timeClockAdjustmentRequests.organizationId, orgId),
        eq(timeClockAdjustmentRequests.status, "pending"),
        gte(timeClockAdjustmentRequests.requestedEventTime, currentMonthStart),
      ));
    const [timeClockOutOfRangeTodayCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(timeClockAuditLogs)
      .where(and(
        eq(timeClockAuditLogs.organizationId, orgId),
        eq(timeClockAuditLogs.action, "out_of_range_attempt"),
        gte(timeClockAuditLogs.createdAt, todayStart),
        lte(timeClockAuditLogs.createdAt, todayEnd),
      ));
    const todayShiftRows = await db
      .select({
        staffId: shiftAssignments.staffId,
        startTime: shiftAssignments.startTime,
        endTime: shiftAssignments.endTime,
      })
      .from(shiftAssignments)
      .where(and(
        eq(shiftAssignments.organizationId, orgId),
        lte(shiftAssignments.startTime, todayEnd),
        gte(shiftAssignments.endTime, todayStart),
      ));
    const entryWindowStart = todayShiftRows.reduce((earliest, shift) => {
      const start = new Date(shift.startTime);
      return start.getTime() < earliest.getTime() ? start : earliest;
    }, todayStart);
    const todayTimeClockEntries = await db
      .select({
        staffId: timeClockEntries.staffId,
        eventType: timeClockEntries.eventType,
        eventTime: timeClockEntries.eventTime,
        status: timeClockEntries.status,
      })
      .from(timeClockEntries)
      .where(and(
        eq(timeClockEntries.organizationId, orgId),
        gte(timeClockEntries.eventTime, entryWindowStart),
        lte(timeClockEntries.eventTime, now),
      ));
    const timeClockIncompleteToday = todayShiftRows.filter((shift) => {
      const shiftStart = new Date(shift.startTime);
      const shiftEnd = new Date(shift.endTime);
      if (shiftEnd.getTime() > now.getTime()) return false;
      return !todayTimeClockEntries.some((entry) => {
        const eventTime = new Date(entry.eventTime);
        return entry.staffId === shift.staffId
          && entry.eventType === "clock_out"
          && (entry.status === "valid" || entry.status === "manual_adjusted" || entry.status === "pending_approval")
          && eventTime.getTime() >= shiftStart.getTime()
          && eventTime.getTime() <= now.getTime();
      });
    }).length;

    // Birthdays this month
    const currentMonth = new Date().getMonth() + 1;
    const allResidents = await db.select({ birthDate: residents.birthDate }).from(residents).where(and(eq(residents.organizationId, orgId), eq(residents.status, "active")));
    const birthdaysThisMonth = allResidents.filter(r => {
      if (!r.birthDate) return false;
      const month = new Date(r.birthDate + "T00:00:00").getMonth() + 1;
      return month === currentMonth;
    }).length;

    const [org] = await db.select({ capacity: organizations.capacity }).from(organizations).where(eq(organizations.id, orgId));
    const capacity = org?.capacity ?? 50;
    const totalResidents = Number(resCount.count);
    return {
      totalResidents,
      capacity,
      occupancyRate: Math.round((totalResidents / capacity) * 100),
      activeMedications: Number(medCount.count),
      overdueMedicationDoses,
      pendingOccurrences: Number(occCount.count),
      birthdaysThisMonth,
      overdueFeesCount: Number(overdueCount.count),
      pendingFeesAmount: Number(pendingAmt.total ?? 0),
      activeContracts: Number(contractCount.count),
      timeClockPendingApprovals: Number(timeClockPendingApprovalsCount.count),
      timeClockPendingAdjustments: Number(timeClockPendingAdjustmentsCount.count),
      timeClockIncompleteToday,
      timeClockOutOfRangeToday: Number(timeClockOutOfRangeTodayCount.count),
    };
  }
}

export const storage = new DatabaseStorage();
