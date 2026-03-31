import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import type { SessionUser } from "@shared/schema";
import { verifyPassword } from "./security";
import { pool } from "./db";

const SessionStore = connectPgSimple(session);

type FamilyPortalSession = {
  id: number;
  name: string;
  relationship: string;
  residentId: number;
  organizationId: number;
};

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
    familyMember: FamilyPortalSession;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  app.use(session({
    name: "easycare.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SessionStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    }),
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  }));

  const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Muitas tentativas de login. Tente novamente em alguns minutos." },
  });

  const sanitizeUser = <T extends { password?: unknown }>(user: T) => {
    const { password: _password, ...safe } = user;
    return safe;
  };

  const sanitizeFamilyMember = <T extends { portalPassword?: unknown }>(member: T) => {
    const { portalPassword: _portalPassword, ...safe } = member;
    return safe;
  };
  const normalizePortalUsername = (username: string) => username.trim().toLowerCase();

  const regenerateSession = (req: Request) =>
    new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

  const assertPortalUsernameAvailable = async (
    orgId: number,
    username: unknown,
    currentMemberId?: number,
  ) => {
    if (typeof username !== "string") return;
    const normalized = normalizePortalUsername(username);
    if (!normalized) return;

    const existing = await storage.getFamilyMembersByPortalUsername(normalized);
    const conflict = existing.find(
      (member) => member.organizationId === orgId && member.id !== currentMemberId,
    );
    if (conflict) {
      throw new Error("Usuário do portal já está em uso. Escolha outro.");
    }
  };

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.user) return res.status(401).json({ message: "Não autorizado" });
    next();
  };
  const requireSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.user?.isSuperAdmin) return res.status(403).json({ message: "Acesso restrito ao super-admin" });
    next();
  };

  // Middleware de controle de acesso por papel (RBAC)
  const requireRole = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Não autorizado" });
    if (user.isSuperAdmin) return next(); // super-admin sempre passa
    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: `Acesso negado. Papel '${user.role}' não tem permissão para esta ação.` });
    }
    next();
  };

  // Papéis com acesso clínico
  const CLINICAL_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem", "fisioterapeuta", "nutricionista"];
  // Papéis com acesso financeiro
  const FINANCIAL_ROLES = ["admin", "recepcionista", "administrativo"];
  // Papéis com acesso ao módulo de equipe
  const STAFF_MGMT_ROLES = ["admin"];
  // Papéis com acesso a medicações
  const MEDICATION_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem"];

  const getOrgId = (req: Request): number => {
    const orgId = req.session.user?.organizationId;
    if (!orgId) throw new Error("Organization não encontrada na sessão");
    return orgId;
  };

  // ===== AUTH =====
  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    const { username, password, organizationCnpj, organizationId } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ message: "Usuário e senha obrigatórios" });
    }

    const normalizedUsername = username.trim();
    const parsedOrganizationCnpj =
      typeof organizationCnpj === "string" ? organizationCnpj.trim() : "";
    const parsedOrganizationId =
      typeof organizationId === "number"
        ? organizationId
        : typeof organizationId === "string" && organizationId.trim()
          ? Number(organizationId)
          : NaN;

    let organization =
      parsedOrganizationCnpj
        ? await storage.getOrganizationByCnpj(parsedOrganizationCnpj)
        : undefined;

    if (!organization && Number.isInteger(parsedOrganizationId) && parsedOrganizationId > 0) {
      organization = await storage.getOrganization(parsedOrganizationId);
    }

    if (organization) {

      const user = await storage.getUserByUsernameAndOrganization(normalizedUsername, organization.id);
      if (!user) return res.status(401).json({ message: "Usuário ou senha incorretos" });

      const passwordCheck = verifyPassword(password, user.password);
      if (!passwordCheck.valid) return res.status(401).json({ message: "Usuário ou senha incorretos" });
      if (passwordCheck.needsRehash) {
        await storage.updateUser(user.id, { password });
      }

      await regenerateSession(req);
      req.session.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
        isSuperAdmin: false,
      };
      return res.json({ success: true, user: req.session.user });
    }

    if (parsedOrganizationCnpj || (Number.isInteger(parsedOrganizationId) && parsedOrganizationId > 0)) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }

    const superAdmin = await storage.getSuperAdminByUsername(normalizedUsername);
    if (!superAdmin) {
      return res.status(400).json({ message: "Informe o CNPJ da organização para entrar." });
    }

    const passwordCheck = verifyPassword(password, superAdmin.password);
    if (!passwordCheck.valid) return res.status(401).json({ message: "Usuário ou senha incorretos" });
    if (passwordCheck.needsRehash) {
      await storage.updateUser(superAdmin.id, { password });
    }

    await regenerateSession(req);
    req.session.user = {
      id: superAdmin.id,
      username: superAdmin.username,
      name: superAdmin.name,
      role: superAdmin.role,
      organizationId: undefined,
      organizationName: undefined,
      isSuperAdmin: true,
    };
    res.json({ success: true, user: req.session.user });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("easycare.sid");
      res.json({ success: true });
    });
  });
  app.get("/api/auth/me", (req, res) => { res.json(req.session.user || null); });

  // ===== FAMILY PORTAL AUTH =====
  const requireFamilyAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.familyMember) return res.status(401).json({ message: "Não autorizado" });
    next();
  };

  app.post("/api/family-portal/login", loginRateLimiter, async (req, res) => {
    const { username, password, organizationCnpj } = req.body;
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ message: "Usuário e senha obrigatórios" });
    }

    const parsedOrganizationCnpj =
      typeof organizationCnpj === "string" ? organizationCnpj.trim() : "";
    if (!parsedOrganizationCnpj) {
      return res.status(400).json({ message: "Informe o CNPJ da organização para entrar." });
    }

    const organization = await storage.getOrganizationByCnpj(parsedOrganizationCnpj);
    if (!organization) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }

    const candidates = (await storage.getFamilyMembersByPortalUsername(username))
      .filter((member) => member.organizationId === organization.id);

    const validMatches = candidates
      .map((member) => ({ member, passwordCheck: verifyPassword(password, member.portalPassword ?? "") }))
      .filter((entry) => entry.passwordCheck.valid);

    if (validMatches.length === 0) {
      return res.status(401).json({ message: "Usuário ou senha incorretos" });
    }
    if (validMatches.length > 1) {
      return res.status(400).json({
        message: "Encontramos mais de um acesso com essas credenciais. Solicite ao administrador a redefinição do usuário do portal.",
      });
    }

    const { member, passwordCheck } = validMatches[0];

    if (passwordCheck.needsRehash) {
      await storage.updateFamilyMember(member.organizationId, member.id, { portalPassword: password });
    }

    await regenerateSession(req);
    req.session.familyMember = {
      id: member.id,
      name: member.name,
      relationship: member.relationship,
      residentId: member.residentId,
      organizationId: member.organizationId,
    };
    res.json({ success: true, familyMember: req.session.familyMember });
  });

  app.post("/api/family-portal/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("easycare.sid");
      res.json({ success: true });
    });
  });

  app.get("/api/family-portal/me", (req, res) => {
    res.json(req.session.familyMember || null);
  });

  app.get("/api/family-portal/resident", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const resident = await storage.getResident(organizationId, residentId);
    if (!resident) return res.status(404).json({ message: "Residente não encontrado" });
    // Return safe subset of resident data for family
    res.json({
      id: resident.id,
      name: resident.name,
      birthDate: resident.birthDate,
      roomNumber: resident.roomNumber,
      admissionDate: resident.admissionDate,
      healthNotes: resident.healthNotes,
      allergies: resident.allergies,
      dietaryRestrictions: resident.dietaryRestrictions,
      mobilityStatus: resident.mobilityStatus,
      cognitiveStatus: resident.cognitiveStatus,
      status: resident.status,
    });
  });

  app.get("/api/family-portal/medical-records", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const records = await storage.getMedicalRecords(organizationId, residentId);
    // Only return shared records for family portal
    res.json(records.filter(r => r.visibility === "shared"));
  });

  app.get("/api/family-portal/medications", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const meds = await storage.getMedications(organizationId, residentId);
    res.json(meds.filter(m => m.status === "active"));
  });

  app.get("/api/family-portal/occurrences", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    const occs = await storage.getOccurrences(organizationId, residentId);
    // Only show medium and high severity occurrences to family
    res.json(occs.filter(o => o.severity !== "low"));
  });

  app.get("/api/family-portal/comorbidities", requireFamilyAuth, async (req, res) => {
    const { residentId, organizationId } = req.session.familyMember!;
    res.json(await storage.getComorbidities(organizationId, residentId));
  });

  // ===== ORGANIZATIONS =====
  app.get("/api/organizations", requireAuth, requireSuperAdmin, async (_req, res) => {
    res.json(await storage.getOrganizations());
  });
  app.post("/api/organizations", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, address, phone, email, cnpj, capacity } = req.body;
      if (!name || !cnpj || typeof cnpj !== "string" || !cnpj.trim()) {
        return res.status(400).json({ message: "Nome e CNPJ são obrigatórios" });
      }
      res.status(201).json(await storage.createOrganization({
        name,
        address,
        phone,
        email,
        cnpj: cnpj.trim(),
        capacity,
        active: true,
      }));
    } catch { res.status(500).json({ message: "Erro ao criar organização" }); }
  });
  app.put("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const payload = { ...req.body };
    if (typeof payload.cnpj === "string") payload.cnpj = payload.cnpj.trim();
    res.json(await storage.updateOrganization(Number(req.params.id), payload));
  });
  app.delete("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    await storage.deleteOrganization(Number(req.params.id));
    res.status(204).send();
  });

  // ===== ORG USERS =====
  app.get("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    const users = await storage.getUsersByOrganization(Number(req.params.id));
    res.json(users.map(sanitizeUser));
  });
  app.post("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { username, password, name, role } = req.body;
      if (!username || !password || !name) return res.status(400).json({ message: "Campos obrigatórios faltando" });
      const user = await storage.createUser({ organizationId: Number(req.params.id), username, password, name, role: role || "staff", isSuperAdmin: false });
      res.status(201).json(sanitizeUser(user));
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ message: "Nome de usuário já existe nesta organização" });
      res.status(500).json({ message: "Erro ao criar usuário" });
    }
  });
  app.patch("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, username, password, role } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (username !== undefined) updates.username = username;
      if (role !== undefined) updates.role = role;
      if (password && password.trim() !== "") updates.password = password;
      const updated = await storage.updateUser(Number(req.params.id), updates);
      res.json(sanitizeUser(updated));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Erro ao atualizar usuário" });
    }
  });
  app.delete("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    await storage.deleteUser(Number(req.params.id));
    res.status(204).send();
  });

  // ===== RESIDENTS =====
  app.get("/api/residents", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getResidents(orgId, req.query as any));
  });
  app.get("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const resident = await storage.getResident(orgId, Number(req.params.id));
    if (!resident) return res.status(404).json({ message: "Residente não encontrado" });
    res.json(resident);
  });
  app.post("/api/residents", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      res.status(201).json(await storage.createResident({ ...req.body, organizationId: orgId }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });
  app.put("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateResident(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/residents/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteResident(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== FAMILY MEMBERS =====
  app.get("/api/residents/:residentId/family", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const members = await storage.getFamilyMembers(orgId, Number(req.params.residentId));
    res.json(members.map(sanitizeFamilyMember));
  });
  app.post("/api/residents/:residentId/family", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const payload = {
        ...req.body,
        organizationId: orgId,
        residentId: Number(req.params.residentId),
      } as Record<string, unknown>;

      if (payload.portalAccess) {
        await assertPortalUsernameAvailable(orgId, payload.portalUsername);
      }

      const member = await storage.createFamilyMember(payload as any);
      res.status(201).json(sanitizeFamilyMember(member));
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : "Erro ao cadastrar familiar",
      });
    }
  });
  app.put("/api/family/:id", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const memberId = Number(req.params.id);
      const payload = { ...req.body } as Record<string, unknown>;

      if (payload.portalAccess || typeof payload.portalUsername === "string") {
        await assertPortalUsernameAvailable(orgId, payload.portalUsername, memberId);
      }

      const member = await storage.updateFamilyMember(orgId, memberId, payload as any);
      res.json(sanitizeFamilyMember(member));
    } catch (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : "Erro ao atualizar familiar",
      });
    }
  });
  app.delete("/api/family/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteFamilyMember(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== COMORBIDITIES =====
  app.get("/api/residents/:residentId/comorbidities", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getComorbidities(orgId, Number(req.params.residentId)));
  });
  app.post("/api/residents/:residentId/comorbidities", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createComorbidity({ ...req.body, organizationId: orgId, residentId: Number(req.params.residentId) }));
  });
  app.put("/api/comorbidities/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateComorbidity(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/comorbidities/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteComorbidity(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MEDICAL RECORDS / PRONTUÁRIO =====
  app.get("/api/residents/:residentId/medical-records", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMedicalRecords(orgId, Number(req.params.residentId), req.query.type as string | undefined));
  });
  app.post("/api/residents/:residentId/medical-records", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const authorId = req.session.user?.id;
    res.status(201).json(await storage.createMedicalRecord({ ...req.body, organizationId: orgId, residentId: Number(req.params.residentId), authorId }));
  });
  app.put("/api/medical-records/:id", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateMedicalRecord(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/medical-records/:id", requireAuth, requireRole(...CLINICAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMedicalRecord(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MEDICATIONS =====
  app.get("/api/medications", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMedications(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.post("/api/medications", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createMedication({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateMedication(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMedication(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MEDICATION ADMINISTRATIONS =====
  app.get("/api/medication-administrations", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMedicationAdministrations(
      orgId,
      req.query.residentId ? Number(req.query.residentId) : undefined,
      req.query.medicationId ? Number(req.query.medicationId) : undefined,
    ));
  });
  app.post("/api/medication-administrations", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const staffId = req.session.user?.id;
    res.status(201).json(await storage.createMedicationAdministration({ ...req.body, organizationId: orgId, staffId }));
  });

  // ===== STAFF =====
  // Leitura: admin + enfermeiro (para ver a equipe nas escalas)
  app.get("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES, "enfermeiro", "tecnico_enfermagem", "recepcionista", "administrativo"), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getStaff(orgId));
  });
  // Escrita: somente admin
  app.post("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createStaff({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateStaff(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteStaff(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== OCCURRENCES =====
  app.get("/api/occurrences", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getOccurrences(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.post("/api/occurrences", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const authorId = req.session.user?.id;
    res.status(201).json(await storage.createOccurrence({ ...req.body, organizationId: orgId, authorId }));
  });
  app.put("/api/occurrences/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.resolvedAt && typeof body.resolvedAt === "string") {
      body.resolvedAt = new Date(body.resolvedAt);
    }
    res.json(await storage.updateOccurrence(orgId, Number(req.params.id), body));
  });

  // ===== SHIFT ASSIGNMENTS =====
  const shiftInputSchema = z.object({
    staffId: z.number(),
    residentId: z.number().optional().nullable(),
    shiftType: z.enum(["12h_manha", "12h_noite", "24h", "avulso"]).default("avulso"),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    notes: z.string().optional().nullable(),
  });
  app.get("/api/shift-assignments", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const { residentId, staffId, start, end } = req.query;
    res.json(await storage.getShiftAssignments(orgId, {
      residentId: residentId ? Number(residentId) : undefined,
      staffId: staffId ? Number(staffId) : undefined,
      start: start ? new Date(start as string) : undefined,
      end: end ? new Date(end as string) : undefined,
    }));
  });
  // Escrita de escalas: admin + enfermeiro + tecnico + recepcionista + administrativo
  const SHIFT_WRITE_ROLES = ["admin", "enfermeiro", "tecnico_enfermagem", "recepcionista", "administrativo"];
  app.post("/api/shift-assignments", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const input = shiftInputSchema.parse(req.body);
      res.status(201).json(await storage.createShiftAssignment({ ...input, organizationId: orgId }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });
  app.put("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateShiftAssignment(orgId, Number(req.params.id), shiftInputSchema.partial().parse(req.body)));
  });
  app.delete("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteShiftAssignment(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== CONTRACTS =====
  app.get("/api/contracts", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getContracts(orgId, req.query.residentId ? Number(req.query.residentId) : undefined));
  });
  app.get("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const contract = await storage.getContract(orgId, Number(req.params.id));
    if (!contract) return res.status(404).json({ message: "Contrato não encontrado" });
    res.json(contract);
  });
  app.post("/api/contracts", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createContract({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.updateContract(orgId, Number(req.params.id), req.body));
  });
  app.delete("/api/contracts/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteContract(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== MONTHLY FEES =====
  app.get("/api/monthly-fees", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMonthlyFees(orgId, {
      contractId: req.query.contractId ? Number(req.query.contractId) : undefined,
      residentId: req.query.residentId ? Number(req.query.residentId) : undefined,
      status: req.query.status as string | undefined,
    }));
  });
  app.post("/api/monthly-fees", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createMonthlyFee({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/monthly-fees/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.paidAt && typeof body.paidAt === "string") {
      body.paidAt = new Date(body.paidAt);
    }
    res.json(await storage.updateMonthlyFee(orgId, Number(req.params.id), body));
  });
  app.delete("/api/monthly-fees/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMonthlyFee(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== STATS =====
  app.get("/api/stats", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getDashboardStats(orgId));
  });

  await seedDatabase();
  return httpServer;
}

async function seedDatabase() {
  const superAdmin = await storage.getSuperAdminByUsername("superadmin");

  // Always run new-module seeding if data is missing (even on existing DBs)
  await seedNewModules();
  // Always ensure portal credentials are set for seed family members
  await seedPortalCredentials();

  if (superAdmin) return;

  console.log("Seeding multi-tenant database...");

  await storage.createUser({ organizationId: null, username: "superadmin", password: "superadmin", name: "Super Administrador", role: "superadmin", isSuperAdmin: true });

  const org1 = await storage.createOrganization({ name: "Bem Viver ILPI", address: "Rua das Flores, 123 - São Paulo/SP", phone: "(11) 3333-0001", email: "contato@bemviver.com.br", cnpj: "12.345.678/0001-90", capacity: 50, active: true });
  const org2 = await storage.createOrganization({ name: "Lar Esperança", address: "Av. das Acácias, 456 - Campinas/SP", phone: "(19) 3333-0002", email: "contato@laresperanca.com.br", cnpj: "98.765.432/0001-10", capacity: 30, active: true });

  await storage.createUser({ organizationId: org1.id, username: "admin", password: "admin", name: "Administrador", role: "admin", isSuperAdmin: false });
  await storage.createUser({ organizationId: org2.id, username: "admin2", password: "admin2", name: "Administrador", role: "admin", isSuperAdmin: false });

  // === ORG 1 ===
  const r1 = await storage.createResident({ organizationId: org1.id, name: "Maria Silva", birthDate: "1945-03-15", gender: "F", cpf: "123.456.789-00", bloodType: "A+", mobilityStatus: "assistido", cognitiveStatus: "comprometimento leve", contactName: "João Silva", contactPhone: "(11) 99999-1234", contactRelationship: "Filho", admissionDate: "2023-01-10", roomNumber: "101-A", healthNotes: "Hipertensão, Diabetes Tipo 2.", allergies: "Dipirona", status: "active" });
  const r2 = await storage.createResident({ organizationId: org1.id, name: "Antônio Santos", birthDate: "1938-07-22", gender: "M", bloodType: "O-", mobilityStatus: "assistido", cognitiveStatus: "comprometimento moderado", contactName: "Ana Santos", contactPhone: "(11) 98888-5678", contactRelationship: "Filha", admissionDate: "2023-05-20", roomNumber: "102-B", healthNotes: "Alzheimer fase inicial.", allergies: "Nenhuma conhecida", status: "active" });
  const r3 = await storage.createResident({ organizationId: org1.id, name: "Josefa Oliveira", birthDate: "1950-11-05", gender: "F", bloodType: "B+", mobilityStatus: "independente", cognitiveStatus: "preservado", contactName: "Pedro Oliveira", contactPhone: "(11) 97777-4321", contactRelationship: "Sobrinho", admissionDate: "2024-02-15", roomNumber: "103-A", healthNotes: "Recuperação de fratura no fêmur.", allergies: "Lactose", status: "active" });

  const s1 = await storage.createStaff({ organizationId: org1.id, name: "Dra. Helena Costa", role: "enfermeiro", coren: "COREN-SP 123456", shift: "manhã", phone: "(11) 91111-1111", admissionDate: "2022-01-01", active: true });
  const s2 = await storage.createStaff({ organizationId: org1.id, name: "Carlos Ferreira", role: "cuidador", shift: "tarde", phone: "(11) 92222-2222", admissionDate: "2022-03-15", active: true });
  await storage.createStaff({ organizationId: org1.id, name: "Luciana Dias", role: "tecnico_enfermagem", coren: "COREN-SP 654321", shift: "noite", phone: "(11) 93333-3333", admissionDate: "2023-02-01", active: true });
  await storage.createStaff({ organizationId: org1.id, name: "Roberto Alves", role: "fisioterapeuta", specialty: "Fisioterapia Motora", shift: "manhã", phone: "(11) 94444-4444", admissionDate: "2023-06-01", active: true });

  await storage.createComorbidity({ organizationId: org1.id, residentId: r1.id, name: "Hipertensão Arterial Sistêmica", icd10: "I10", severity: "moderate", active: true });
  await storage.createComorbidity({ organizationId: org1.id, residentId: r1.id, name: "Diabetes Mellitus Tipo 2", icd10: "E11", severity: "moderate", active: true });
  await storage.createComorbidity({ organizationId: org1.id, residentId: r2.id, name: "Doença de Alzheimer", icd10: "G30", severity: "moderate", active: true });

  await storage.createFamilyMember({ organizationId: org1.id, residentId: r1.id, name: "João Silva", relationship: "Filho", phone: "(11) 99999-1234", email: "joao.silva@email.com", isPrimary: true, portalAccess: false });
  await storage.createFamilyMember({ organizationId: org1.id, residentId: r1.id, name: "Carla Silva", relationship: "Neta", phone: "(11) 99888-4321", email: "carla.silva@email.com", isPrimary: false, portalAccess: false });
  await storage.createFamilyMember({ organizationId: org1.id, residentId: r2.id, name: "Ana Santos", relationship: "Filha", phone: "(11) 98888-5678", email: "ana.santos@email.com", isPrimary: true, portalAccess: false });

  const today = new Date().toISOString().split("T")[0];
  await storage.createMedicalRecord({ organizationId: org1.id, residentId: r1.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente em bom estado geral. Pressão arterial controlada: 130/80 mmHg. Glicemia jejum: 118 mg/dL. Humor estável. Alimentação adequada. Sem intercorrências.", visibility: "shared", bloodPressure: "130/80", heartRate: 72, temperature: 36.4, oxygenSat: 97, mood: "bom" });
  await storage.createMedicalRecord({ organizationId: org1.id, residentId: r2.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente com episódio de confusão matinal. Reorientado pela equipe. Alimentação com assistência. Sem agressividade. Família informada.", visibility: "internal", mood: "regular" });

  await storage.createMedication({ organizationId: org1.id, residentId: r1.id, name: "Losartana", dosage: "50mg", frequency: "12h/12h", route: "oral", scheduleTime: "08:00, 20:00", prescribedBy: "Dr. Roberto Mendes", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r1.id, name: "Metformina", dosage: "850mg", frequency: "Após almoço", route: "oral", scheduleTime: "12:00", prescribedBy: "Dr. Roberto Mendes", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r2.id, name: "Donepezila", dosage: "10mg", frequency: "Noite", route: "oral", scheduleTime: "21:00", prescribedBy: "Dra. Claudia Reis", status: "active" });
  await storage.createMedication({ organizationId: org1.id, residentId: r3.id, name: "Calcitrin D3", dosage: "600mg/400UI", frequency: "Manhã", route: "oral", scheduleTime: "08:00", prescribedBy: "Dr. Paulo Braga", status: "active" });

  await storage.createOccurrence({ organizationId: org1.id, residentId: r2.id, type: "Comportamento", description: "Agitação noturna, acalmado após conversa com equipe.", severity: "low", status: "resolved", resolution: "Técnica de reorientação aplicada com sucesso." });
  await storage.createOccurrence({ organizationId: org1.id, residentId: r3.id, type: "Saúde", description: "Queixa de dor localizada após sessão de fisioterapia.", severity: "low", status: "open" });

  const c1 = await storage.createContract({ organizationId: org1.id, residentId: r1.id, plan: "premium", monthlyValue: 4500, startDate: "2023-01-10", paymentDay: 5, paymentMethod: "pix", status: "active", notes: "Contrato com pacote premium - quarto privativo, fisioterapia 3x/semana." });
  const c2 = await storage.createContract({ organizationId: org1.id, residentId: r2.id, plan: "standard", monthlyValue: 3200, startDate: "2023-05-20", paymentDay: 10, paymentMethod: "boleto", status: "active" });
  await storage.createContract({ organizationId: org1.id, residentId: r3.id, plan: "standard", monthlyValue: 3200, startDate: "2024-02-15", paymentDay: 10, paymentMethod: "boleto", status: "active" });

  const prevMonth = new Date(); prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const currMonth = new Date();
  const currMonthStr = `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}`;

  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c1.id, residentId: r1.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "paid", paidAt: new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 4), paymentMethod: "pix", receiptNumber: "PIX-001" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c1.id, residentId: r1.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "pending" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: r2.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "overdue" });
  await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: r2.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "pending" });

  const today7 = new Date(new Date().setHours(7, 0, 0, 0));
  const today19 = new Date(new Date().setHours(19, 0, 0, 0));
  const tomorrow7 = new Date(new Date(today7).setDate(today7.getDate() + 1));
  await storage.createShiftAssignment({ organizationId: org1.id, staffId: s1.id, residentId: null, shiftType: "12h_manha", startTime: today7, endTime: today19, notes: "Plantão manhã" } as any);
  await storage.createShiftAssignment({ organizationId: org1.id, staffId: s2.id, residentId: null, shiftType: "12h_noite", startTime: today19, endTime: tomorrow7, notes: "Plantão noite" } as any);

  // === ORG 2 ===
  const r4 = await storage.createResident({ organizationId: org2.id, name: "Benedita Rocha", birthDate: "1942-06-10", gender: "F", bloodType: "A-", mobilityStatus: "assistido", cognitiveStatus: "preservado", contactName: "Cláudia Rocha", contactPhone: "(19) 96666-1234", contactRelationship: "Filha", admissionDate: "2024-01-05", roomNumber: "01-A", healthNotes: "Insuficiência cardíaca leve.", allergies: "Penicilina", status: "active" });
  const r5 = await storage.createResident({ organizationId: org2.id, name: "Geraldo Moraes", birthDate: "1936-09-25", gender: "M", bloodType: "B+", mobilityStatus: "assistido", cognitiveStatus: "comprometimento leve", contactName: "Ricardo Moraes", contactPhone: "(19) 95555-4321", contactRelationship: "Filho", admissionDate: "2023-08-12", roomNumber: "02-B", healthNotes: "Parkinson fase 2. Apoio para locomoção.", allergies: "Nenhuma", status: "active" });

  const s3 = await storage.createStaff({ organizationId: org2.id, name: "Enfª. Patrícia Lima", role: "enfermeiro", coren: "COREN-SP 789012", shift: "manhã", phone: "(19) 91234-5678", active: true });
  const s4 = await storage.createStaff({ organizationId: org2.id, name: "Marcos Souza", role: "cuidador", shift: "noite", phone: "(19) 98765-4321", active: true });

  await storage.createComorbidity({ organizationId: org2.id, residentId: r4.id, name: "Insuficiência Cardíaca", icd10: "I50", severity: "mild", active: true });
  await storage.createComorbidity({ organizationId: org2.id, residentId: r5.id, name: "Doença de Parkinson", icd10: "G20", severity: "moderate", active: true });

  await storage.createMedication({ organizationId: org2.id, residentId: r4.id, name: "Enalapril", dosage: "10mg", frequency: "Manhã", route: "oral", scheduleTime: "08:00", status: "active" });
  await storage.createMedication({ organizationId: org2.id, residentId: r5.id, name: "Levodopa", dosage: "250mg", frequency: "8h/8h", route: "oral", scheduleTime: "08:00, 16:00, 00:00", status: "active" });

  await storage.createOccurrence({ organizationId: org2.id, residentId: r5.id, type: "Queda", description: "Episódio de queda ao levantar da cama. Sem lesões graves.", severity: "medium", status: "open" });

  const c3 = await storage.createContract({ organizationId: org2.id, residentId: r4.id, plan: "premium", monthlyValue: 4800, startDate: "2024-01-05", paymentDay: 1, paymentMethod: "boleto", status: "active" });
  await storage.createMonthlyFee({ organizationId: org2.id, contractId: c3.id, residentId: r4.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-01`, amount: 4800, status: "pending" });

  const t7 = new Date(new Date().setHours(7, 0, 0, 0));
  const t19 = new Date(new Date().setHours(19, 0, 0, 0));
  const tn7 = new Date(new Date(t7).setDate(t7.getDate() + 1));
  await storage.createShiftAssignment({ organizationId: org2.id, staffId: s3.id, residentId: null, shiftType: "12h_manha", startTime: t7, endTime: t19, notes: "Plantão dia" } as any);
  await storage.createShiftAssignment({ organizationId: org2.id, staffId: s4.id, residentId: null, shiftType: "12h_noite", startTime: t19, endTime: tn7, notes: "Plantão noite" } as any);

  console.log("Seed concluído com organizações e usuários de demonstração.");
}

async function seedNewModules() {
  // Find existing orgs to seed new modules (comorbidities, medical records, family, contracts, fees)
  const orgs = await storage.getOrganizations();
  if (orgs.length === 0) return;

  const org1 = orgs.find(o => o.name.includes("Bem Viver"));
  if (!org1) return;

  const residents = await storage.getResidents(org1.id);
  if (residents.length === 0) return;

  // Check if already seeded new modules (check comorbidities for first resident)
  const existingComorbidities = await storage.getComorbidities(org1.id, residents[0].id);
  if (existingComorbidities.length > 0) return; // Already seeded

  console.log("Seeding new modules (comorbidities, medical records, family, contracts, fees)...");

  const today = new Date().toISOString().split("T")[0];
  const currMonth = new Date();
  const currMonthStr = `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = new Date(); prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  for (const resident of residents) {
    if (resident.name.includes("Maria")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Hipertensão Arterial Sistêmica", icd10: "I10", severity: "moderate", active: true });
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Diabetes Mellitus Tipo 2", icd10: "E11", severity: "moderate", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "João Silva", relationship: "Filho", phone: "(11) 99999-1234", email: "joao.silva@email.com", isPrimary: true, portalAccess: true, portalUsername: "joao.silva", portalPassword: "familia123" });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Carla Silva", relationship: "Neta", phone: "(11) 99888-4321", isPrimary: false, portalAccess: false, portalUsername: null, portalPassword: null });
      await storage.createMedicalRecord({ organizationId: org1.id, residentId: resident.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente em bom estado geral. Pressão arterial controlada: 130/80 mmHg. Glicemia jejum: 118 mg/dL. Humor estável. Alimentação adequada. Sem intercorrências.", visibility: "shared", bloodPressure: "130/80", heartRate: 72, temperature: 36.4, oxygenSat: 97, mood: "bom" });
      const c = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "premium", monthlyValue: 4500, startDate: "2023-01-10", paymentDay: 5, paymentMethod: "pix", status: "active", notes: "Contrato premium - quarto privativo, fisioterapia 3x/semana." });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c.id, residentId: resident.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "paid", paidAt: new Date(), paymentMethod: "pix", receiptNumber: "PIX-001" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c.id, residentId: resident.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-05`, amount: 4500, status: "pending" });
    } else if (resident.name.includes("Antônio") || resident.name.includes("Antonio")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Doença de Alzheimer", icd10: "G30", severity: "moderate", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Ana Santos", relationship: "Filha", phone: "(11) 98888-5678", email: "ana.santos@email.com", isPrimary: true, portalAccess: true, portalUsername: "ana.santos", portalPassword: "familia123" });
      await storage.createMedicalRecord({ organizationId: org1.id, residentId: resident.id, date: today, type: "evolution", title: "Evolução diária", content: "Paciente com episódio de confusão matinal. Reorientado pela equipe. Alimentação com assistência. Sem agressividade.", visibility: "internal", mood: "regular" });
      const c2 = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "standard", monthlyValue: 3200, startDate: "2023-05-20", paymentDay: 10, paymentMethod: "boleto", status: "active" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c2.id, residentId: resident.id, referenceMonth: prevMonthStr, dueDate: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "overdue" });
    } else if (resident.name.includes("Josefa")) {
      await storage.createComorbidity({ organizationId: org1.id, residentId: resident.id, name: "Fratura de Fêmur (pós-operatório)", icd10: "S72", severity: "mild", active: true });
      await storage.createFamilyMember({ organizationId: org1.id, residentId: resident.id, name: "Pedro Oliveira", relationship: "Sobrinho", phone: "(11) 97777-4321", isPrimary: true, portalAccess: false });
      const c3 = await storage.createContract({ organizationId: org1.id, residentId: resident.id, plan: "standard", monthlyValue: 3200, startDate: "2024-02-15", paymentDay: 10, paymentMethod: "boleto", status: "active" });
      await storage.createMonthlyFee({ organizationId: org1.id, contractId: c3.id, residentId: resident.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-10`, amount: 3200, status: "pending" });
    }
  }

  // Org 2
  const org2 = orgs.find(o => o.name.includes("Esperança"));
  if (org2) {
    const r2List = await storage.getResidents(org2.id);
    for (const r of r2List) {
      if (r.name.includes("Benedita")) {
        await storage.createComorbidity({ organizationId: org2.id, residentId: r.id, name: "Insuficiência Cardíaca", icd10: "I50", severity: "mild", active: true });
        await storage.createFamilyMember({ organizationId: org2.id, residentId: r.id, name: "Cláudia Rocha", relationship: "Filha", phone: "(19) 96666-1234", isPrimary: true, portalAccess: true, portalUsername: "claudia.rocha", portalPassword: "familia123" });
        const c4 = await storage.createContract({ organizationId: org2.id, residentId: r.id, plan: "premium", monthlyValue: 4800, startDate: "2024-01-05", paymentDay: 1, paymentMethod: "boleto", status: "active" });
        await storage.createMonthlyFee({ organizationId: org2.id, contractId: c4.id, residentId: r.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-01`, amount: 4800, status: "pending" });
      } else if (r.name.includes("Geraldo")) {
        await storage.createComorbidity({ organizationId: org2.id, residentId: r.id, name: "Doença de Parkinson", icd10: "G20", severity: "moderate", active: true });
        await storage.createFamilyMember({ organizationId: org2.id, residentId: r.id, name: "Ricardo Moraes", relationship: "Filho", phone: "(19) 95555-4321", isPrimary: true, portalAccess: true, portalUsername: "ricardo.moraes", portalPassword: "familia123" });
        const c5 = await storage.createContract({ organizationId: org2.id, residentId: r.id, plan: "standard", monthlyValue: 3800, startDate: "2023-08-12", paymentDay: 15, paymentMethod: "pix", status: "active" });
        await storage.createMonthlyFee({ organizationId: org2.id, contractId: c5.id, residentId: r.id, referenceMonth: currMonthStr, dueDate: `${currMonth.getFullYear()}-${String(currMonth.getMonth() + 1).padStart(2, "0")}-15`, amount: 3800, status: "pending" });
      }
    }
  }

  console.log("Novos módulos semeados com sucesso!");
}

async function seedPortalCredentials() {
  // Update existing family members with portal credentials if missing
  const portalMap: Record<string, { username: string; password: string }> = {
    "João Silva":    { username: "joao.silva",    password: "familia123" },
    "Ana Santos":    { username: "ana.santos",    password: "familia123" },
    "Cláudia Rocha": { username: "claudia.rocha", password: "familia123" },
    "Ricardo Moraes":{ username: "ricardo.moraes",password: "familia123" },
  };

  const orgs = await storage.getOrganizations();
  for (const org of orgs) {
    const residents = await storage.getResidents(org.id);
    for (const resident of residents) {
      const members = await storage.getFamilyMembers(org.id, resident.id);
      for (const member of members) {
        const creds = portalMap[member.name];
        if (creds && !member.portalUsername) {
          await storage.updateFamilyMember(org.id, member.id, {
            portalAccess: true,
            portalUsername: creds.username,
            portalPassword: creds.password,
          });
          console.log(`Portal credentials updated for family member ${member.id}.`);
        }
      }
    }
  }
}







