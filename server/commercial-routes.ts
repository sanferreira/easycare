import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import {
  LIFECYCLE_STAGES,
  serializeTags,
  parseTags,
  isTrialEndingSoon,
  isBillingRisk,
  isWithoutPlan,
  isChurning,
  resolveOrgStatus,
  formatCentsBRL,
  estimateMrrCents,
} from "@shared/commercial";

type RegisterHelpers = {
  requireAuth: (req: Request, res: Response, next: () => void) => void;
  requireSuperAdmin: (req: Request, res: Response, next: () => void) => void;
  logAudit: (
    req: Request,
    input: {
      action: string;
      entityType: string;
      entityId?: number;
      organizationId?: number;
      message: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<void>;
  parseManualAccessUntilInput: (value: unknown) => Date | null | undefined;
  parseBillingMethodInput: (value: unknown) => "stripe" | "manual_boleto" | undefined;
  parseNullableBoundedInteger: (
    value: unknown,
    fieldLabel: string,
    min: number,
    max: number,
  ) => number | null | undefined;
  DEFAULT_PAYMENT_GRACE_DAYS: number;
};

function parseOrgId(req: Request) {
  const orgId = Number(req.params.id ?? req.params.orgId);
  if (!Number.isInteger(orgId) || orgId <= 0) throw new Error("Organização inválida.");
  return orgId;
}

export function registerCommercialRoutes(app: Express, helpers: RegisterHelpers) {
  const {
    requireAuth,
    requireSuperAdmin,
    logAudit,
    parseManualAccessUntilInput,
    parseBillingMethodInput,
    parseNullableBoundedInteger,
    DEFAULT_PAYMENT_GRACE_DAYS,
  } = helpers;

  app.get("/api/admin/superadmins", requireAuth, requireSuperAdmin, async (_req, res) => {
    const users = await storage.getSuperAdminUsers();
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username })));
  });

  app.get("/api/admin/commercial-kpis", requireAuth, requireSuperAdmin, async (_req, res) => {
    const orgs = await storage.getOrganizations(true);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let trialEnding = 0;
    let billingRisk = 0;
    let manualBoleto = 0;
    let churning = 0;
    let withoutPlan = 0;
    let activePaid = 0;
    let customPlan = 0;
    let estimatedMrrCents = 0;
    let signupsThisMonth = 0;
    let convertedThisMonth = 0;

    for (const org of orgs) {
      if (isTrialEndingSoon(org)) trialEnding += 1;
      if (isBillingRisk(org)) billingRisk += 1;
      if (org.billingMethod === "manual_boleto") manualBoleto += 1;
      if (isChurning(org)) churning += 1;
      if (isWithoutPlan(org)) withoutPlan += 1;
      if (org.stripeSubscriptionStatus === "active") activePaid += 1;
      if (org.customPlanEnabled) customPlan += 1;

      const mrr = estimateMrrCents(org);
      if (mrr) estimatedMrrCents += mrr;

      const created = org.createdAt ? new Date(org.createdAt) : null;
      if (created && created >= monthStart) {
        signupsThisMonth += 1;
        if (org.stripeSubscriptionStatus === "active") convertedThisMonth += 1;
      }
    }

    res.json({
      trialEnding,
      billingRisk,
      manualBoleto,
      churning,
      withoutPlan,
      activePaid,
      customPlan,
      needsAction: trialEnding + billingRisk + withoutPlan,
      estimatedMrrCents,
      estimatedMrrFormatted: formatCentsBRL(estimatedMrrCents),
      signupsThisMonth,
      convertedThisMonth,
      trialToPaidRate:
        signupsThisMonth > 0 ? Math.round((convertedThisMonth / signupsThisMonth) * 100) : null,
    });
  });

  app.get("/api/organizations/:id/commercial", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const organization = await storage.getOrganization(orgId);
      if (!organization) return res.status(404).json({ message: "Organização não encontrada." });

      const emptyOwners: { id: number; name: string; email?: string | null }[] = [];
      const [contacts, activities, tasks, cycles, users, owners] = await Promise.all([
        storage.getCommercialContacts(orgId).catch((err) => {
          console.error("[commercial] contacts", err);
          return [];
        }),
        storage.getCommercialActivities(orgId, 80).catch((err) => {
          console.error("[commercial] activities", err);
          return [];
        }),
        storage.getCommercialTasks(orgId).catch((err) => {
          console.error("[commercial] tasks", err);
          return [];
        }),
        storage.getManualBillingCycles(orgId).catch((err) => {
          console.error("[commercial] billing-cycles", err);
          return [];
        }),
        storage.getUsersByOrganization(orgId).catch((err) => {
          console.error("[commercial] users", err);
          return [];
        }),
        storage.getSuperAdminUsers()
          .then((list) => list.map((u) => ({ id: u.id, name: u.name, email: u.email })))
          .catch((err) => {
            console.error("[commercial] owners", err);
            return emptyOwners;
          }),
      ]);

      res.json({
        organization: {
          ...organization,
          tags: parseTags(organization.tags),
          orgStatus: resolveOrgStatus(organization),
        },
        contacts,
        activities,
        tasks,
        manualBillingCycles: cycles,
        users,
        owners,
      });
    } catch (error) {
      console.error("[commercial] load account", error);
      const message = error instanceof Error ? error.message : "Erro ao carregar conta.";
      res.status(500).json({ message });
    }
  });

  app.put("/api/organizations/:id/commercial", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const organization = await storage.getOrganization(orgId);
      if (!organization) return res.status(404).json({ message: "Organização não encontrada." });

      const input = z.object({
        lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
        commercialOwnerUserId: z.number().int().positive().nullable().optional(),
        tags: z.array(z.string()).optional(),
        nextFollowUpAt: z.string().nullable().optional(),
        commercialNotes: z.string().nullable().optional(),
        churnReason: z.string().nullable().optional(),
        customPlanEnabled: z.boolean().optional(),
        customPlanLabel: z.string().nullable().optional(),
        customPlanAmountCents: z.number().int().min(0).nullable().optional(),
        customPlanInterval: z.enum(["month", "year"]).optional(),
        customPlanIntervalCount: z.number().int().min(1).max(36).optional(),
        customPlanPatientLimit: z.number().int().min(1).max(5000).nullable().optional(),
        billingMethod: z.enum(["stripe", "manual_boleto"]).optional(),
        manualBillingDueDay: z.number().int().min(1).max(31).nullable().optional(),
        paymentGraceDays: z.number().int().min(0).max(60).optional(),
      }).parse(req.body ?? {});

      if (input.customPlanEnabled) {
        if (!input.customPlanLabel?.trim() && !organization.customPlanLabel) {
          return res.status(400).json({ message: "Informe o nome do acordo especial." });
        }
        const amount = input.customPlanAmountCents ?? organization.customPlanAmountCents;
        if (!amount || amount <= 0) {
          return res.status(400).json({ message: "Informe o valor do acordo especial." });
        }
      }

      const updates: Record<string, unknown> = {};
      if (input.lifecycleStage !== undefined) updates.lifecycleStage = input.lifecycleStage;
      if (input.commercialOwnerUserId !== undefined) updates.commercialOwnerUserId = input.commercialOwnerUserId;
      if (input.tags !== undefined) updates.tags = serializeTags(input.tags);
      if (input.nextFollowUpAt !== undefined) {
        updates.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
      }
      if (input.commercialNotes !== undefined) updates.commercialNotes = input.commercialNotes;
      if (input.churnReason !== undefined) {
        updates.churnReason = input.churnReason;
        if (input.churnReason && !input.lifecycleStage) {
          updates.lifecycleStage = "churned";
        }
      }
      if (input.customPlanEnabled !== undefined) {
        updates.customPlanEnabled = input.customPlanEnabled;
        if (input.customPlanEnabled && !input.lifecycleStage) {
          updates.lifecycleStage = "special";
        }
      }
      if (input.customPlanLabel !== undefined) updates.customPlanLabel = input.customPlanLabel;
      if (input.customPlanAmountCents !== undefined) updates.customPlanAmountCents = input.customPlanAmountCents;
      if (input.customPlanInterval !== undefined) updates.customPlanInterval = input.customPlanInterval;
      if (input.customPlanIntervalCount !== undefined) updates.customPlanIntervalCount = input.customPlanIntervalCount;
      if (input.customPlanPatientLimit !== undefined) updates.customPlanPatientLimit = input.customPlanPatientLimit;
      if (input.billingMethod !== undefined) updates.billingMethod = input.billingMethod;
      if (input.manualBillingDueDay !== undefined) updates.manualBillingDueDay = input.manualBillingDueDay;
      if (input.paymentGraceDays !== undefined) updates.paymentGraceDays = input.paymentGraceDays;

      const updated = await storage.updateOrganization(orgId, updates as any);
      await logAudit(req, {
        action: "organization.commercial_updated",
        entityType: "organization",
        entityId: orgId,
        organizationId: orgId,
        message: `Dados comerciais de ${updated.name} atualizados.`,
        metadata: { fields: Object.keys(updates) },
      });

      if (input.customPlanEnabled === false && organization.customPlanEnabled) {
        await storage.createCommercialActivity({
          organizationId: orgId,
          type: "system",
          body: "Acordo especial desligado. Assinatura atual segue até cancelar; depois o cliente escolhe plano padrão.",
          actorUserId: req.session.user?.id ?? null,
        });
      }

      res.json({
        ...updated,
        tags: parseTags(updated.tags),
        orgStatus: resolveOrgStatus(updated),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar dados comerciais.";
      res.status(400).json({ message });
    }
  });

  // --- Contacts ---
  app.get("/api/organizations/:id/commercial/contacts", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = parseOrgId(req);
    res.json(await storage.getCommercialContacts(orgId));
  });

  app.post("/api/organizations/:id/commercial/contacts", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        name: z.string().min(1),
        role: z.string().optional().nullable(),
        email: z.string().email().optional().nullable().or(z.literal("")),
        phone: z.string().optional().nullable(),
        isPrimary: z.boolean().optional(),
      }).parse(req.body ?? {});

      const contact = await storage.createCommercialContact({
        organizationId: orgId,
        name: input.name.trim(),
        role: input.role || null,
        email: input.email || null,
        phone: input.phone || null,
        isPrimary: Boolean(input.isPrimary),
      });
      await storage.createCommercialActivity({
        organizationId: orgId,
        type: "system",
        body: `Contato adicionado: ${contact.name}`,
        actorUserId: req.session.user?.id ?? null,
      });
      res.status(201).json(contact);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar contato.";
      res.status(400).json({ message });
    }
  });

  app.put("/api/organizations/:id/commercial/contacts/:contactId", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const contactId = Number(req.params.contactId);
      const input = z.object({
        name: z.string().min(1).optional(),
        role: z.string().optional().nullable(),
        email: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        isPrimary: z.boolean().optional(),
      }).parse(req.body ?? {});
      const updated = await storage.updateCommercialContact(orgId, contactId, input as any);
      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar contato.";
      res.status(400).json({ message });
    }
  });

  app.delete("/api/organizations/:id/commercial/contacts/:contactId", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = parseOrgId(req);
    await storage.deleteCommercialContact(orgId, Number(req.params.contactId));
    res.json({ ok: true });
  });

  // --- Activities ---
  app.get("/api/organizations/:id/commercial/activities", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = parseOrgId(req);
    res.json(await storage.getCommercialActivities(orgId, Number(req.query.limit) || 80));
  });

  app.post("/api/organizations/:id/commercial/activities", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        type: z.enum(["note", "call", "whatsapp", "email", "system"]).default("note"),
        body: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }).parse(req.body ?? {});

      const activity = await storage.createCommercialActivity({
        organizationId: orgId,
        type: input.type,
        body: input.body.trim(),
        actorUserId: req.session.user?.id ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });
      res.status(201).json(activity);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao registrar atividade.";
      res.status(400).json({ message });
    }
  });

  app.post("/api/organizations/:id/commercial/outreach", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        channel: z.enum(["whatsapp", "email"]),
        target: z.string().optional(),
        body: z.string().optional(),
      }).parse(req.body ?? {});

      const activity = await storage.createCommercialActivity({
        organizationId: orgId,
        type: input.channel,
        body: input.body?.trim()
          || (input.channel === "whatsapp"
            ? `Contato iniciado via WhatsApp${input.target ? ` (${input.target})` : ""}.`
            : `Contato iniciado via e-mail${input.target ? ` (${input.target})` : ""}.`),
        actorUserId: req.session.user?.id ?? null,
        metadata: JSON.stringify({ target: input.target ?? null }),
      });
      res.status(201).json(activity);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao registrar contato.";
      res.status(400).json({ message });
    }
  });

  // --- Tasks ---
  app.get("/api/organizations/:id/commercial/tasks", requireAuth, requireSuperAdmin, async (req, res) => {
    const orgId = parseOrgId(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await storage.getCommercialTasks(orgId, { status }));
  });

  app.post("/api/organizations/:id/commercial/tasks", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        title: z.string().min(1),
        dueAt: z.string().optional().nullable(),
        assigneeUserId: z.number().int().positive().optional().nullable(),
        queue: z.string().optional().nullable(),
        dedupeKey: z.string().optional().nullable(),
      }).parse(req.body ?? {});

      const task = await storage.createCommercialTask({
        organizationId: orgId,
        title: input.title.trim(),
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeUserId: input.assigneeUserId ?? null,
        queue: input.queue ?? null,
        dedupeKey: input.dedupeKey ?? null,
        status: "open",
      });
      res.status(201).json(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar tarefa.";
      res.status(400).json({ message });
    }
  });

  app.put("/api/organizations/:id/commercial/tasks/:taskId", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const taskId = Number(req.params.taskId);
      const input = z.object({
        title: z.string().min(1).optional(),
        dueAt: z.string().nullable().optional(),
        status: z.enum(["open", "done"]).optional(),
        assigneeUserId: z.number().int().positive().nullable().optional(),
      }).parse(req.body ?? {});

      const updates: Record<string, unknown> = {};
      if (input.title !== undefined) updates.title = input.title;
      if (input.dueAt !== undefined) updates.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (input.assigneeUserId !== undefined) updates.assigneeUserId = input.assigneeUserId;
      if (input.status !== undefined) {
        updates.status = input.status;
        updates.completedAt = input.status === "done" ? new Date() : null;
      }
      const updated = await storage.updateCommercialTask(orgId, taskId, updates as any);
      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar tarefa.";
      res.status(400).json({ message });
    }
  });

  // --- Liberação / confirmar boleto dedicado ---
  app.post("/api/organizations/:id/commercial/release-access", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const organization = await storage.getOrganization(orgId);
      if (!organization) return res.status(404).json({ message: "Organização não encontrada." });

      const input = z.object({
        days: z.coerce.number().int().min(1).max(90).default(30),
        reason: z.string().min(3),
        billingMethod: z.enum(["stripe", "manual_boleto"]).optional(),
        markBoletoPaid: z.boolean().optional(),
        amountCents: z.number().int().min(0).optional().nullable(),
      }).parse(req.body ?? {});

      const endsAt = new Date();
      endsAt.setHours(23, 59, 59, 999);
      endsAt.setDate(endsAt.getDate() + input.days);

      const billingMethod = input.billingMethod
        ?? (input.markBoletoPaid ? "manual_boleto" : (organization.billingMethod as "stripe" | "manual_boleto") || "stripe");

      const updated = await storage.updateOrganization(orgId, {
        status: "active",
        active: true,
        manualAccessUntil: endsAt,
        billingMethod,
        manualBillingDueDay: billingMethod === "manual_boleto"
          ? (organization.manualBillingDueDay ?? Math.min(Math.max(new Date().getDate(), 1), 28))
          : organization.manualBillingDueDay,
        paymentGraceDays: organization.paymentGraceDays ?? DEFAULT_PAYMENT_GRACE_DAYS,
        lifecycleStage: billingMethod === "manual_boleto" ? "active" : (organization.lifecycleStage || "active"),
      });

      if (input.markBoletoPaid) {
        const now = new Date();
        const periodYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const dueDay = updated.manualBillingDueDay ?? now.getDate();
        const dueDate = `${periodYm}-${String(Math.min(dueDay, 28)).padStart(2, "0")}`;
        await storage.upsertManualBillingCycle({
          organizationId: orgId,
          periodYm,
          dueDate,
          amountCents: input.amountCents ?? null,
          status: "paid",
          paidAt: now,
          note: input.reason,
        });
      }

      await storage.createCommercialActivity({
        organizationId: orgId,
        type: "system",
        body: input.markBoletoPaid
          ? `Boleto confirmado / acesso liberado até ${endsAt.toLocaleDateString("pt-BR")}. Motivo: ${input.reason}`
          : `Acesso liberado até ${endsAt.toLocaleDateString("pt-BR")}. Motivo: ${input.reason}`,
        actorUserId: req.session.user?.id ?? null,
      });

      await logAudit(req, {
        action: "organization.manual_access_released",
        entityType: "organization",
        entityId: orgId,
        organizationId: orgId,
        message: `Acesso liberado para ${updated.name} até ${endsAt.toISOString()}. Motivo: ${input.reason}`,
        metadata: { days: input.days, markBoletoPaid: Boolean(input.markBoletoPaid) },
      });

      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao liberar acesso.";
      res.status(400).json({ message });
    }
  });

  // --- Manual billing cycles ---
  app.get("/api/organizations/:id/commercial/billing-cycles", requireAuth, requireSuperAdmin, async (req, res) => {
    res.json(await storage.getManualBillingCycles(parseOrgId(req)));
  });

  app.post("/api/organizations/:id/commercial/billing-cycles", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        periodYm: z.string().regex(/^\d{4}-\d{2}$/),
        dueDate: z.string().min(8),
        amountCents: z.number().int().min(0).nullable().optional(),
        status: z.enum(["pending", "paid", "overdue", "waived"]).default("pending"),
        note: z.string().optional().nullable(),
      }).parse(req.body ?? {});

      const cycle = await storage.upsertManualBillingCycle({
        organizationId: orgId,
        periodYm: input.periodYm,
        dueDate: input.dueDate,
        amountCents: input.amountCents ?? null,
        status: input.status,
        paidAt: input.status === "paid" ? new Date() : null,
        note: input.note ?? null,
      });
      res.status(201).json(cycle);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar ciclo.";
      res.status(400).json({ message });
    }
  });

  app.put("/api/organizations/:id/commercial/billing-cycles/:cycleId", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const cycleId = Number(req.params.cycleId);
      const input = z.object({
        status: z.enum(["pending", "paid", "overdue", "waived"]).optional(),
        amountCents: z.number().int().min(0).nullable().optional(),
        note: z.string().nullable().optional(),
        dueDate: z.string().optional(),
      }).parse(req.body ?? {});

      const updates: Record<string, unknown> = { ...input };
      if (input.status === "paid") updates.paidAt = new Date();
      if (input.status && input.status !== "paid") updates.paidAt = null;

      const updated = await storage.updateManualBillingCycle(orgId, cycleId, updates as any);
      if (input.status === "paid") {
        await storage.createCommercialActivity({
          organizationId: orgId,
          type: "system",
          body: `Ciclo ${updated.periodYm} marcado como pago.`,
          actorUserId: req.session.user?.id ?? null,
        });
      }
      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao atualizar ciclo.";
      res.status(400).json({ message });
    }
  });

  // --- Churn playbook ---
  app.post("/api/organizations/:id/commercial/churn", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseOrgId(req);
      const input = z.object({
        reason: z.string().min(3),
        inactivate: z.boolean().optional().default(false),
      }).parse(req.body ?? {});

      const updated = await storage.updateOrganization(orgId, {
        lifecycleStage: "churned",
        churnReason: input.reason,
        ...(input.inactivate ? { status: "inactive", active: false } : {}),
      });

      await storage.createCommercialActivity({
        organizationId: orgId,
        type: "system",
        body: `Churn registrado: ${input.reason}`,
        actorUserId: req.session.user?.id ?? null,
      });

      await logAudit(req, {
        action: "organization.churned",
        entityType: "organization",
        entityId: orgId,
        organizationId: orgId,
        message: `Churn de ${updated.name}: ${input.reason}`,
      });

      res.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao registrar churn.";
      res.status(400).json({ message });
    }
  });

  // Keep unused parsers referenced for future billing edits from commercial panel
  void parseManualAccessUntilInput;
  void parseBillingMethodInput;
  void parseNullableBoundedInteger;
}
