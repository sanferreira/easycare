import { pgTable, text, serial, integer, boolean, timestamp, date, real, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ===== ORGANIZATIONS (multi-tenant) =====
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  cnpj: text("cnpj"),
  capacity: integer("capacity").default(50),
  environmentSettings: text("environment_settings"),
  // active | inactive | restricted
  status: text("status").notNull().default("active"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== USERS =====
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id"),
  username: text("username").notNull(),
  password: text("password").notNull(),
  // roles: admin, nurse (enfermeiro), caregiver (cuidador), receptionist (recepção)
  role: text("role").notNull().default("staff"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  active: boolean("active").default(true),
  isSuperAdmin: boolean("is_super_admin").default(false),
}, (table) => ({
  orgUsernameUnique: uniqueIndex("users_org_username_unique").on(table.organizationId, table.username),
}));

// ===== RESIDENTS (expanded) =====
export const residents = pgTable("residents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  // Identificação
  name: text("name").notNull(),
  birthDate: date("birth_date").notNull(),
  gender: text("gender"),              // "M" | "F" | "outro"
  cpf: text("cpf"),
  rg: text("rg"),
  susNumber: text("sus_number"),
  bloodType: text("blood_type"),       // "A+", "A-", "B+", etc.
  maritalStatus: text("marital_status"), // solteiro, casado, viuvo, divorciado
  nationality: text("nationality").default("Brasileiro(a)"),
  // Admissão
  admissionDate: date("admission_date").notNull(),
  roomNumber: text("room_number").notNull(),
  status: text("status").notNull().default("active"), // active | inactive | deceased | transferred
  // Saúde
  healthNotes: text("health_notes"),
  allergies: text("allergies"),
  dietaryRestrictions: text("dietary_restrictions"),
  mobilityStatus: text("mobility_status"),   // independente, assistido, acamado
  cognitiveStatus: text("cognitive_status"), // preservado, comprometimento leve/moderado/grave
  // Contato principal
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactRelationship: text("contact_relationship"),
  photoUrl: text("photo_url"),
});

// ===== FAMILY MEMBERS / RESPONSIBLE =====
export const familyMembers = pgTable("family_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  name: text("name").notNull(),
  relationship: text("relationship").notNull(), // filho, filha, cônjuge, sobrinho, etc.
  cpf: text("cpf"),
  rg: text("rg"),
  phone: text("phone").notNull(),
  phone2: text("phone2"),
  email: text("email"),
  address: text("address"),
  isPrimary: boolean("is_primary").default(false),   // responsável principal
  portalAccess: boolean("portal_access").default(false),
  portalUsername: text("portal_username"),   // login for family portal (unique)
  portalPassword: text("portal_password"),   // password for family portal
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== COMORBIDITIES / DIAGNOSES =====
export const comorbidities = pgTable("comorbidities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  name: text("name").notNull(),           // ex: "Diabetes Mellitus Tipo 2"
  icd10: text("icd10"),                   // CID-10 code
  severity: text("severity").default("moderate"), // mild | moderate | severe
  notes: text("notes"),
  active: boolean("active").default(true),
  diagnosedAt: date("diagnosed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== MEDICAL RECORDS / PRONTUÁRIO =====
// type: evolution (evolução diária), note (anotação), anamnese, prescription (prescrição)
// visibility: internal (só equipe) | shared (visível pro responsável no portal)
export const medicalRecords = pgTable("medical_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  authorId: integer("author_id"),         // user who wrote
  date: date("date").notNull(),
  type: text("type").notNull().default("evolution"),
  title: text("title"),
  content: text("content").notNull(),
  visibility: text("visibility").notNull().default("internal"), // internal | shared
  // Vitals (optional, for evolution type)
  bloodPressure: text("blood_pressure"),  // ex: "120/80"
  heartRate: integer("heart_rate"),
  temperature: real("temperature"),
  oxygenSat: integer("oxygen_sat"),       // SpO2 %
  weight: real("weight"),                 // kg
  mood: text("mood"),                     // bom, regular, agitado, sonolento, ansioso
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== MEDICATIONS =====
export const medications = pgTable("medications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  name: text("name").notNull(),
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(),
  route: text("route"),                   // oral, sublingual, IM, IV, tópico
  scheduleTime: text("schedule_time"),    // "08:00, 14:00, 20:00"
  startDate: date("start_date"),
  endDate: date("end_date"),
  prescribedBy: text("prescribed_by"),   // médico responsável
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  nextDue: timestamp("next_due"),
});

// ===== MEDICATION ADMINISTRATIONS =====
export const medicationAdministrations = pgTable("medication_administrations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  medicationId: integer("medication_id").notNull(),
  residentId: integer("resident_id").notNull(),
  staffId: integer("staff_id"),
  scheduledFor: timestamp("scheduled_for"),
  administeredAt: timestamp("administered_at").defaultNow(),
  status: text("status").notNull().default("given"), // given | skipped | refused | late
  notes: text("notes"),
});

// ===== STAFF =====
export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  employmentType: text("employment_type").default("clt"), // clt | pj
  cpf: text("cpf"),
  cnpj: text("cnpj"),
  role: text("role").notNull(),   // cuidador, enfermeiro, técnico de enfermagem, fisioterapeuta, médico, nutricionista, recepcionista, administrativo
  specialty: text("specialty"),
  coren: text("coren"),           // registration number for nurses
  crm: text("crm"),               // for doctors
  shift: text("shift").notNull(), // manhã, tarde, noite, 12x36
  phone: text("phone"),
  cep: text("cep"),
  address: text("address"),
  email: text("email"),
  portalAccess: boolean("portal_access").default(false),
  portalUsername: text("portal_username"),
  portalUserId: integer("portal_user_id"),
  photoUrl: text("photo_url"),
  workSchedule: text("work_schedule"),
  admissionDate: date("admission_date"),
  active: boolean("active").default(true),
});

// ===== OCCURRENCES =====
export const occurrences = pgTable("occurrences", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  authorId: integer("author_id"),
  type: text("type").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("low"), // low | medium | high | critical
  status: text("status").notNull().default("open"),    // open | in_progress | resolved
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== SHIFT ASSIGNMENTS =====
export const shiftAssignments = pgTable("shift_assignments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  staffId: integer("staff_id").notNull(),
  residentId: integer("resident_id"),
  shiftType: text("shift_type").notNull().default("avulso"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== CONTRACTS =====
export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  plan: text("plan").notNull().default("standard"), // standard | premium | vip
  monthlyValue: real("monthly_value").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: text("status").notNull().default("active"), // active | suspended | terminated
  paymentDay: integer("payment_day").default(5),      // dia do vencimento
  paymentMethod: text("payment_method"),              // boleto, pix, débito automático
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== MONTHLY FEES =====
export const monthlyFees = pgTable("monthly_fees", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  contractId: integer("contract_id").notNull(),
  residentId: integer("resident_id").notNull(),
  referenceMonth: text("reference_month").notNull(), // "2025-01"
  dueDate: date("due_date").notNull(),
  amount: real("amount").notNull(),
  discount: real("discount").default(0),
  fine: real("fine").default(0),
  status: text("status").notNull().default("pending"), // pending | paid | overdue | cancelled
  paidAt: timestamp("paid_at"),
  paymentMethod: text("payment_method"),
  receiptNumber: text("receipt_number"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== ACCOUNTS PAYABLE (TEAM / OPERATIONAL EXPENSES) =====
export const accountsPayable = pgTable("accounts_payable", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  staffId: integer("staff_id"),
  title: text("title").notNull(),
  category: text("category").notNull().default("staff"), // staff | encargos | servicos | outros
  referenceMonth: text("reference_month"), // "2026-04"
  dueDate: date("due_date").notNull(),
  amount: real("amount").notNull(),
  discount: real("discount").default(0),
  extra: real("extra").default(0),
  status: text("status").notNull().default("pending"), // pending | paid | overdue | cancelled
  paidAt: timestamp("paid_at"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ===== RELATIONS =====
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  residents: many(residents),
  staff: many(staff),
  contracts: many(contracts),
  accountsPayable: many(accountsPayable),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
}));

export const residentsRelations = relations(residents, ({ one, many }) => ({
  organization: one(organizations, { fields: [residents.organizationId], references: [organizations.id] }),
  medications: many(medications),
  occurrences: many(occurrences),
  shiftAssignments: many(shiftAssignments),
  medicalRecords: many(medicalRecords),
  comorbidities: many(comorbidities),
  familyMembers: many(familyMembers),
  contracts: many(contracts),
  monthlyFees: many(monthlyFees),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  organization: one(organizations, { fields: [staff.organizationId], references: [organizations.id] }),
  shiftAssignments: many(shiftAssignments),
  accountsPayable: many(accountsPayable),
}));

export const shiftAssignmentsRelations = relations(shiftAssignments, ({ one }) => ({
  resident: one(residents, { fields: [shiftAssignments.residentId], references: [residents.id] }),
  staff: one(staff, { fields: [shiftAssignments.staffId], references: [staff.id] }),
}));

export const medicationsRelations = relations(medications, ({ one, many }) => ({
  resident: one(residents, { fields: [medications.residentId], references: [residents.id] }),
  administrations: many(medicationAdministrations),
}));

export const medicationAdministrationsRelations = relations(medicationAdministrations, ({ one }) => ({
  medication: one(medications, { fields: [medicationAdministrations.medicationId], references: [medications.id] }),
  resident: one(residents, { fields: [medicationAdministrations.residentId], references: [residents.id] }),
}));

export const occurrencesRelations = relations(occurrences, ({ one }) => ({
  resident: one(residents, { fields: [occurrences.residentId], references: [residents.id] }),
}));

export const medicalRecordsRelations = relations(medicalRecords, ({ one }) => ({
  resident: one(residents, { fields: [medicalRecords.residentId], references: [residents.id] }),
}));

export const comorbiditiesRelations = relations(comorbidities, ({ one }) => ({
  resident: one(residents, { fields: [comorbidities.residentId], references: [residents.id] }),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  resident: one(residents, { fields: [familyMembers.residentId], references: [residents.id] }),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  resident: one(residents, { fields: [contracts.residentId], references: [residents.id] }),
  monthlyFees: many(monthlyFees),
}));

export const monthlyFeesRelations = relations(monthlyFees, ({ one }) => ({
  contract: one(contracts, { fields: [monthlyFees.contractId], references: [contracts.id] }),
  resident: one(residents, { fields: [monthlyFees.residentId], references: [residents.id] }),
}));

export const accountsPayableRelations = relations(accountsPayable, ({ one }) => ({
  staff: one(staff, { fields: [accountsPayable.staffId], references: [staff.id] }),
}));

// ===== INSERT SCHEMAS (server use) =====
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertResidentSchema = createInsertSchema(residents).omit({ id: true });
export const insertMedicationSchema = createInsertSchema(medications).omit({ id: true });
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true });
export const insertOccurrenceSchema = createInsertSchema(occurrences).omit({ id: true, createdAt: true });
export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignments).omit({ id: true, createdAt: true });
export const insertMedicalRecordSchema = createInsertSchema(medicalRecords).omit({ id: true, createdAt: true });
export const insertComorbiditySchema = createInsertSchema(comorbidities).omit({ id: true, createdAt: true });
export const insertFamilyMemberSchema = createInsertSchema(familyMembers).omit({ id: true, createdAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true });
export const insertMonthlyFeeSchema = createInsertSchema(monthlyFees).omit({ id: true, createdAt: true });
export const insertAccountPayableSchema = createInsertSchema(accountsPayable).omit({ id: true, createdAt: true });
export const insertMedicationAdministrationSchema = createInsertSchema(medicationAdministrations).omit({ id: true });

// ===== FORM SCHEMAS (frontend — organizationId added by backend) =====
export const residentFormSchema = createInsertSchema(residents).omit({ id: true, organizationId: true });
export const medicationFormSchema = createInsertSchema(medications).omit({ id: true, organizationId: true });
export const staffFormSchema = createInsertSchema(staff).omit({ id: true, organizationId: true });
export const occurrenceFormSchema = createInsertSchema(occurrences).omit({ id: true, organizationId: true, createdAt: true });
export const shiftAssignmentFormSchema = createInsertSchema(shiftAssignments).omit({ id: true, organizationId: true, createdAt: true }).extend({
  shiftType: z.enum(["12h_manha", "12h_noite", "24h", "avulso"]).default("avulso"),
  residentId: z.number().optional().nullable(),
});
export const medicalRecordFormSchema = createInsertSchema(medicalRecords).omit({ id: true, organizationId: true, createdAt: true });
export const comorbidityFormSchema = createInsertSchema(comorbidities).omit({ id: true, organizationId: true, createdAt: true });
export const familyMemberFormSchema = createInsertSchema(familyMembers).omit({ id: true, organizationId: true, createdAt: true });
export const contractFormSchema = createInsertSchema(contracts).omit({ id: true, organizationId: true, createdAt: true });
export const monthlyFeeFormSchema = createInsertSchema(monthlyFees).omit({ id: true, organizationId: true, createdAt: true });
export const accountPayableFormSchema = createInsertSchema(accountsPayable).omit({ id: true, organizationId: true, createdAt: true });
export const medicationAdministrationFormSchema = createInsertSchema(medicationAdministrations).omit({ id: true, organizationId: true, administeredAt: true });

// ===== TYPES =====
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Resident = typeof residents.$inferSelect;
export type Medication = typeof medications.$inferSelect;
export type StaffMember = typeof staff.$inferSelect;
export type Occurrence = typeof occurrences.$inferSelect;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type MedicalRecord = typeof medicalRecords.$inferSelect;
export type Comorbidity = typeof comorbidities.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type MonthlyFee = typeof monthlyFees.$inferSelect;
export type AccountPayable = typeof accountsPayable.$inferSelect;
export type MedicationAdministration = typeof medicationAdministrations.$inferSelect;

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertResident = z.infer<typeof insertResidentSchema>;
export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type InsertOccurrence = z.infer<typeof insertOccurrenceSchema>;
export type InsertShiftAssignment = z.infer<typeof insertShiftAssignmentSchema>;
export type InsertMedicalRecord = z.infer<typeof insertMedicalRecordSchema>;
export type InsertComorbidity = z.infer<typeof insertComorbiditySchema>;
export type InsertFamilyMember = z.infer<typeof insertFamilyMemberSchema>;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type InsertMonthlyFee = z.infer<typeof insertMonthlyFeeSchema>;
export type InsertAccountPayable = z.infer<typeof insertAccountPayableSchema>;
export type InsertMedicationAdministration = z.infer<typeof insertMedicationAdministrationSchema>;

export type ResidentFormInput = z.infer<typeof residentFormSchema>;
export type MedicationFormInput = z.infer<typeof medicationFormSchema>;
export type StaffFormInput = z.infer<typeof staffFormSchema>;
export type OccurrenceFormInput = z.infer<typeof occurrenceFormSchema>;

export type UpdateResidentRequest = Partial<InsertResident>;
export type UpdateMedicationRequest = Partial<InsertMedication>;
export type UpdateStaffRequest = Partial<InsertStaff>;
export type UpdateShiftAssignmentRequest = Partial<InsertShiftAssignment>;
export type UpdateOccurrenceRequest = Partial<InsertOccurrence>;
export type UpdateContractRequest = Partial<InsertContract>;
export type UpdateMonthlyFeeRequest = Partial<InsertMonthlyFee>;
export type UpdateAccountPayableRequest = Partial<InsertAccountPayable>;

export type DashboardStats = {
  totalResidents: number;
  capacity: number;
  occupancyRate: number;
  activeMedications: number;
  pendingOccurrences: number;
  birthdaysThisMonth: number;
  overdueFeesCount: number;
  pendingFeesAmount: number;
  activeContracts: number;
};

export type SessionUser = {
  id?: number;
  username: string;
  name: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  isSuperAdmin?: boolean;
};
