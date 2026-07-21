import { z } from 'zod';
import type { EnvironmentSettings } from './environment';
import { 
  residentFormSchema,
  medicationFormSchema,
  staffFormSchema,
  occurrenceFormSchema,
  shiftAssignmentFormSchema,
  accountPayableFormSchema,
  notifications,
  residents,
  medications,
  staff,
  occurrences,
  shiftAssignments,
  accountsPayable,
  insertUserSchema
} from './schema';

const staffApiFormSchema = staffFormSchema.extend({
  portalPassword: z.string().optional(),
});

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login',
      input: z.object({
        organizationCnpj: z.string().optional(),
        username: z.string(),
        password: z.string(),
      }),
      responses: {
        200: z.object({ success: z.boolean(), user: z.any() }),
        401: z.object({ message: z.string() }),
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout',
      responses: {
        200: z.object({ success: z.boolean() }),
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me',
      responses: {
        200: z.any().nullable(),
      },
    }
  },
  residents: {
    list: {
      method: 'GET' as const,
      path: '/api/residents',
      input: z.object({
        search: z.string().optional(),
        status: z.enum(['active', 'inactive', 'deceased']).optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof residents.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/residents/:id',
      responses: {
        200: z.custom<typeof residents.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/residents',
      input: residentFormSchema,
      responses: {
        201: z.custom<typeof residents.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/residents/:id',
      input: residentFormSchema.partial(),
      responses: {
        200: z.custom<typeof residents.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/residents/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  medications: {
    list: {
      method: 'GET' as const,
      path: '/api/medications',
      input: z.object({
        residentId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof medications.$inferSelect & { residentName?: string }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/medications',
      input: medicationFormSchema,
      responses: {
        201: z.custom<typeof medications.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/medications/:id',
      input: medicationFormSchema.partial(),
      responses: {
        200: z.custom<typeof medications.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/medications/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  staff: {
    list: {
      method: 'GET' as const,
      path: '/api/staff',
      responses: {
        200: z.array(z.custom<typeof staff.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/staff',
      input: staffApiFormSchema,
      responses: {
        201: z.custom<typeof staff.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/staff/:id',
      input: staffApiFormSchema.partial(),
      responses: {
        200: z.custom<typeof staff.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/staff/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  occurrences: {
    list: {
      method: 'GET' as const,
      path: '/api/occurrences',
      input: z.object({
        residentId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof occurrences.$inferSelect & { residentName?: string }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/occurrences',
      input: occurrenceFormSchema,
      responses: {
        201: z.custom<typeof occurrences.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/occurrences/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  stats: {
    get: {
      method: 'GET' as const,
      path: '/api/stats',
      responses: {
        200: z.object({
          totalResidents: z.number(),
          capacity: z.number(),
          occupancyRate: z.number(),
          activeMedications: z.number(),
          overdueMedicationDoses: z.number(),
          pendingOccurrences: z.number(),
          birthdaysThisMonth: z.number(),
          overdueFeesCount: z.number().optional(),
          pendingFeesAmount: z.number().optional(),
          activeContracts: z.number().optional(),
          timeClockPendingApprovals: z.number().optional(),
          timeClockPendingAdjustments: z.number().optional(),
          timeClockIncompleteToday: z.number().optional(),
          timeClockOutOfRangeToday: z.number().optional(),
        }),
      },
    },
  },
  notifications: {
    list: {
      method: 'GET' as const,
      path: '/api/notifications',
      input: z.object({
        unreadOnly: z.coerce.boolean().optional(),
        limit: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.object({
          notifications: z.array(z.custom<typeof notifications.$inferSelect>()),
          unreadCount: z.number(),
        }),
      },
    },
    markRead: {
      method: 'PATCH' as const,
      path: '/api/notifications/:id/read',
      responses: {
        200: z.custom<typeof notifications.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    markAllRead: {
      method: 'PATCH' as const,
      path: '/api/notifications/read-all',
      responses: {
        200: z.object({ updated: z.number() }),
      },
    },
  },
  shiftAssignments: {
    list: {
      method: 'GET' as const,
      path: '/api/shift-assignments',
      input: z.object({
        residentId: z.coerce.number().optional(),
        staffId: z.coerce.number().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof shiftAssignments.$inferSelect & { residentName?: string, staffName?: string }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/shift-assignments',
      input: shiftAssignmentFormSchema,
      responses: {
        201: z.custom<typeof shiftAssignments.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/shift-assignments/:id',
      input: shiftAssignmentFormSchema.partial(),
      responses: {
        200: z.custom<typeof shiftAssignments.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/shift-assignments/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  accountsPayable: {
    list: {
      method: 'GET' as const,
      path: '/api/accounts-payable',
      input: z.object({
        staffId: z.coerce.number().optional(),
        status: z.enum(['pending', 'paid', 'overdue', 'cancelled']).optional(),
        referenceMonth: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof accountsPayable.$inferSelect & { staffName?: string }>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/accounts-payable',
      input: accountPayableFormSchema,
      responses: {
        201: z.custom<typeof accountsPayable.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/accounts-payable/:id',
      input: accountPayableFormSchema.partial(),
      responses: {
        200: z.custom<typeof accountsPayable.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/accounts-payable/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  environmentSettings: {
    get: {
      method: 'GET' as const,
      path: '/api/environment-settings',
      responses: {
        200: z.custom<EnvironmentSettings>(),
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/environment-settings',
      input: z.custom<EnvironmentSettings>(),
      responses: {
        200: z.custom<EnvironmentSettings>(),
      },
    },
  },
};

export type CreateResidentRequest = z.infer<typeof api.residents.create.input>;
export type UpdateResidentRequest = z.infer<typeof api.residents.update.input>;
export type CreateMedicationRequest = z.infer<typeof api.medications.create.input>;
export type UpdateMedicationRequest = z.infer<typeof api.medications.update.input>;
export type CreateStaffRequest = z.infer<typeof api.staff.create.input>;
export type UpdateStaffRequest = z.infer<typeof api.staff.update.input>;
export type CreateOccurrenceRequest = z.infer<typeof api.occurrences.create.input>;
export type UpdateEnvironmentSettingsRequest = z.infer<typeof api.environmentSettings.update.input>;

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
