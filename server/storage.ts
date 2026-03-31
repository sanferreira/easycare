import { db } from "./db";
import {
  users, organizations, residents, medications, staff, occurrences, shiftAssignments,
  medicalRecords, comorbidities, familyMembers, contracts, monthlyFees, medicationAdministrations,
  type User, type InsertUser,
  type Organization, type InsertOrganization,
  type Resident, type InsertResident, type UpdateResidentRequest,
  type Medication, type InsertMedication, type UpdateMedicationRequest,
  type StaffMember, type InsertStaff, type UpdateStaffRequest,
  type Occurrence, type InsertOccurrence, type UpdateOccurrenceRequest,
  type ShiftAssignment, type InsertShiftAssignment, type UpdateShiftAssignmentRequest,
  type MedicalRecord, type InsertMedicalRecord,
  type Comorbidity, type InsertComorbidity,
  type FamilyMember, type InsertFamilyMember,
  type Contract, type InsertContract, type UpdateContractRequest,
  type MonthlyFee, type InsertMonthlyFee, type UpdateMonthlyFeeRequest,
  type MedicationAdministration, type InsertMedicationAdministration,
  type DashboardStats,
} from "@shared/schema";
import { eq, like, desc, sql, and, gte, lte, ilike } from "drizzle-orm";
import { hashPassword, isPasswordHash } from "./security";

export interface IStorage {
  // Organizations
  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: number): Promise<void>;

  // Users
  getSuperAdminByUsername(username: string): Promise<User | undefined>;
  getUserByUsernameAndOrganization(username: string, organizationId: number): Promise<User | undefined>;
  getUsersByOrganization(orgId: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;

  // Residents
  getResidents(orgId: number, query?: { search?: string; status?: string }): Promise<Resident[]>;
  getResident(orgId: number, id: number): Promise<Resident | undefined>;
  createResident(resident: InsertResident): Promise<Resident>;
  updateResident(orgId: number, id: number, updates: UpdateResidentRequest): Promise<Resident>;
  deleteResident(orgId: number, id: number): Promise<void>;

  // Family Members
  getFamilyMembers(orgId: number, residentId: number): Promise<FamilyMember[]>;
  getFamilyMemberByPortalUsername(username: string): Promise<FamilyMember | undefined>;
  createFamilyMember(member: InsertFamilyMember): Promise<FamilyMember>;
  updateFamilyMember(orgId: number, id: number, updates: Partial<InsertFamilyMember>): Promise<FamilyMember>;
  deleteFamilyMember(orgId: number, id: number): Promise<void>;

  // Comorbidities
  getComorbidities(orgId: number, residentId: number): Promise<Comorbidity[]>;
  createComorbidity(comorbidity: InsertComorbidity): Promise<Comorbidity>;
  updateComorbidity(orgId: number, id: number, updates: Partial<InsertComorbidity>): Promise<Comorbidity>;
  deleteComorbidity(orgId: number, id: number): Promise<void>;

  // Medical Records / Prontuário
  getMedicalRecords(orgId: number, residentId: number, type?: string): Promise<MedicalRecord[]>;
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
  getMedicationAdministrations(orgId: number, residentId?: number, medicationId?: number): Promise<(MedicationAdministration & { medicationName?: string; residentName?: string })[]>;
  createMedicationAdministration(admin: InsertMedicationAdministration): Promise<MedicationAdministration>;

  // Staff
  getStaff(orgId: number): Promise<StaffMember[]>;
  createStaff(member: InsertStaff): Promise<StaffMember>;
  updateStaff(orgId: number, id: number, updates: UpdateStaffRequest): Promise<StaffMember>;
  deleteStaff(orgId: number, id: number): Promise<void>;

  // Occurrences
  getOccurrences(orgId: number, residentId?: number): Promise<(Occurrence & { residentName?: string })[]>;
  createOccurrence(occurrence: InsertOccurrence): Promise<Occurrence>;
  updateOccurrence(orgId: number, id: number, updates: UpdateOccurrenceRequest): Promise<Occurrence>;

  // Shift Assignments
  getShiftAssignments(orgId: number, query?: { residentId?: number; staffId?: number; start?: Date; end?: Date }): Promise<(ShiftAssignment & { residentName?: string; staffName?: string })[]>;
  createShiftAssignment(assignment: InsertShiftAssignment): Promise<ShiftAssignment>;
  updateShiftAssignment(orgId: number, id: number, updates: UpdateShiftAssignmentRequest): Promise<ShiftAssignment>;
  deleteShiftAssignment(orgId: number, id: number): Promise<void>;

  // Contracts
  getContracts(orgId: number, residentId?: number): Promise<(Contract & { residentName?: string })[]>;
  getContract(orgId: number, id: number): Promise<Contract | undefined>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(orgId: number, id: number, updates: UpdateContractRequest): Promise<Contract>;
  deleteContract(orgId: number, id: number): Promise<void>;

  // Monthly Fees
  getMonthlyFees(orgId: number, query?: { contractId?: number; residentId?: number; status?: string }): Promise<(MonthlyFee & { residentName?: string })[]>;
  createMonthlyFee(fee: InsertMonthlyFee): Promise<MonthlyFee>;
  updateMonthlyFee(orgId: number, id: number, updates: UpdateMonthlyFeeRequest): Promise<MonthlyFee>;
  deleteMonthlyFee(orgId: number, id: number): Promise<void>;

  // Stats
  getDashboardStats(orgId: number): Promise<DashboardStats>;
}

export class DatabaseStorage implements IStorage {
  // --- Organizations ---
  async getOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations).orderBy(organizations.name);
  }
  async getOrganization(id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
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
  async getFamilyMemberByPortalUsername(username: string): Promise<FamilyMember | undefined> {
    const [member] = await db.select().from(familyMembers)
      .where(and(eq(familyMembers.portalUsername, username), eq(familyMembers.portalAccess, true)));
    return member;
  }
  async createFamilyMember(member: InsertFamilyMember): Promise<FamilyMember> {
    const payload: InsertFamilyMember = { ...member };
    if (typeof payload.portalPassword === "string") {
      const normalizedPassword = payload.portalPassword.trim();
      payload.portalPassword = normalizedPassword ? hashPassword(normalizedPassword) : null;
    }

    const [newMember] = await db.insert(familyMembers).values(payload).returning();
    return newMember;
  }
  async updateFamilyMember(orgId: number, id: number, updates: Partial<InsertFamilyMember>): Promise<FamilyMember> {
    const payload: Partial<InsertFamilyMember> = { ...updates };
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
  async getMedicalRecords(orgId: number, residentId: number, type?: string): Promise<MedicalRecord[]> {
    const filters: any[] = [eq(medicalRecords.organizationId, orgId), eq(medicalRecords.residentId, residentId)];
    if (type) filters.push(eq(medicalRecords.type, type));
    return await db.select().from(medicalRecords).where(and(...filters)).orderBy(desc(medicalRecords.date), desc(medicalRecords.createdAt));
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
  async getMedicationAdministrations(orgId: number, residentId?: number, medicationId?: number): Promise<(MedicationAdministration & { medicationName?: string; residentName?: string })[]> {
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
    }).from(medicationAdministrations)
      .leftJoin(medications, eq(medicationAdministrations.medicationId, medications.id))
      .leftJoin(residents, eq(medicationAdministrations.residentId, residents.id))
      .where(and(...filters))
      .orderBy(desc(medicationAdministrations.administeredAt)) as any;
  }
  async createMedicationAdministration(admin: InsertMedicationAdministration): Promise<MedicationAdministration> {
    const [newAdmin] = await db.insert(medicationAdministrations).values(admin).returning();
    return newAdmin;
  }

  // --- Staff ---
  async getStaff(orgId: number): Promise<StaffMember[]> {
    return await db.select().from(staff).where(eq(staff.organizationId, orgId)).orderBy(staff.name);
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

  // --- Shift Assignments ---
  async getShiftAssignments(orgId: number, query?: { residentId?: number; staffId?: number; start?: Date; end?: Date }): Promise<(ShiftAssignment & { residentName?: string; staffName?: string })[]> {
    const filters: any[] = [eq(shiftAssignments.organizationId, orgId)];
    if (query?.residentId) filters.push(eq(shiftAssignments.residentId, query.residentId));
    if (query?.staffId) filters.push(eq(shiftAssignments.staffId, query.staffId));
    if (query?.start) filters.push(gte(shiftAssignments.startTime, query.start));
    if (query?.end) filters.push(lte(shiftAssignments.endTime, query.end));
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
  async getMonthlyFees(orgId: number, query?: { contractId?: number; residentId?: number; status?: string }): Promise<(MonthlyFee & { residentName?: string })[]> {
    const filters: any[] = [eq(monthlyFees.organizationId, orgId)];
    if (query?.contractId) filters.push(eq(monthlyFees.contractId, query.contractId));
    if (query?.residentId) filters.push(eq(monthlyFees.residentId, query.residentId));
    if (query?.status) filters.push(eq(monthlyFees.status, query.status));
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

  // --- Dashboard Stats ---
  async getDashboardStats(orgId: number): Promise<DashboardStats> {
    const [resCount] = await db.select({ count: sql<number>`count(*)` }).from(residents).where(and(eq(residents.organizationId, orgId), eq(residents.status, "active")));
    const [medCount] = await db.select({ count: sql<number>`count(*)` }).from(medications).where(and(eq(medications.organizationId, orgId), eq(medications.status, "active")));
    const [occCount] = await db.select({ count: sql<number>`count(*)` }).from(occurrences).where(and(eq(occurrences.organizationId, orgId), eq(occurrences.status, "open")));
    const [contractCount] = await db.select({ count: sql<number>`count(*)` }).from(contracts).where(and(eq(contracts.organizationId, orgId), eq(contracts.status, "active")));
    const [overdueCount] = await db.select({ count: sql<number>`count(*)` }).from(monthlyFees).where(and(eq(monthlyFees.organizationId, orgId), eq(monthlyFees.status, "overdue")));
    const [pendingAmt] = await db.select({ total: sql<number>`coalesce(sum(amount + coalesce(fine,0) - coalesce(discount,0)),0)` }).from(monthlyFees).where(and(eq(monthlyFees.organizationId, orgId), eq(monthlyFees.status, "pending")));

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
      pendingOccurrences: Number(occCount.count),
      birthdaysThisMonth,
      overdueFeesCount: Number(overdueCount.count),
      pendingFeesAmount: Number(pendingAmt.total ?? 0),
      activeContracts: Number(contractCount.count),
    };
  }
}

export const storage = new DatabaseStorage();
