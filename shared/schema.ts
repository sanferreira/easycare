import { pgTable, text, serial, integer, boolean, timestamp, date, real, uniqueIndex, index, varchar, json } from "drizzle-orm/pg-core";
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

// ===== INTERNAL NOTIFICATIONS =====
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id"),
  staffId: integer("staff_id"),
  type: text("type").notNull().default("general"),
  severity: text("severity").notNull().default("info"), // info | success | warning | error
  sourceModule: text("source_module").notNull().default("system"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  actionUrl: text("action_url"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  dedupeKey: text("dedupe_key"),
  metadata: text("metadata"),
  scheduledFor: timestamp("scheduled_for").defaultNow(),
  deliveredAt: timestamp("delivered_at").defaultNow(),
  readAt: timestamp("read_at"),
  cancelledAt: timestamp("cancelled_at"),
  whatsappStatus: text("whatsapp_status").notNull().default("pending"), // pending | sent | failed | skipped
  whatsappAttempts: integer("whatsapp_attempts").notNull().default(0),
  whatsappSentAt: timestamp("whatsapp_sent_at"),
  whatsappMessageId: text("whatsapp_message_id"),
  whatsappError: text("whatsapp_error"),
  pushStatus: text("push_status").notNull().default("pending"), // pending | sent | failed | skipped
  pushAttempts: integer("push_attempts").notNull().default(0),
  pushSentAt: timestamp("push_sent_at"),
  pushError: text("push_error"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgUserReadIdx: index("notifications_org_user_read_idx").on(table.organizationId, table.userId, table.readAt),
  orgCreatedIdx: index("notifications_org_created_idx").on(table.organizationId, table.createdAt),
  orgUserDedupeUnique: uniqueIndex("notifications_org_user_dedupe_unique").on(table.organizationId, table.userId, table.dedupeKey),
}));

// ===== WEB PUSH SUBSCRIPTIONS =====
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
  orgUserActiveIdx: index("push_subscriptions_org_user_active_idx").on(table.organizationId, table.userId, table.active),
}));

// ===== EXPRESS SESSION STORE =====
// Managed by connect-pg-simple. Keeping it in the Drizzle schema prevents db:push
// from treating the table as unrelated and removing it.
export const userSessions = pgTable("user_sessions", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => ({
  expireIdx: index("IDX_user_sessions_expire").on(table.expire),
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
  careType: text("care_type").default("residential"), // residential | home_care
  cep: text("cep"),
  address: text("address"),
  addressNumber: text("address_number"),
  addressComplement: text("address_complement"),
  neighborhood: text("neighborhood"),
  city: text("city"),
  state: text("state"),
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

// ===== PATIENT DOCUMENTS =====
export const patientDocuments = pgTable("patient_documents", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  residentId: integer("resident_id").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  category: text("category").notNull().default("document"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  fileSize: integer("file_size"),
  fileData: text("file_data").notNull(),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  orgResidentIdx: index("patient_documents_org_resident_idx").on(table.organizationId, table.residentId, table.createdAt),
}));

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
  staffId: integer("staff_id"),           // professional responsible for the daily record
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
  glucoseLevel: integer("glucose_level"), // mg/dL
  mood: text("mood"),                     // bom, regular, agitado, sonolento, ansioso
  dailyChecklist: text("daily_checklist"), // JSON checklist for daily care items
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
  shiftValue: real("shift_value").default(0), // valor base por plantao
  bonusValue: real("bonus_value").default(0),
  bonusNotes: text("bonus_notes"),
  bankName: text("bank_name"),
  bankAgency: text("bank_agency"),
  bankAccount: text("bank_account"),
  pixKey: text("pix_key"),
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

// ===== TIME CLOCK / PONTO ELETRONICO =====
export const timeClockLocations = pgTable("time_clock_locations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  radiusMeters: integer("radius_meters").notNull().default(200),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeClockEntries = pgTable("time_clock_entries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  staffId: integer("staff_id").notNull(),
  userId: integer("user_id"),
  locationId: integer("location_id"),
  eventType: text("event_type").notNull(), // clock_in | break_start | break_end | clock_out
  eventTime: timestamp("event_time").notNull().defaultNow(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  accuracy: real("accuracy"),
  distanceMeters: real("distance_meters"),
  geofenceRadiusMeters: integer("geofence_radius_meters"),
  status: text("status").notNull().default("valid"), // valid | pending_approval | rejected | out_of_range | manual_adjusted
  notes: text("notes"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeClockAdjustmentRequests = pgTable("time_clock_adjustment_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  staffId: integer("staff_id").notNull(),
  requestedByUserId: integer("requested_by_user_id"),
  entryId: integer("entry_id"),
  eventType: text("event_type").notNull(),
  requestedEventTime: timestamp("requested_event_time").notNull(),
  reason: text("reason").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  reviewedByUserId: integer("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  reviewerNotes: text("reviewer_notes"),
  appliedEntryId: integer("applied_entry_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeClockAuditLogs = pgTable("time_clock_audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  staffId: integer("staff_id"),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  action: text("action").notNull(),
  performedByUserId: integer("performed_by_user_id"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeClockClosures = pgTable("time_clock_closures", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  referenceMonth: text("reference_month").notNull(),
  status: text("status").notNull().default("closed"), // closed | reopened
  notes: text("notes"),
  closedByUserId: integer("closed_by_user_id"),
  closedAt: timestamp("closed_at").defaultNow(),
  reopenedByUserId: integer("reopened_by_user_id"),
  reopenedAt: timestamp("reopened_at"),
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

// ===== CRM OPPORTUNITIES (KANBAN) =====
export const crmOpportunities = pgTable("crm_opportunities", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  title: text("title").notNull(),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  source: text("source"),
  stage: text("stage").notNull().default("lead"), // lead | qualified | proposal | negotiation | won | no_interest
  amount: real("amount").default(0),
  expectedCloseDate: date("expected_close_date"),
  ownerId: integer("owner_id"),
  ownerStaffId: integer("owner_staff_id"),
  notes: text("notes"),
  followUpTasks: text("follow_up_tasks").default("[]"),
  lostReason: text("lost_reason"),
  position: integer("position").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ===== RELATIONS =====
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  notifications: many(notifications),
  residents: many(residents),
  patientDocuments: many(patientDocuments),
  staff: many(staff),
  contracts: many(contracts),
  accountsPayable: many(accountsPayable),
  crmOpportunities: many(crmOpportunities),
  timeClockLocations: many(timeClockLocations),
  timeClockEntries: many(timeClockEntries),
  timeClockAdjustmentRequests: many(timeClockAdjustmentRequests),
  timeClockAuditLogs: many(timeClockAuditLogs),
  timeClockClosures: many(timeClockClosures),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  notifications: many(notifications),
  crmOwnedOpportunities: many(crmOpportunities),
}));

export const residentsRelations = relations(residents, ({ one, many }) => ({
  organization: one(organizations, { fields: [residents.organizationId], references: [organizations.id] }),
  medications: many(medications),
  occurrences: many(occurrences),
  shiftAssignments: many(shiftAssignments),
  medicalRecords: many(medicalRecords),
  comorbidities: many(comorbidities),
  familyMembers: many(familyMembers),
  patientDocuments: many(patientDocuments),
  contracts: many(contracts),
  monthlyFees: many(monthlyFees),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  organization: one(organizations, { fields: [staff.organizationId], references: [organizations.id] }),
  shiftAssignments: many(shiftAssignments),
  accountsPayable: many(accountsPayable),
  notifications: many(notifications),
  timeClockEntries: many(timeClockEntries),
  timeClockAdjustmentRequests: many(timeClockAdjustmentRequests),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(organizations, { fields: [notifications.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  staff: one(staff, { fields: [notifications.staffId], references: [staff.id] }),
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
  staff: one(staff, { fields: [medicalRecords.staffId], references: [staff.id] }),
}));

export const comorbiditiesRelations = relations(comorbidities, ({ one }) => ({
  resident: one(residents, { fields: [comorbidities.residentId], references: [residents.id] }),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  resident: one(residents, { fields: [familyMembers.residentId], references: [residents.id] }),
}));

export const patientDocumentsRelations = relations(patientDocuments, ({ one }) => ({
  resident: one(residents, { fields: [patientDocuments.residentId], references: [residents.id] }),
  organization: one(organizations, { fields: [patientDocuments.organizationId], references: [organizations.id] }),
  createdBy: one(users, { fields: [patientDocuments.createdByUserId], references: [users.id] }),
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

export const timeClockLocationsRelations = relations(timeClockLocations, ({ one, many }) => ({
  organization: one(organizations, { fields: [timeClockLocations.organizationId], references: [organizations.id] }),
  entries: many(timeClockEntries),
}));

export const timeClockEntriesRelations = relations(timeClockEntries, ({ one }) => ({
  organization: one(organizations, { fields: [timeClockEntries.organizationId], references: [organizations.id] }),
  staff: one(staff, { fields: [timeClockEntries.staffId], references: [staff.id] }),
  location: one(timeClockLocations, { fields: [timeClockEntries.locationId], references: [timeClockLocations.id] }),
}));

export const timeClockAdjustmentRequestsRelations = relations(timeClockAdjustmentRequests, ({ one }) => ({
  organization: one(organizations, { fields: [timeClockAdjustmentRequests.organizationId], references: [organizations.id] }),
  staff: one(staff, { fields: [timeClockAdjustmentRequests.staffId], references: [staff.id] }),
  entry: one(timeClockEntries, { fields: [timeClockAdjustmentRequests.entryId], references: [timeClockEntries.id] }),
  appliedEntry: one(timeClockEntries, { fields: [timeClockAdjustmentRequests.appliedEntryId], references: [timeClockEntries.id] }),
}));

export const timeClockAuditLogsRelations = relations(timeClockAuditLogs, ({ one }) => ({
  organization: one(organizations, { fields: [timeClockAuditLogs.organizationId], references: [organizations.id] }),
  staff: one(staff, { fields: [timeClockAuditLogs.staffId], references: [staff.id] }),
}));

export const timeClockClosuresRelations = relations(timeClockClosures, ({ one }) => ({
  organization: one(organizations, { fields: [timeClockClosures.organizationId], references: [organizations.id] }),
}));

export const crmOpportunitiesRelations = relations(crmOpportunities, ({ one }) => ({
  organization: one(organizations, { fields: [crmOpportunities.organizationId], references: [organizations.id] }),
  owner: one(users, { fields: [crmOpportunities.ownerId], references: [users.id] }),
  ownerStaff: one(staff, { fields: [crmOpportunities.ownerStaffId], references: [staff.id] }),
}));

// ===== INSERT SCHEMAS (server use) =====
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertResidentSchema = createInsertSchema(residents).omit({ id: true });
export const insertMedicationSchema = createInsertSchema(medications).omit({ id: true });
export const insertStaffSchema = createInsertSchema(staff).omit({ id: true });
export const insertOccurrenceSchema = createInsertSchema(occurrences).omit({ id: true, createdAt: true });
export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignments).omit({ id: true, createdAt: true });
export const insertMedicalRecordSchema = createInsertSchema(medicalRecords).omit({ id: true, createdAt: true });
export const insertComorbiditySchema = createInsertSchema(comorbidities).omit({ id: true, createdAt: true });
export const insertFamilyMemberSchema = createInsertSchema(familyMembers).omit({ id: true, createdAt: true });
export const insertPatientDocumentSchema = createInsertSchema(patientDocuments).omit({ id: true, createdAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true });
export const insertMonthlyFeeSchema = createInsertSchema(monthlyFees).omit({ id: true, createdAt: true });
export const insertAccountPayableSchema = createInsertSchema(accountsPayable).omit({ id: true, createdAt: true });
export const insertMedicationAdministrationSchema = createInsertSchema(medicationAdministrations).omit({ id: true });
export const insertCrmOpportunitySchema = createInsertSchema(crmOpportunities).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTimeClockLocationSchema = createInsertSchema(timeClockLocations).omit({ id: true, createdAt: true });
export const insertTimeClockEntrySchema = createInsertSchema(timeClockEntries).omit({ id: true, createdAt: true });
export const insertTimeClockAdjustmentRequestSchema = createInsertSchema(timeClockAdjustmentRequests).omit({ id: true, createdAt: true });
export const insertTimeClockAuditLogSchema = createInsertSchema(timeClockAuditLogs).omit({ id: true, createdAt: true });
export const insertTimeClockClosureSchema = createInsertSchema(timeClockClosures).omit({ id: true, createdAt: true });

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
export const patientDocumentFormSchema = createInsertSchema(patientDocuments).omit({
  id: true,
  organizationId: true,
  residentId: true,
  createdByUserId: true,
  createdAt: true,
});
export const contractFormSchema = createInsertSchema(contracts).omit({ id: true, organizationId: true, createdAt: true });
export const monthlyFeeFormSchema = createInsertSchema(monthlyFees).omit({ id: true, organizationId: true, createdAt: true });
export const accountPayableFormSchema = createInsertSchema(accountsPayable).omit({ id: true, organizationId: true, createdAt: true });
export const medicationAdministrationFormSchema = createInsertSchema(medicationAdministrations).omit({ id: true, organizationId: true, administeredAt: true });
export const crmOpportunityFormSchema = createInsertSchema(crmOpportunities).omit({ id: true, organizationId: true, createdAt: true, updatedAt: true });
export const timeClockLocationFormSchema = createInsertSchema(timeClockLocations).omit({ id: true, organizationId: true, createdAt: true });
export const timeClockEntryFormSchema = createInsertSchema(timeClockEntries).omit({ id: true, organizationId: true, userId: true, createdAt: true });
export const timeClockAdjustmentRequestFormSchema = createInsertSchema(timeClockAdjustmentRequests).omit({
  id: true,
  organizationId: true,
  staffId: true,
  requestedByUserId: true,
  status: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewerNotes: true,
  appliedEntryId: true,
  createdAt: true,
});

// ===== TYPES =====
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type AppNotification = typeof notifications.$inferSelect;
export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect;
export type Resident = typeof residents.$inferSelect;
export type Medication = typeof medications.$inferSelect;
export type StaffMember = typeof staff.$inferSelect;
export type Occurrence = typeof occurrences.$inferSelect;
export type ShiftAssignment = typeof shiftAssignments.$inferSelect;
export type MedicalRecord = typeof medicalRecords.$inferSelect;
export type Comorbidity = typeof comorbidities.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type PatientDocument = typeof patientDocuments.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type MonthlyFee = typeof monthlyFees.$inferSelect;
export type AccountPayable = typeof accountsPayable.$inferSelect;
export type MedicationAdministration = typeof medicationAdministrations.$inferSelect;
export type CrmOpportunity = typeof crmOpportunities.$inferSelect;
export type TimeClockLocation = typeof timeClockLocations.$inferSelect;
export type TimeClockEntry = typeof timeClockEntries.$inferSelect;
export type UpdateTimeClockEntryRequest = Partial<InsertTimeClockEntry>;
export type TimeClockAdjustmentRequest = typeof timeClockAdjustmentRequests.$inferSelect;
export type TimeClockAuditLog = typeof timeClockAuditLogs.$inferSelect;
export type TimeClockClosure = typeof timeClockClosures.$inferSelect;

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type InsertResident = z.infer<typeof insertResidentSchema>;
export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type InsertOccurrence = z.infer<typeof insertOccurrenceSchema>;
export type InsertShiftAssignment = z.infer<typeof insertShiftAssignmentSchema>;
export type InsertMedicalRecord = z.infer<typeof insertMedicalRecordSchema>;
export type InsertComorbidity = z.infer<typeof insertComorbiditySchema>;
export type InsertFamilyMember = z.infer<typeof insertFamilyMemberSchema>;
export type InsertPatientDocument = z.infer<typeof insertPatientDocumentSchema>;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type InsertMonthlyFee = z.infer<typeof insertMonthlyFeeSchema>;
export type InsertAccountPayable = z.infer<typeof insertAccountPayableSchema>;
export type InsertMedicationAdministration = z.infer<typeof insertMedicationAdministrationSchema>;
export type InsertCrmOpportunity = z.infer<typeof insertCrmOpportunitySchema>;
export type InsertTimeClockLocation = z.infer<typeof insertTimeClockLocationSchema>;
export type InsertTimeClockEntry = z.infer<typeof insertTimeClockEntrySchema>;
export type InsertTimeClockAdjustmentRequest = z.infer<typeof insertTimeClockAdjustmentRequestSchema>;
export type InsertTimeClockAuditLog = z.infer<typeof insertTimeClockAuditLogSchema>;
export type InsertTimeClockClosure = z.infer<typeof insertTimeClockClosureSchema>;

export type ResidentFormInput = z.infer<typeof residentFormSchema>;
export type MedicationFormInput = z.infer<typeof medicationFormSchema>;
export type StaffFormInput = z.infer<typeof staffFormSchema>;
export type OccurrenceFormInput = z.infer<typeof occurrenceFormSchema>;
export type CrmOpportunityFormInput = z.infer<typeof crmOpportunityFormSchema>;

export type UpdateResidentRequest = Partial<InsertResident>;
export type UpdateMedicationRequest = Partial<InsertMedication>;
export type UpdateStaffRequest = Partial<InsertStaff>;
export type UpdateShiftAssignmentRequest = Partial<InsertShiftAssignment>;
export type UpdateOccurrenceRequest = Partial<InsertOccurrence>;
export type UpdateContractRequest = Partial<InsertContract>;
export type UpdateMonthlyFeeRequest = Partial<InsertMonthlyFee>;
export type UpdateAccountPayableRequest = Partial<InsertAccountPayable>;
export type UpdateCrmOpportunityRequest = Partial<InsertCrmOpportunity>;
export type UpdateTimeClockLocationRequest = Partial<InsertTimeClockLocation>;
export type UpdateTimeClockAdjustmentRequest = Partial<InsertTimeClockAdjustmentRequest>;
export type UpdateTimeClockClosureRequest = Partial<InsertTimeClockClosure>;

export type DashboardStats = {
  totalResidents: number;
  capacity: number;
  occupancyRate: number;
  activeMedications: number;
  overdueMedicationDoses: number;
  pendingOccurrences: number;
  birthdaysThisMonth: number;
  overdueFeesCount: number;
  pendingFeesAmount: number;
  activeContracts: number;
  timeClockPendingApprovals: number;
  timeClockPendingAdjustments: number;
  timeClockIncompleteToday: number;
  timeClockOutOfRangeToday: number;
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
