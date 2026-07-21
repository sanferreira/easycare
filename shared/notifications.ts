export const NOTIFICATION_MODULE_LABELS = {
  system: "Sistema",
  time_clock: "Ponto",
  medications: "Medicações",
  finance: "Financeiro",
  crm: "CRM",
  clinical: "Prontuário",
  schedules: "Escalas",
} as const;

export const NOTIFICATION_TYPES = {
  timeClockPunchRegistered: "time_clock_punch_registered",
  timeClockEntryPendingApproval: "time_clock_entry_pending_approval",
  timeClockEntryReviewed: "time_clock_entry_reviewed",
  timeClockAdjustmentPending: "time_clock_adjustment_pending",
  timeClockAdjustmentReviewed: "time_clock_adjustment_reviewed",
  timeClockBreakReminder: "time_clock_break_reminder",
  timeClockBreakOverdue: "time_clock_break_overdue",
  timeClockClockOutMissing: "time_clock_clock_out_missing",
  medicationDoseReminder: "medication_dose_reminder",
  medicationDoseOverdue: "medication_dose_overdue",
  medicationDoseAttention: "medication_dose_attention",
} as const;

export type NotificationModule = keyof typeof NOTIFICATION_MODULE_LABELS;
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
