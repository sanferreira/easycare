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
import {
  DEFAULT_ENVIRONMENT_SETTINGS,
  getShiftProfileRule,
  normalizeShiftProfileKey,
  normalizeEnvironmentSettings,
  routeActionIsAllowed,
  type EnvironmentSettings,
  type ModulePermissionAction,
  type ModuleRoute,
  type ShiftAssignmentType,
} from "@shared/environment";

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
      pruneSessionInterval: 60 * 15,
    }),
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  }));

  const createLoginRateLimiter = () =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { message: "Muitas tentativas de login. Tente novamente em alguns minutos." },
    });

  const authLoginRateLimiter = createLoginRateLimiter();
  const familyLoginRateLimiter = createLoginRateLimiter();

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

  const ORG_STATUS_VALUES = ["active", "inactive", "restricted"] as const;
  type OrgStatus = typeof ORG_STATUS_VALUES[number];

  const normalizeOrgStatus = (org?: { status?: unknown; active?: unknown }): OrgStatus => {
    const raw = typeof org?.status === "string" ? org.status.trim().toLowerCase() : "";
    if (raw === "active" || raw === "inactive" || raw === "restricted") {
      return raw;
    }
    return org?.active === false ? "inactive" : "active";
  };
  const parseOrgStatusInput = (value: unknown): OrgStatus | null => {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return ORG_STATUS_VALUES.includes(normalized as OrgStatus)
      ? normalized as OrgStatus
      : null;
  };
  const ENV_SETTINGS_API_PATH = "/api/environment-settings";
  const API_MODULE_ROUTE_RULES: Array<{ pattern: RegExp; route: ModuleRoute }> = [
    { pattern: /^\/api\/environment-settings(?:\/|$)/, route: "/environment" },
    { pattern: /^\/api\/stats(?:\/|$)/, route: "/" },
    { pattern: /^\/api\/residents\/[^/]+\/family(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medical-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/comorbidities(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medical-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/comorbidities(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medication-dose-schedule(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents\/[^/]+\/medication-dose-records(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medication-administrations(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/medications(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/staff(?:\/|$)/, route: "/staff" },
    { pattern: /^\/api\/shift-assignments(?:\/|$)/, route: "/escalas" },
    { pattern: /^\/api\/contracts(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/monthly-fees(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/accounts-payable(?:\/|$)/, route: "/financeiro" },
    { pattern: /^\/api\/crm(?:\/|$)/, route: "/crm" },
    { pattern: /^\/api\/occurrences(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/family(?:\/|$)/, route: "/prontuario" },
    { pattern: /^\/api\/residents(?:\/|$)/, route: "/residents" },
  ];
  const resolveModuleRouteFromApiPath = (path: string): ModuleRoute | null => {
    const match = API_MODULE_ROUTE_RULES.find((rule) => rule.pattern.test(path));
    return match?.route ?? null;
  };
  const resolveModulePermissionActionFromMethod = (method: string): ModulePermissionAction => {
    const normalizedMethod = method.trim().toUpperCase();
    if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") {
      return "view";
    }
    return "edit";
  };
  const parseEnvironmentSettingsFromOrganization = (
    organization?: { environmentSettings?: unknown } | null,
  ): EnvironmentSettings => {
    if (!organization || typeof organization.environmentSettings !== "string") {
      return DEFAULT_ENVIRONMENT_SETTINGS;
    }
    const rawSettings = organization.environmentSettings.trim();
    if (!rawSettings) return DEFAULT_ENVIRONMENT_SETTINGS;
    try {
      return normalizeEnvironmentSettings(JSON.parse(rawSettings));
    } catch {
      return DEFAULT_ENVIRONMENT_SETTINGS;
    }
  };
  const getOrganizationEnvironmentSettings = async (orgId: number) => {
    const organization = await storage.getOrganization(orgId);
    if (!organization) return null;
    return {
      organization,
      settings: parseEnvironmentSettingsFromOrganization(organization),
    };
  };
  const getAllowedRolesForSettings = (settings: EnvironmentSettings): string[] =>
    Object.keys(settings.roleRoutes);
  const getDefaultRoleForSettings = (settings: EnvironmentSettings): string => {
    const allowedRoles = getAllowedRolesForSettings(settings);
    if (allowedRoles.includes("staff")) return "staff";
    return allowedRoles[0] ?? "staff";
  };
  const normalizeStaffShiftProfile = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return normalizeShiftProfileKey(value);
  };
  const normalizeStaffRoleValue = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  };
  const assertShiftProfileAllowedForSettings = (
    settings: EnvironmentSettings,
    shiftProfile: string,
  ) => {
    if (!shiftProfile || !settings.shiftProfiles.available.includes(shiftProfile)) {
      throw new Error("Perfil de jornada invalido para esta organizacao.");
    }
  };
  const getBlockedOrganizationMessage = (status: OrgStatus): string =>
    status === "restricted"
      ? "Acesso da organização restrito. Entre em contato com o suporte."
      : "Organização inativa. Acesso bloqueado.";
  const destroySession = (req: Request) =>
    new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });

  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Não autorizado" });
    if (user.isSuperAdmin || !user.organizationId) return next();

    try {
      const organization = await storage.getOrganization(user.organizationId);
      if (!organization) {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: "Organização não encontrada. Acesso bloqueado." });
      }

      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus !== "active") {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      const environmentSettings = parseEnvironmentSettingsFromOrganization(organization);
      res.locals.environmentSettings = environmentSettings;
      const moduleRoute = resolveModuleRouteFromApiPath(req.path);
      const permissionAction = resolveModulePermissionActionFromMethod(req.method);
      const allowEnvironmentSettingsRead =
        req.path.startsWith(ENV_SETTINGS_API_PATH) && permissionAction === "view";
      if (
        !allowEnvironmentSettingsRead
        && moduleRoute
        && !routeActionIsAllowed(
          user.role,
          moduleRoute,
          permissionAction,
          environmentSettings.roleRoutes,
          environmentSettings.roleEditRoutes,
        )
      ) {
        const deniedMessage = permissionAction === "edit"
          ? "Acesso negado para edicao neste modulo."
          : "Acesso negado para visualizacao neste modulo.";
        return res.status(403).json({ message: deniedMessage });
      }

      next();
    } catch (error) {
      next(error);
    }
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

    const moduleRoute = resolveModuleRouteFromApiPath(req.path);
    const environmentSettings = res.locals.environmentSettings as EnvironmentSettings | undefined;
    const permissionAction = resolveModulePermissionActionFromMethod(req.method);
    if (moduleRoute && environmentSettings) {
      const allowedByModulePermission = routeActionIsAllowed(
        user.role,
        moduleRoute,
        permissionAction,
        environmentSettings.roleRoutes,
        environmentSettings.roleEditRoutes,
      );
      if (!allowedByModulePermission) {
        const actionLabel = permissionAction === "edit" ? "edicao" : "visualizacao";
        return res.status(403).json({
          message: `Acesso negado. Papel '${user.role}' nao tem permissao de ${actionLabel} para esta acao.`,
        });
      }
    }

    if (roles.includes(user.role)) return next();

    if (moduleRoute && environmentSettings) {
      return next();
    }

    const actionLabel = permissionAction === "edit" ? "edicao" : "visualizacao";
    return res.status(403).json({ message: `Acesso negado. Papel '${user.role}' nao tem permissao de ${actionLabel} para esta acao.` });
  };

  // Papéis com acesso clínico
  const CLINICAL_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem", "fisioterapeuta", "nutricionista"];
  // Papéis com acesso financeiro
  const FINANCIAL_ROLES = ["admin", "recepcionista", "administrativo"];
  // Papéis com acesso ao módulo de equipe
  const STAFF_MGMT_ROLES = ["admin"];
  // Papéis com acesso a medicações
  const MEDICATION_ROLES = ["admin", "enfermeiro", "medico", "tecnico_enfermagem"];
  // Papéis com acesso ao CRM
  const CRM_ROLES = ["admin"];

  const getOrgId = (req: Request): number => {
    const orgId = req.session.user?.organizationId;
    if (!orgId) throw new Error("Organization não encontrada na sessão");
    return orgId;
  };

  const resolveOrgIdForCrm = async (
    req: Request,
    organizationIdCandidate?: unknown,
  ): Promise<number> => {
    const sessionUser = req.session.user;
    if (!sessionUser) throw new Error("Nao autorizado.");

    if (!sessionUser.isSuperAdmin) {
      return getOrgId(req);
    }

    const parsedOrgId = Number(organizationIdCandidate);
    if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) {
      const error = new Error("Superadmin deve informar organizationId valido.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const organization = await storage.getOrganization(parsedOrgId);
    if (!organization) {
      const error = new Error("Organizacao nao encontrada.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return parsedOrgId;
  };

  const normalizeComparableText = (value: string | null | undefined) =>
    (value ?? "")
      .trim()
      .toLocaleLowerCase("pt-BR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const resolveLinkedStaffForSessionUser = async (
    orgId: number,
    user: SessionUser | undefined,
  ) => {
    if (!user) return null;
    const normalizedUserName = normalizeComparableText(user.name);
    if (!normalizedUserName) return null;

    const staffMembers = await storage.getStaff(orgId);
    const exactNameMatches = staffMembers.filter(
      (member) => normalizeComparableText(member.name) === normalizedUserName,
    );

    if (exactNameMatches.length === 1) return exactNameMatches[0];
    if (exactNameMatches.length > 1) {
      const normalizedUserRole = normalizeComparableText(user.role);
      const roleMatch = exactNameMatches.find(
        (member) => normalizeComparableText(member.role) === normalizedUserRole,
      );
      return roleMatch ?? exactNameMatches[0];
    }

    const looseMatch = staffMembers.find((member) => {
      const normalizedStaffName = normalizeComparableText(member.name);
      return (
        normalizedStaffName.includes(normalizedUserName)
        || normalizedUserName.includes(normalizedStaffName)
      );
    });

    return looseMatch ?? null;
  };

  const enforceCaregiverOwnStaffId = async (
    orgId: number,
    user: SessionUser | undefined,
    requestedStaffId?: number | null,
  ) => {
    if (!user || user.role !== "cuidador") {
      return requestedStaffId ?? null;
    }

    const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, user);
    if (!linkedStaff) {
      throw new Error("Seu usuario de cuidador nao esta vinculado a um colaborador da equipe.");
    }

    if (requestedStaffId && requestedStaffId !== linkedStaff.id) {
      throw new Error("Cuidador so pode selecionar a si mesmo.");
    }

    return linkedStaff.id;
  };

  // ===== AUTH =====
  app.post("/api/auth/login", authLoginRateLimiter, async (req, res) => {
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
      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus !== "active") {
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      const user = await storage.getUserByUsernameAndOrganization(normalizedUsername, organization.id);
      if (!user) return res.status(401).json({ message: "Usuário ou senha incorretos" });
      if (user.active === false) {
        return res.status(403).json({ message: "Usuário inativo. Entre em contato com o administrador." });
      }

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
  const requireFamilyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const familyMember = req.session.familyMember;
    if (!familyMember) return res.status(401).json({ message: "Não autorizado" });

    try {
      const organization = await storage.getOrganization(familyMember.organizationId);
      if (!organization) {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: "Organização não encontrada. Acesso bloqueado." });
      }

      const organizationStatus = normalizeOrgStatus(organization);
      if (organizationStatus !== "active") {
        await destroySession(req);
        res.clearCookie("easycare.sid");
        return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
      }

      next();
    } catch (error) {
      next(error);
    }
  };

  app.post("/api/family-portal/login", familyLoginRateLimiter, async (req, res) => {
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
    const organizationStatus = normalizeOrgStatus(organization);
    if (organizationStatus !== "active") {
      return res.status(403).json({ message: getBlockedOrganizationMessage(organizationStatus) });
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
  app.get("/api/organizations", requireAuth, requireSuperAdmin, async (req, res) => {
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    res.json(await storage.getOrganizations(includeInactive));
  });
  app.get("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const organization = await storage.getOrganization(Number(req.params.id));
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada" });
    }
    res.json(organization);
  });
  app.post("/api/organizations", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, address, phone, email, cnpj, capacity, status } = req.body;
      if (!name || !cnpj || typeof cnpj !== "string" || !cnpj.trim()) {
        return res.status(400).json({ message: "Nome e CNPJ são obrigatórios" });
      }
      const parsedStatus = status === undefined ? "active" : parseOrgStatusInput(status);
      if (!parsedStatus) {
        return res.status(400).json({ message: "Status inválido. Use: active, inactive ou restricted." });
      }
      res.status(201).json(await storage.createOrganization({
        name,
        address,
        phone,
        email,
        cnpj: cnpj.trim(),
        capacity,
        status: parsedStatus,
        active: parsedStatus === "active",
      }));
    } catch { res.status(500).json({ message: "Erro ao criar organização" }); }
  });
  app.put("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    const payload = { ...req.body };
    if (typeof payload.cnpj === "string") payload.cnpj = payload.cnpj.trim();
    const parsedStatus = parseOrgStatusInput(payload.status);
    if (payload.status !== undefined && !parsedStatus) {
      return res.status(400).json({ message: "Status inválido. Use: active, inactive ou restricted." });
    }
    if (parsedStatus) {
      payload.status = parsedStatus;
      payload.active = parsedStatus === "active";
    } else if (typeof payload.active === "boolean") {
      payload.status = payload.active ? "active" : "inactive";
    }
    res.json(await storage.updateOrganization(Number(req.params.id), payload));
  });
  app.delete("/api/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    await storage.deleteOrganization(Number(req.params.id));
    res.status(204).send();
  });

  app.get(ENV_SETTINGS_API_PATH, requireAuth, async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) return res.status(401).json({ message: "Não autorizado" });
    if (sessionUser.isSuperAdmin || !sessionUser.organizationId) {
      return res.json(DEFAULT_ENVIRONMENT_SETTINGS);
    }

    const organization = await storage.getOrganization(sessionUser.organizationId);
    if (!organization) {
      return res.status(404).json({ message: "Organização não encontrada" });
    }

    res.json(parseEnvironmentSettingsFromOrganization(organization));
  });

  app.put(ENV_SETTINGS_API_PATH, requireAuth, requireRole("admin"), async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser?.organizationId) {
      return res.status(400).json({ message: "Usuário sem organização associada." });
    }

    const settings = normalizeEnvironmentSettings(req.body);
    await storage.updateOrganization(sessionUser.organizationId, {
      environmentSettings: JSON.stringify(settings),
    });
    res.json(settings);
  });

  // ===== ORG USERS =====
  app.get("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    const users = await storage.getUsersByOrganization(Number(req.params.id));
    res.json(users.map(sanitizeUser));
  });
  app.post("/api/organizations/:id/users", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const orgId = Number(req.params.id);
      const settingsResult = await getOrganizationEnvironmentSettings(orgId);
      if (!settingsResult) {
        return res.status(404).json({ message: "Organização não encontrada" });
      }

      const { username, password, name, role } = req.body;
      if (!username || !password || !name) return res.status(400).json({ message: "Campos obrigatórios faltando" });
      const allowedRoles = getAllowedRolesForSettings(settingsResult.settings);
      const roleValue = typeof role === "string" && role.trim()
        ? role.trim()
        : getDefaultRoleForSettings(settingsResult.settings);
      if (!allowedRoles.includes(roleValue)) {
        return res.status(400).json({ message: "Papel inválido para esta organização." });
      }

      const user = await storage.createUser({
        organizationId: orgId,
        username,
        password,
        name,
        role: roleValue,
        isSuperAdmin: false,
      });
      res.status(201).json(sanitizeUser(user));
    } catch (err: any) {
      if (err.code === "23505") return res.status(400).json({ message: "Nome de usuário já existe nesta organização" });
      res.status(500).json({ message: "Erro ao criar usuário" });
    }
  });
  app.patch("/api/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { name, username, password, role } = req.body;
      const userId = Number(req.params.id);
      const currentUser = await storage.getUserById(userId);
      if (!currentUser) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }
      if (!currentUser.organizationId) {
        return res.status(400).json({ message: "Usuário sem organização associada." });
      }

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (username !== undefined) updates.username = username;
      if (role !== undefined) {
        if (typeof role !== "string" || !role.trim()) {
          return res.status(400).json({ message: "Papel inválido." });
        }
        const settingsResult = await getOrganizationEnvironmentSettings(currentUser.organizationId);
        if (!settingsResult) {
          return res.status(404).json({ message: "Organização não encontrada" });
        }
        const allowedRoles = getAllowedRolesForSettings(settingsResult.settings);
        const roleValue = role.trim();
        if (!allowedRoles.includes(roleValue)) {
          return res.status(400).json({ message: "Papel inválido para esta organização." });
        }
        updates.role = roleValue;
      }
      if (password && password.trim() !== "") updates.password = password;
      const updated = await storage.updateUser(userId, updates);
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
    try {
      const orgId = getOrgId(req);
      const payload = buildMedicationPayload(req.body);
      res.status(201).json(await storage.createMedication({ ...payload, organizationId: orgId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dados de medicacao invalidos.";
      res.status(400).json({ message });
    }
  });
  app.put("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const payload = buildMedicationPayload(req.body);
      res.json(await storage.updateMedication(orgId, Number(req.params.id), payload));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dados de medicacao invalidos.";
      res.status(400).json({ message });
    }
  });
  app.delete("/api/medications/:id", requireAuth, requireRole(...MEDICATION_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteMedication(orgId, Number(req.params.id));
    res.status(204).send();
  });

  const MEDICATION_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const MEDICATION_TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const HOUR_IN_MS = 60 * 60 * 1000;
  const MINUTE_IN_MS = 60 * 1000;

  const toDateOnly = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseDateOnly = (value: string, endOfDay = false): Date | null => {
    if (!MEDICATION_DATE_REGEX.test(value)) return null;
    const [yearStr, monthStr, dayStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    if (endOfDay) return new Date(year, month, day, 23, 59, 59, 999);
    return new Date(year, month, day, 0, 0, 0, 0);
  };

  type ParsedMedicationTime = { hour: number; minute: number; label: string };
  const parseMedicationScheduleTimes = (scheduleTime: string | null | undefined): ParsedMedicationTime[] => {
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

    if (parsedTimes.length > 0) {
      const dedupMap = new Map<string, ParsedMedicationTime>();
      parsedTimes.forEach((item) => dedupMap.set(item.label, item));
      return Array.from(dedupMap.values()).sort((a, b) => {
        const left = a.hour * 60 + a.minute;
        const right = b.hour * 60 + b.minute;
        return left - right;
      });
    }
    return [];
  };

  const normalizeMedicationScheduleTime = (scheduleTime: unknown): string | null => {
    const raw = typeof scheduleTime === "string" ? scheduleTime : "";
    const parsed = parseMedicationScheduleTimes(raw);
    if (parsed.length === 0) return null;
    return parsed.map((item) => item.label).join(", ");
  };

  const parseMedicationIntervalHours = (frequency: string | null | undefined): number | null => {
    const normalizedFrequency = (frequency ?? "").trim().toLowerCase();
    if (!normalizedFrequency) return null;
    if (normalizedFrequency.includes("sob demanda")) return null;
    if (normalizedFrequency.includes("semanal")) return 24 * 7;

    // Legacy support: "12h/12h", "8h/8h" and variants.
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
  };

  const isOnDemandFrequency = (frequency: string | null | undefined): boolean => {
    const normalizedFrequency = (frequency ?? "").trim().toLowerCase();
    return normalizedFrequency.includes("sob demanda");
  };

  const buildMedicationPayload = (body: any) => {
    const residentId = Number(body?.residentId);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      throw new Error("Residente invalido.");
    }

    const name = String(body?.name ?? "").trim();
    if (name.length < 2) throw new Error("Medicamento obrigatorio.");

    const dosage = String(body?.dosage ?? "").trim();
    if (dosage.length === 0) throw new Error("Dose obrigatoria.");

    const frequency = String(body?.frequency ?? "").trim();
    if (frequency.length === 0) throw new Error("Frequencia obrigatoria.");

    const normalizedScheduleTime = normalizeMedicationScheduleTime(body?.scheduleTime);
    const intervalHours = parseMedicationIntervalHours(frequency);
    const scheduleTime =
      normalizedScheduleTime ??
      (intervalHours !== null && !isOnDemandFrequency(frequency) ? "08:00" : null);

    const startDateRaw = typeof body?.startDate === "string" ? body.startDate.trim() : "";
    const endDateRaw = typeof body?.endDate === "string" ? body.endDate.trim() : "";

    const startDate = startDateRaw.length > 0 ? startDateRaw : null;
    const endDate = endDateRaw.length > 0 ? endDateRaw : null;

    if (startDate && !MEDICATION_DATE_REGEX.test(startDate)) {
      throw new Error("Data de inicio invalida. Use yyyy-mm-dd.");
    }
    if (endDate && !MEDICATION_DATE_REGEX.test(endDate)) {
      throw new Error("Data de fim invalida. Use yyyy-mm-dd.");
    }

    if (startDate && endDate) {
      const start = parseDateOnly(startDate);
      const end = parseDateOnly(endDate, true);
      if (!start || !end || end.getTime() < start.getTime()) {
        throw new Error("Data de fim deve ser maior ou igual a data de inicio.");
      }
    }

    return {
      residentId,
      name,
      dosage,
      frequency,
      status: body?.status === "suspended" ? "suspended" : "active",
      route: typeof body?.route === "string" && body.route.trim().length > 0 ? body.route.trim() : null,
      scheduleTime,
      prescribedBy:
        typeof body?.prescribedBy === "string" && body.prescribedBy.trim().length > 0
          ? body.prescribedBy.trim()
          : null,
      notes: typeof body?.notes === "string" && body.notes.trim().length > 0 ? body.notes.trim() : null,
      startDate,
      endDate,
    };
  };

  const buildMedicationDoseKey = (medicationId: number, scheduledFor: Date): string => {
    const minuteBucket = Math.round(scheduledFor.getTime() / MINUTE_IN_MS);
    return `${medicationId}:${minuteBucket}`;
  };

  app.get("/api/residents/:residentId/medication-dose-schedule", requireAuth, async (req, res, next) => {
    try {
      const residentId = Number(req.params.residentId);
      if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({ message: "Residente invalido." });
      }

      const orgId = getOrgId(req);
      const resident = await storage.getResident(orgId, residentId);
      if (!resident) {
        return res.status(404).json({ message: "Residente nao encontrado." });
      }

      const fromParam = typeof req.query.from === "string" ? req.query.from.trim() : "";
      const toParam = typeof req.query.to === "string" ? req.query.to.trim() : "";
      if (fromParam && !MEDICATION_DATE_REGEX.test(fromParam)) {
        return res.status(400).json({ message: "Parametro 'from' invalido. Use yyyy-mm-dd." });
      }
      if (toParam && !MEDICATION_DATE_REGEX.test(toParam)) {
        return res.status(400).json({ message: "Parametro 'to' invalido. Use yyyy-mm-dd." });
      }

      const today = new Date();
      const defaultFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      const defaultTo = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6, 23, 59, 59, 999);
      const fromDate = fromParam ? parseDateOnly(fromParam) : defaultFrom;
      const toDate = toParam ? parseDateOnly(toParam, true) : defaultTo;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "Periodo invalido." });
      }
      if (toDate.getTime() < fromDate.getTime()) {
        return res.status(400).json({ message: "Data final deve ser maior ou igual a data inicial." });
      }

      const includeSuspended = String(req.query.includeSuspended ?? "").toLowerCase() === "true";
      const allMedications = await storage.getMedications(orgId, residentId);
      const medicationsForAgenda = allMedications.filter(
        (item) => includeSuspended || item.status === "active",
      );
      const administrations = await storage.getMedicationAdministrations(orgId, residentId);

      const administrationByDoseKey = new Map<string, (typeof administrations)[number]>();
      administrations.forEach((admin) => {
        if (!admin.scheduledFor) return;
        const scheduledForDate = new Date(admin.scheduledFor);
        if (Number.isNaN(scheduledForDate.getTime())) return;
        const key = buildMedicationDoseKey(admin.medicationId, scheduledForDate);
        const current = administrationByDoseKey.get(key);
        const currentAdminAt = current?.administeredAt
          ? new Date(current.administeredAt).getTime()
          : 0;
        const nextAdminAt = admin.administeredAt
          ? new Date(admin.administeredAt).getTime()
          : 0;
        if (!current || nextAdminAt >= currentAdminAt) {
          administrationByDoseKey.set(key, admin);
        }
      });

      const doses: Array<{
        key: string;
        medicationId: number;
        medicationName: string;
        dosage: string;
        frequency: string;
        route: string | null;
        scheduledFor: string;
        scheduledDate: string;
        scheduledTime: string;
        status: "pending" | "given" | "skipped" | "refused" | "late";
        isOverdue: boolean;
        notes: string | null;
        administeredAt: string | null;
        administeredByName: string | null;
        administeredByStaffId: number | null;
      }> = [];

      const nowTimestamp = Date.now();
      for (const medication of medicationsForAgenda) {
        if (isOnDemandFrequency(medication.frequency)) continue;

        const medicationStart = medication.startDate
          ? parseDateOnly(String(medication.startDate))
          : null;
        const medicationEnd = medication.endDate
          ? parseDateOnly(String(medication.endDate), true)
          : null;

        const effectiveStart = new Date(Math.max(
          fromDate.getTime(),
          medicationStart ? medicationStart.getTime() : fromDate.getTime(),
        ));
        const effectiveEnd = new Date(Math.min(
          toDate.getTime(),
          medicationEnd ? medicationEnd.getTime() : toDate.getTime(),
        ));
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
            const stepsToAdvance = Math.ceil(diffInMs / stepInMs);
            occurrenceCursor = new Date(occurrenceCursor.getTime() + stepsToAdvance * stepInMs);
          }

          while (occurrenceCursor.getTime() <= effectiveEnd.getTime()) {
            const doseKey = buildMedicationDoseKey(medication.id, occurrenceCursor);
            const administration = administrationByDoseKey.get(doseKey);
            const baseStatus = administration?.status;
            const normalizedStatus =
              baseStatus === "given" || baseStatus === "skipped" || baseStatus === "refused" || baseStatus === "late"
                ? baseStatus
                : "pending";

            const timeLabel = `${String(occurrenceCursor.getHours()).padStart(2, "0")}:${String(
              occurrenceCursor.getMinutes(),
            ).padStart(2, "0")}`;

            doses.push({
              key: doseKey,
              medicationId: medication.id,
              medicationName: medication.name,
              dosage: medication.dosage,
              frequency: medication.frequency,
              route: medication.route ?? null,
              scheduledFor: occurrenceCursor.toISOString(),
              scheduledDate: toDateOnly(occurrenceCursor),
              scheduledTime: timeLabel,
              status: normalizedStatus,
              isOverdue: normalizedStatus === "pending" && occurrenceCursor.getTime() < nowTimestamp,
              notes: administration?.notes ?? null,
              administeredAt: administration?.administeredAt
                ? new Date(administration.administeredAt).toISOString()
                : null,
              administeredByName: administration?.administeredByName ?? null,
              administeredByStaffId: administration?.staffId ?? null,
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
            const scheduledForDate = new Date(
              dayCursor.getFullYear(),
              dayCursor.getMonth(),
              dayCursor.getDate(),
              scheduledTime.hour,
              scheduledTime.minute,
              0,
              0,
            );
            if (scheduledForDate.getTime() < effectiveStart.getTime()) continue;
            if (scheduledForDate.getTime() > effectiveEnd.getTime()) continue;

            const doseKey = buildMedicationDoseKey(medication.id, scheduledForDate);
            const administration = administrationByDoseKey.get(doseKey);
            const baseStatus = administration?.status;
            const normalizedStatus =
              baseStatus === "given" || baseStatus === "skipped" || baseStatus === "refused" || baseStatus === "late"
                ? baseStatus
                : "pending";

            doses.push({
              key: doseKey,
              medicationId: medication.id,
              medicationName: medication.name,
              dosage: medication.dosage,
              frequency: medication.frequency,
              route: medication.route ?? null,
              scheduledFor: scheduledForDate.toISOString(),
              scheduledDate: toDateOnly(scheduledForDate),
              scheduledTime: scheduledTime.label,
              status: normalizedStatus,
              isOverdue: normalizedStatus === "pending" && scheduledForDate.getTime() < nowTimestamp,
              notes: administration?.notes ?? null,
              administeredAt: administration?.administeredAt
                ? new Date(administration.administeredAt).toISOString()
                : null,
              administeredByName: administration?.administeredByName ?? null,
              administeredByStaffId: administration?.staffId ?? null,
            });
          }

          dayCursor.setDate(dayCursor.getDate() + 1);
        }
      }

      doses.sort((left, right) => {
        const scheduledDiff =
          new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime();
        if (scheduledDiff !== 0) return scheduledDiff;
        return left.medicationName.localeCompare(right.medicationName, "pt-BR");
      });

      return res.json({
        residentId,
        from: toDateOnly(fromDate),
        to: toDateOnly(toDate),
        generatedAt: new Date().toISOString(),
        doses,
      });
    } catch (error) {
      next(error);
    }
  });

  // ===== MEDICATION ADMINISTRATIONS =====
  const medicationAdministrationInputSchema = z.object({
    medicationId: z.coerce.number().int().positive("Medicamento invalido."),
    staffId: z.coerce.number().int().positive().optional().nullable(),
    status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
    notes: z.string().optional().nullable(),
    scheduledFor: z.coerce.date().optional().nullable(),
    administeredAt: z.coerce.date().optional().nullable(),
  });
  const medicationDoseRecordInputSchema = z.object({
    medicationId: z.coerce.number().int().positive("Medicamento invalido."),
    scheduledFor: z.coerce.date(),
    staffId: z.coerce.number().int().positive().optional().nullable(),
    status: z.enum(["given", "skipped", "refused", "late"]).default("given"),
    notes: z.string().optional().nullable(),
    administeredAt: z.coerce.date().optional().nullable(),
  });

  app.get("/api/medication-administrations", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      res.json(await storage.getMedicationAdministrations(
        orgId,
        req.query.residentId ? Number(req.query.residentId) : undefined,
        req.query.medicationId ? Number(req.query.medicationId) : undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/medication-administrations", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const sessionUser = req.session.user;
      if (!sessionUser) {
        return res.status(401).json({ message: "Nao autorizado." });
      }

      const input = medicationAdministrationInputSchema.parse(req.body);
      const meds = await storage.getMedications(orgId);
      const medication = meds.find((item) => item.id === input.medicationId);
      if (!medication) {
        return res.status(404).json({ message: "Medicamento nao encontrado." });
      }

      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      let effectiveStaffId = await enforceCaregiverOwnStaffId(orgId, sessionUser, input.staffId);

      if (sessionUser.role !== "cuidador") {
        if (effectiveStaffId) {
          const selectedStaff = await storage.getStaffMember(orgId, effectiveStaffId);
          if (!selectedStaff || selectedStaff.active === false) {
            return res.status(400).json({ message: "Profissional selecionado nao esta disponivel." });
          }
        } else if (linkedStaff && linkedStaff.active !== false) {
          effectiveStaffId = linkedStaff.id;
        }
      }

      if (!effectiveStaffId) {
        return res.status(400).json({ message: "Selecione quem administrou a medicacao." });
      }

      const created = await storage.createMedicationAdministration({
        organizationId: orgId,
        medicationId: medication.id,
        residentId: medication.residentId,
        staffId: effectiveStaffId,
        scheduledFor: input.scheduledFor ?? null,
        administeredAt: input.administeredAt ?? new Date(),
        status: input.status,
        notes: input.notes?.trim() || null,
      });

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados invalidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.post("/api/residents/:residentId/medication-dose-records", requireAuth, async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const residentId = Number(req.params.residentId);
      if (!Number.isInteger(residentId) || residentId <= 0) {
        return res.status(400).json({ message: "Residente invalido." });
      }

      const sessionUser = req.session.user;
      if (!sessionUser) {
        return res.status(401).json({ message: "Nao autorizado." });
      }

      const input = medicationDoseRecordInputSchema.parse(req.body);
      const medications = await storage.getMedications(orgId, residentId);
      const medication = medications.find((item) => item.id === input.medicationId);
      if (!medication) {
        return res.status(404).json({ message: "Medicamento nao encontrado para este residente." });
      }

      const linkedStaff = await resolveLinkedStaffForSessionUser(orgId, sessionUser);
      let effectiveStaffId = await enforceCaregiverOwnStaffId(orgId, sessionUser, input.staffId);

      if (sessionUser.role !== "cuidador") {
        if (effectiveStaffId) {
          const selectedStaff = await storage.getStaffMember(orgId, effectiveStaffId);
          if (!selectedStaff || selectedStaff.active === false) {
            return res.status(400).json({ message: "Profissional selecionado nao esta disponivel." });
          }
        } else if (linkedStaff && linkedStaff.active !== false) {
          effectiveStaffId = linkedStaff.id;
        }
      }
      if (!effectiveStaffId) {
        return res.status(400).json({ message: "Selecione quem administrou a medicacao." });
      }

      const saved = await storage.upsertMedicationAdministrationForDose({
        organizationId: orgId,
        medicationId: medication.id,
        residentId,
        staffId: effectiveStaffId,
        scheduledFor: input.scheduledFor,
        administeredAt: input.administeredAt ?? new Date(),
        status: input.status,
        notes: input.notes?.trim() || null,
      });

      return res.status(200).json(saved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados invalidos." });
      }
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });

  // ===== STAFF =====
  const resolveLinkedPortalUserForStaff = async (
    orgId: number,
    currentStaff?: { portalUserId?: number | null; portalUsername?: string | null },
  ) => {
    if (currentStaff?.portalUserId) {
      const linkedById = await storage.getUserById(currentStaff.portalUserId);
      if (linkedById && linkedById.organizationId === orgId) {
        return linkedById;
      }
    }
    const normalizedPortalUsername = normalizePortalUsername(currentStaff?.portalUsername ?? "");
    if (!normalizedPortalUsername) return undefined;
    return await storage.getUserByUsernameAndOrganization(normalizedPortalUsername, orgId);
  };

  const syncPortalUserForStaff = async (input: {
    orgId: number;
    currentStaff?: { portalUserId?: number | null; portalUsername?: string | null };
    portalAccess: boolean;
    portalUsername: string;
    portalPassword: string;
    staffName: string;
    staffRole: string;
    staffActive: boolean;
  }) => {
    const linkedUser = await resolveLinkedPortalUserForStaff(input.orgId, input.currentStaff);

    if (!input.portalAccess) {
      if (linkedUser && linkedUser.active !== false) {
        await storage.updateUser(linkedUser.id, { active: false });
      }
      return {
        portalAccess: false,
        portalUsername: null,
        portalUserId: null,
      };
    }

    if (!input.portalUsername || input.portalUsername.length < 3) {
      throw new Error("Informe um usuario de acesso com pelo menos 3 caracteres.");
    }

    const usernameOwner = await storage.getUserByUsernameAndOrganization(input.portalUsername, input.orgId);
    if (usernameOwner && (!linkedUser || usernameOwner.id !== linkedUser.id)) {
      throw new Error("Usuario de acesso ja existe na organizacao.");
    }

    if (linkedUser) {
      const userUpdates: Record<string, unknown> = {
        username: input.portalUsername,
        name: input.staffName,
        role: input.staffRole,
        active: input.staffActive,
      };
      if (input.portalPassword) {
        userUpdates.password = input.portalPassword;
      }
      await storage.updateUser(linkedUser.id, userUpdates);
      return {
        portalAccess: true,
        portalUsername: input.portalUsername,
        portalUserId: linkedUser.id,
      };
    }

    if (!input.portalPassword) {
      throw new Error("Informe a senha para criar o acesso ao portal.");
    }

    const createdUser = await storage.createUser({
      organizationId: input.orgId,
      username: input.portalUsername,
      password: input.portalPassword,
      name: input.staffName,
      role: input.staffRole,
      active: input.staffActive,
      isSuperAdmin: false,
    });

    return {
      portalAccess: true,
      portalUsername: input.portalUsername,
      portalUserId: createdUser.id,
    };
  };

  // Leitura: admin + enfermeiro (para ver a equipe nas escalas)
  app.get("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES, "enfermeiro", "tecnico_enfermagem", "medico", "recepcionista", "administrativo", "cuidador"), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      res.json(await storage.getStaff(orgId));
    } catch (error) {
      next(error);
    }
  });
  // Escrita: somente admin
  app.post("/api/staff", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const payload = { ...req.body } as Record<string, unknown>;
      const environmentSettings =
        (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const shiftProfile = normalizeStaffShiftProfile(payload.shift);
      assertShiftProfileAllowedForSettings(environmentSettings, shiftProfile);
      payload.shift = shiftProfile;
      const roleValue = normalizeStaffRoleValue(payload.role);
      if (!roleValue) {
        return res.status(400).json({ message: "Cargo invalido para o colaborador." });
      }
      if (!getAllowedRolesForSettings(environmentSettings).includes(roleValue)) {
        return res.status(400).json({ message: "Cargo invalido para esta organizacao." });
      }
      payload.role = roleValue;

      const staffName = typeof payload.name === "string" ? payload.name.trim() : "";
      if (!staffName) {
        return res.status(400).json({ message: "Nome do colaborador obrigatorio." });
      }
      payload.name = staffName;

      const portalAccess = payload.portalAccess === true;
      const portalUsername = typeof payload.portalUsername === "string"
        ? normalizePortalUsername(payload.portalUsername)
        : "";
      const portalPassword = typeof payload.portalPassword === "string"
        ? payload.portalPassword.trim()
        : "";
      delete payload.portalPassword;

      let createdStaff = await storage.createStaff({
        ...payload,
        organizationId: orgId,
        portalAccess,
        portalUsername: portalAccess ? portalUsername : null,
        portalUserId: null,
      } as any);

      try {
        const portalLink = await syncPortalUserForStaff({
          orgId,
          currentStaff: createdStaff,
          portalAccess,
          portalUsername,
          portalPassword,
          staffName: staffName,
          staffRole: roleValue,
          staffActive: createdStaff.active !== false,
        });

        createdStaff = await storage.updateStaff(orgId, createdStaff.id, portalLink);
      } catch (error) {
        await storage.deleteStaff(orgId, createdStaff.id);
        throw error;
      }

      res.status(201).json(createdStaff);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.put("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const payload = { ...req.body } as Record<string, unknown>;
      const currentStaff = await storage.getStaffMember(orgId, Number(req.params.id));
      if (!currentStaff) {
        return res.status(404).json({ message: "Colaborador nao encontrado." });
      }
      const environmentSettings =
        (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      if (payload.shift !== undefined) {
        const shiftProfile = normalizeStaffShiftProfile(payload.shift);
        assertShiftProfileAllowedForSettings(environmentSettings, shiftProfile);
        payload.shift = shiftProfile;
      }

      const requestedRole = normalizeStaffRoleValue(payload.role);
      const nextRole = requestedRole || normalizeStaffRoleValue(currentStaff.role);
      if (!getAllowedRolesForSettings(environmentSettings).includes(nextRole)) {
        return res.status(400).json({ message: "Cargo invalido para esta organizacao." });
      }
      payload.role = nextRole;

      const nextName = typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : currentStaff.name;
      payload.name = nextName;

      const portalAccess = payload.portalAccess !== undefined
        ? payload.portalAccess === true
        : Boolean(currentStaff.portalAccess);
      const portalUsernameSource = payload.portalUsername !== undefined
        ? payload.portalUsername
        : currentStaff.portalUsername;
      const portalUsername = typeof portalUsernameSource === "string"
        ? normalizePortalUsername(portalUsernameSource)
        : "";
      const portalPassword = typeof payload.portalPassword === "string"
        ? payload.portalPassword.trim()
        : "";
      delete payload.portalPassword;

      const nextActive = typeof payload.active === "boolean"
        ? payload.active
        : currentStaff.active !== false;
      const portalLink = await syncPortalUserForStaff({
        orgId,
        currentStaff,
        portalAccess,
        portalUsername,
        portalPassword,
        staffName: nextName,
        staffRole: nextRole,
        staffActive: nextActive,
      });

      const updates = {
        ...payload,
        ...portalLink,
      };
      res.json(await storage.updateStaff(orgId, Number(req.params.id), updates));
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  app.delete("/api/staff/:id", requireAuth, requireRole(...STAFF_MGMT_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      await storage.deleteStaff(orgId, Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
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
  app.delete("/api/occurrences/:id", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const deleted = await storage.deleteOccurrence(orgId, Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ message: "Ocorrência não encontrada." });
    }
    res.status(204).send();
  });

  // ===== SHIFT ASSIGNMENTS =====
  const shiftInputSchema = z.object({
    staffId: z.number(),
    residentId: z.number().optional().nullable(),
    shiftType: z.enum(["12h_manha", "12h_noite", "24h", "avulso"]).default("avulso"),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
    notes: z.string().optional().nullable(),
    payableAmount: z.coerce.number().min(0).optional().nullable(),
    promoteToStaffDefault: z.boolean().optional(),
  });
  const shiftPayableInputSchema = z.object({
    payableAmount: z.coerce.number().min(0).optional().nullable(),
    promoteToStaffDefault: z.boolean().optional(),
  });
  const generateMonthInputSchema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes invalido. Use YYYY-MM."),
    staffId: z.number().optional(),
    clearGenerated: z.boolean().optional().default(true),
  });
  class ShiftValidationError extends Error {}

  type WeekdayKey =
    | "sunday"
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday";

  type WorkScheduleSlot = { start: string; end: string };
  type WorkScheduleRule = { enabled?: boolean; slots?: WorkScheduleSlot[] };
  type ParsedWorkSchedule = {
    weekly: Record<WeekdayKey, WorkScheduleRule>;
    oddDays: WorkScheduleRule;
    evenDays: WorkScheduleRule;
    blockedDates: string[];
    profileCycleStart: "12h_manha" | "12h_noite" | null;
  };

  const AUTO_MONTH_NOTE_PREFIX = "[AUTO-MONTH:";
  const AUTO_MONTH_PAYABLE_NOTE_PREFIX = "[AUTO-MONTH-PAYABLE:";
  const MANUAL_SHIFT_PAYABLE_NOTE_PREFIX = "[SHIFT-PAYABLE]";
  const MANUAL_PAYABLE_SHIFT_ID_REGEX = /\[SHIFT:(\d+)\]/;
  const AUTO_PAYABLE_NOTE_REGEX = /\[AUTO-MONTH-PAYABLE:(\d{4}-(0[1-9]|1[0-2]))\]\[STAFF:(\d+)\]/;
  const AUTO_PAYABLE_UNIT_REGEX = /(\d+)x([0-9]+(?:\.[0-9]+)?)/;
  const AUTO_PAYABLE_IDS_REGEX = /ids:([0-9,]+)/;
  const parseManualPayableShiftId = (notes: unknown): number | null => {
    if (typeof notes !== "string") return null;
    const match = notes.match(MANUAL_PAYABLE_SHIFT_ID_REGEX);
    if (!match) return null;
    const shiftId = Number(match[1]);
    if (!Number.isInteger(shiftId) || shiftId <= 0) return null;
    return shiftId;
  };
  const SHIFT_TYPE_LABELS: Record<ShiftAssignmentType, string> = {
    "12h_manha": "Diurno (12h)",
    "12h_noite": "Noturno (12h)",
    "24h": "24h",
    "avulso": "Avulso",
  };
  const WEEKDAY_KEYS: WeekdayKey[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const WEEKDAY_LABELS_PT: Record<WeekdayKey, string> = {
    sunday: "domingo",
    monday: "segunda",
    tuesday: "terca",
    wednesday: "quarta",
    thursday: "quinta",
    friday: "sexta",
    saturday: "sabado",
  };

  const createDefaultWorkSchedule = (): ParsedWorkSchedule => ({
    weekly: {
      sunday: { enabled: false, slots: [] },
      monday: { enabled: false, slots: [] },
      tuesday: { enabled: false, slots: [] },
      wednesday: { enabled: false, slots: [] },
      thursday: { enabled: false, slots: [] },
      friday: { enabled: false, slots: [] },
      saturday: { enabled: false, slots: [] },
    },
    oddDays: { enabled: false, slots: [] },
    evenDays: { enabled: false, slots: [] },
    blockedDates: [],
    profileCycleStart: null,
  });

  const DATE_KEY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const toDateKey = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizeWorkScheduleRule = (raw: unknown): WorkScheduleRule => {
    if (!raw || typeof raw !== "object") return { enabled: false, slots: [] };
    const candidate = raw as { enabled?: unknown; slots?: unknown };
    const slots = Array.isArray(candidate.slots)
      ? candidate.slots
          .map((slot) => {
            if (!slot || typeof slot !== "object") return null;
            const rawSlot = slot as { start?: unknown; end?: unknown };
            if (typeof rawSlot.start !== "string" || typeof rawSlot.end !== "string") return null;
            return { start: rawSlot.start, end: rawSlot.end };
          })
          .filter((slot): slot is WorkScheduleSlot => !!slot)
      : [];
    return {
      enabled: Boolean(candidate.enabled),
      slots,
    };
  };

  const parseStaffWorkSchedule = (value: unknown): ParsedWorkSchedule => {
    const defaultSchedule = createDefaultWorkSchedule();
    if (typeof value !== "string" || !value.trim()) return defaultSchedule;
    try {
      const raw = JSON.parse(value) as Record<string, unknown>;
      const weeklySource = raw.weekly && typeof raw.weekly === "object"
        ? (raw.weekly as Record<string, unknown>)
        : {};

      const weekly = WEEKDAY_KEYS.reduce<Record<WeekdayKey, WorkScheduleRule>>((acc, key) => {
        acc[key] = normalizeWorkScheduleRule(weeklySource[key]);
        return acc;
      }, {} as Record<WeekdayKey, WorkScheduleRule>);

      return {
        weekly,
        oddDays: normalizeWorkScheduleRule(raw.oddDays),
        evenDays: normalizeWorkScheduleRule(raw.evenDays),
        blockedDates: Array.isArray(raw.blockedDates)
          ? raw.blockedDates
              .filter((date): date is string => typeof date === "string" && DATE_KEY_REGEX.test(date))
              .filter((date, index, source) => source.indexOf(date) === index)
              .sort()
          : [],
        profileCycleStart:
          raw.profileCycleStart === "12h_manha" || raw.profileCycleStart === "12h_noite"
            ? raw.profileCycleStart
            : null,
      };
    } catch {
      return defaultSchedule;
    }
  };

  const normalizeClock = (value?: string): string | null => {
    if (!value) return null;
    const normalized = value.trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized)) return null;
    return normalized;
  };

  const buildDateWithClock = (baseDate: Date, clock: string): Date | null => {
    const normalized = normalizeClock(clock);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(":").map(Number);
    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      minutes,
      0,
      0,
    );
  };
  type DailyScheduleWindow = { start: Date; end: Date; source: string };
  type DailyScheduleResolution = {
    hasRestrictions: boolean;
    blocked: boolean;
    windows: DailyScheduleWindow[];
    invalidSlots: number;
  };
  const isRuleConfigured = (rule: WorkScheduleRule | undefined): boolean =>
    Boolean(rule?.enabled && (rule.slots?.length ?? 0) > 0);
  const buildRuleWindowsForDate = (
    baseDate: Date,
    rule: WorkScheduleRule | undefined,
    source: string,
  ): { windows: DailyScheduleWindow[]; invalidSlots: number } => {
    if (!isRuleConfigured(rule)) return { windows: [], invalidSlots: 0 };
    const windows: DailyScheduleWindow[] = [];
    let invalidSlots = 0;

    for (const slot of rule?.slots ?? []) {
      const start = buildDateWithClock(baseDate, slot.start);
      const rawEnd = buildDateWithClock(baseDate, slot.end);
      if (!start || !rawEnd) {
        invalidSlots++;
        continue;
      }
      const end = new Date(rawEnd);
      if (end <= start) {
        end.setDate(end.getDate() + 1);
      }
      windows.push({ start, end, source });
    }

    return { windows, invalidSlots };
  };
  const intersectDailyWindows = (
    first: DailyScheduleWindow[],
    second: DailyScheduleWindow[],
  ): DailyScheduleWindow[] => {
    const intersections: DailyScheduleWindow[] = [];
    for (const left of first) {
      for (const right of second) {
        const start = new Date(Math.max(left.start.getTime(), right.start.getTime()));
        const end = new Date(Math.min(left.end.getTime(), right.end.getTime()));
        if (end > start) {
          intersections.push({
            start,
            end,
            source: `${left.source}+${right.source}`,
          });
        }
      }
    }
    return intersections;
  };
  const resolveDailySchedule = (schedule: ParsedWorkSchedule, baseDate: Date): DailyScheduleResolution => {
    const dayKey = toDateKey(baseDate);
    if (schedule.blockedDates.includes(dayKey)) {
      return {
        hasRestrictions: true,
        blocked: true,
        windows: [],
        invalidSlots: 0,
      };
    }

    const weekdayKey = WEEKDAY_KEYS[baseDate.getDay()];
    const hasWeeklyRestriction = WEEKDAY_KEYS.some((key) => isRuleConfigured(schedule.weekly[key]));
    const hasOddRestriction = isRuleConfigured(schedule.oddDays);
    const hasEvenRestriction = isRuleConfigured(schedule.evenDays);
    const hasParityRestriction = hasOddRestriction || hasEvenRestriction;

    const weeklyWindowsForDay = buildRuleWindowsForDate(
      baseDate,
      schedule.weekly[weekdayKey],
      WEEKDAY_LABELS_PT[weekdayKey],
    );
    const isOddDay = baseDate.getDate() % 2 === 1;
    const parityRule = isOddDay ? schedule.oddDays : schedule.evenDays;
    const parityWindowsForDay = buildRuleWindowsForDate(
      baseDate,
      parityRule,
      isOddDay ? "dias impares" : "dias pares",
    );

    let windows: DailyScheduleWindow[] = [];
    if (hasParityRestriction) {
      // Dias pares/impares têm prioridade e dispensam seleção de dia da semana.
      windows = parityWindowsForDay.windows;
    } else if (hasWeeklyRestriction) {
      windows = weeklyWindowsForDay.windows;
    }

    return {
      hasRestrictions: hasWeeklyRestriction || hasParityRestriction,
      blocked: false,
      windows,
      invalidSlots: weeklyWindowsForDay.invalidSlots + parityWindowsForDay.invalidSlots,
    };
  };
  const isShiftWithinWindows = (startTime: Date, endTime: Date, windows: DailyScheduleWindow[]) =>
    windows.some((window) => startTime >= window.start && endTime <= window.end);

  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const formatHourMinute = (value: Date): string =>
    `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  const getManualShiftPayableKey = (shiftId: number): string =>
    `${MANUAL_SHIFT_PAYABLE_NOTE_PREFIX}[SHIFT:${shiftId}]`;
  const buildManualShiftPayableNote = (shift: {
    id: number;
    startTime: Date;
    endTime: Date;
    shiftType: string;
    notes?: string | null;
  }): string => {
    const shiftStart = new Date(shift.startTime);
    const shiftEnd = new Date(shift.endTime);
    const shiftTypeLabel =
      SHIFT_TYPE_LABELS[(shift.shiftType as ShiftAssignmentType) ?? "avulso"] ?? shift.shiftType;
    const detailLabel =
      `${toDateKey(shiftStart)} ${formatHourMinute(shiftStart)} - ${toDateKey(shiftEnd)} ${formatHourMinute(shiftEnd)}`;
    return `${getManualShiftPayableKey(shift.id)} ${detailLabel} ${shiftTypeLabel}${shift.notes ? ` | ${shift.notes}` : ""}`;
  };
  const buildManualShiftPayableBasePayload = async (
    orgId: number,
    shift: {
      id: number;
      staffId: number;
      startTime: Date;
      endTime: Date;
      shiftType: string;
      notes?: string | null;
    },
  ) => {
    const shiftStart = new Date(shift.startTime);
    const staffMember = await storage.getStaffMember(orgId, shift.staffId);
    const dueDate = toDateKey(shiftStart);
    const referenceMonth = `${shiftStart.getFullYear()}-${String(shiftStart.getMonth() + 1).padStart(2, "0")}`;
    return {
      staffId: shift.staffId,
      title: `Plantao ${dueDate} - ${staffMember?.name ?? "colaborador"}`,
      category: "staff" as const,
      referenceMonth,
      dueDate,
      notes: buildManualShiftPayableNote(shift),
    };
  };
  const listManualShiftPayablesByShiftId = async (orgId: number, shiftId: number) => {
    const shiftPayableKey = getManualShiftPayableKey(shiftId);
    const payables = await storage.getAccountsPayable(orgId);
    return payables
      .filter((item) => typeof item.notes === "string" && item.notes.includes(shiftPayableKey))
      .sort((left, right) => left.id - right.id);
  };
  const buildShiftPayableLinkResponse = async (
    orgId: number,
    shift: { id: number },
  ) => {
    const linkedPayables = await listManualShiftPayablesByShiftId(orgId, shift.id);
    const linkedPayable = linkedPayables[0];
    return {
      shiftId: shift.id,
      linked: Boolean(linkedPayable),
      payableId: linkedPayable?.id ?? null,
      amount: linkedPayable ? Number(linkedPayable.amount ?? 0) : null,
      status: linkedPayable?.status ?? null,
      title: linkedPayable?.title ?? null,
    };
  };
  const maybeApplyShiftValueAsStaffDefault = async (input: {
    orgId: number;
    staffId: number;
    value: number;
  }) => {
    const staffMember = await storage.getStaffMember(input.orgId, input.staffId);
    if (!staffMember) return;
    const currentShiftValue = Number(staffMember.shiftValue ?? 0);
    if (!Number.isFinite(currentShiftValue) || currentShiftValue <= 0) {
      await storage.updateStaff(input.orgId, staffMember.id, {
        shiftValue: input.value,
      });
    }
  };
  const syncManualShiftPayableForShift = async (input: {
    orgId: number;
    shift: {
      id: number;
      staffId: number;
      startTime: Date;
      endTime: Date;
      shiftType: string;
      notes?: string | null;
    };
    payableAmount?: number | null;
    remove?: boolean;
    promoteToStaffDefault?: boolean;
  }) => {
    const linkedPayables = await listManualShiftPayablesByShiftId(input.orgId, input.shift.id);
    const rawExplicitAmount = Number(input.payableAmount ?? NaN);
    const hasExplicitAmount =
      input.payableAmount !== undefined && input.payableAmount !== null && Number.isFinite(rawExplicitAmount);
    const explicitAmount = hasExplicitAmount ? roundMoney(Math.max(0, rawExplicitAmount)) : null;
    if (hasExplicitAmount && (explicitAmount ?? 0) > 0 && input.promoteToStaffDefault) {
      await maybeApplyShiftValueAsStaffDefault({
        orgId: input.orgId,
        staffId: input.shift.staffId,
        value: explicitAmount ?? 0,
      });
    }
    const shouldDelete = Boolean(input.remove || (hasExplicitAmount && (explicitAmount ?? 0) <= 0));

    if (shouldDelete) {
      for (const payable of linkedPayables) {
        await storage.deleteAccountPayable(input.orgId, payable.id);
      }
      return;
    }

    const primaryPayable = linkedPayables[0];
    const duplicatedPayables = linkedPayables.slice(primaryPayable ? 1 : 0);
    for (const duplicatedPayable of duplicatedPayables) {
      await storage.deleteAccountPayable(input.orgId, duplicatedPayable.id);
    }

    if (!primaryPayable && !hasExplicitAmount) {
      return;
    }

    const basePayload = await buildManualShiftPayableBasePayload(input.orgId, input.shift);
    if (primaryPayable) {
      const currentAmount = roundMoney(Math.max(0, Number(primaryPayable.amount ?? 0)));
      const nextAmount = hasExplicitAmount ? (explicitAmount ?? 0) : currentAmount;
      if (nextAmount <= 0) {
        await storage.deleteAccountPayable(input.orgId, primaryPayable.id);
        return;
      }
      await storage.updateAccountPayable(input.orgId, primaryPayable.id, {
        ...basePayload,
        amount: nextAmount,
      });
      return;
    }

    const createAmount = explicitAmount ?? 0;
    if (createAmount <= 0) {
      return;
    }
    await storage.createAccountPayable({
      organizationId: input.orgId,
      ...basePayload,
      amount: createAmount,
      discount: 0,
      extra: 0,
      status: "pending",
      paidAt: null,
      paymentMethod: null,
    });
  };

  const assertShiftWindow = (startTime: Date, endTime: Date) => {
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new ShiftValidationError("Data/hora inválida para a escala.");
    }
    if (endTime <= startTime) {
      throw new ShiftValidationError("Horário de fim precisa ser maior que o de início.");
    }
  };

  const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
    aStart < bEnd && aEnd > bStart;
  const resolveShiftTypeFromWindow = (startTime: Date, endTime: Date): ShiftAssignmentType => {
    const durationMs = endTime.getTime() - startTime.getTime();
    if (Math.abs(durationMs - (12 * HOUR_MS)) <= FIVE_MINUTES_MS) {
      return startTime.getHours() < 12 ? "12h_manha" : "12h_noite";
    }
    if (Math.abs(durationMs - (24 * HOUR_MS)) <= FIVE_MINUTES_MS) {
      return "24h";
    }
    return "avulso";
  };
  const getDefaultShiftTypeForRule = (allowedShiftTypes: ShiftAssignmentType[]): ShiftAssignmentType => {
    if (allowedShiftTypes.includes("12h_manha")) return "12h_manha";
    if (allowedShiftTypes.includes("12h_noite")) return "12h_noite";
    if (allowedShiftTypes.includes("24h")) return "24h";
    if (allowedShiftTypes.includes("avulso")) return "avulso";
    return "avulso";
  };
  const buildShiftWindowFromType = (
    baseDate: Date,
    shiftType: ShiftAssignmentType,
    exactShiftHours?: number | null,
  ): { startTime: Date; endTime: Date } => {
    let startHour = 8;
    if (shiftType === "12h_manha" || shiftType === "24h") startHour = 7;
    if (shiftType === "12h_noite") startHour = 19;

    const startTime = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      startHour,
      0,
      0,
      0,
    );
    const durationHours =
      exactShiftHours && exactShiftHours > 0
        ? exactShiftHours
        : shiftType === "24h"
          ? 24
          : shiftType === "12h_manha" || shiftType === "12h_noite"
            ? 12
            : 8;
    const endTime = new Date(startTime.getTime() + (durationHours * HOUR_MS));
    return { startTime, endTime };
  };

  const assertShiftAssignmentAllowed = async (input: {
    orgId: number;
    staffId: number;
    shiftType: ShiftAssignmentType;
    startTime: Date;
    endTime: Date;
    excludeShiftId?: number;
    environmentSettings?: EnvironmentSettings;
  }) => {
    const staffMember = await storage.getStaffMember(input.orgId, input.staffId);
    if (!staffMember) {
      throw new ShiftValidationError("Funcionário não encontrado.");
    }

    assertShiftWindow(input.startTime, input.endTime);

    const existingShifts = await storage.getShiftAssignments(input.orgId, { staffId: input.staffId });
    const otherShifts = existingShifts.filter((shift) => shift.id !== input.excludeShiftId);

    const hasOverlap = otherShifts.some((shift) => {
      const existingStart = new Date(shift.startTime);
      const existingEnd = new Date(shift.endTime);
      return rangesOverlap(input.startTime, input.endTime, existingStart, existingEnd);
    });
    if (hasOverlap) {
      throw new ShiftValidationError("Funcionário já possui escala neste período.");
    }

    const hasCustomWorkSchedule =
      typeof staffMember.workSchedule === "string" && staffMember.workSchedule.trim().length > 0;

    if (hasCustomWorkSchedule) {
      const schedule = parseStaffWorkSchedule(staffMember.workSchedule);
      const dayReference = new Date(
        input.startTime.getFullYear(),
        input.startTime.getMonth(),
        input.startTime.getDate(),
        0,
        0,
        0,
        0,
      );
      const dailySchedule = resolveDailySchedule(schedule, dayReference);

      if (dailySchedule.blocked) {
        throw new ShiftValidationError("Este dia esta bloqueado na jornada do colaborador.");
      }
      if (dailySchedule.hasRestrictions) {
        if (dailySchedule.windows.length === 0) {
          throw new ShiftValidationError("Dia/horario fora da jornada configurada do colaborador.");
        }
        if (!isShiftWithinWindows(input.startTime, input.endTime, dailySchedule.windows)) {
          throw new ShiftValidationError("Horario fora da jornada configurada do colaborador.");
        }
      }
    }

    const shiftRule = getShiftProfileRule(staffMember.shift, input.environmentSettings?.shiftProfiles);
    if (!shiftRule.enabled) {
      return;
    }

    if (shiftRule.allowedShiftTypes.length > 0 && !shiftRule.allowedShiftTypes.includes(input.shiftType)) {
      throw new ShiftValidationError(
        `Perfil ${staffMember.shift} aceita apenas: ${shiftRule.allowedShiftTypes.join(", ")}.`,
      );
    }

    const isAvulsoShift = input.shiftType === "avulso";
    const durationMs = input.endTime.getTime() - input.startTime.getTime();
    // Plantao avulso ignora regra fixa de duracao do perfil (ex.: 12x36).
    if (!isAvulsoShift && shiftRule.exactShiftHours) {
      const expectedDurationMs = shiftRule.exactShiftHours * HOUR_MS;
      if (Math.abs(durationMs - expectedDurationMs) > FIVE_MINUTES_MS) {
        throw new ShiftValidationError(
          `Perfil ${staffMember.shift} exige plantao de ${shiftRule.exactShiftHours}h.`,
        );
      }
    }

    // Plantao avulso tambem ignora descanso minimo entre escalas do perfil.
    if (!isAvulsoShift && shiftRule.minRestHours) {
      const minimumRestMs = shiftRule.minRestHours * HOUR_MS;
      const violatesRest = otherShifts.some((shift) => {
        const existingStartMs = new Date(shift.startTime).getTime();
        const existingEndMs = new Date(shift.endTime).getTime();
        const startMs = input.startTime.getTime();
        const endMs = input.endTime.getTime();

        if (startMs >= existingEndMs) {
          return startMs - existingEndMs < minimumRestMs;
        }
        if (endMs <= existingStartMs) {
          return existingStartMs - endMs < minimumRestMs;
        }
        return true;
      });

      if (violatesRest) {
        throw new ShiftValidationError(
          `Perfil ${staffMember.shift} exige descanso minimo de ${shiftRule.minRestHours}h entre plantoes.`,
        );
      }
    }
  };

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
  app.get("/api/shift-assignments/:id/payable", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ message: "ID de escala invalido." });
    }

    const shifts = await storage.getShiftAssignments(orgId);
    const targetShift = shifts.find((shift) => shift.id === shiftId);
    if (!targetShift) {
      return res.status(404).json({ message: "Escala nao encontrada." });
    }

    await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
    return res.json(await buildShiftPayableLinkResponse(orgId, targetShift));
  });
  // Escrita de escalas: admin + enfermeiro + tecnico + recepcionista + administrativo
  const SHIFT_WRITE_ROLES = ["admin", "enfermeiro", "tecnico_enfermagem", "recepcionista", "administrativo"];
  app.put("/api/shift-assignments/:id/payable", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const shiftId = Number(req.params.id);
      if (!Number.isInteger(shiftId) || shiftId <= 0) {
        return res.status(400).json({ message: "ID de escala invalido." });
      }
      const input = shiftPayableInputSchema.parse(req.body ?? {});

      const shifts = await storage.getShiftAssignments(orgId);
      const targetShift = shifts.find((shift) => shift.id === shiftId);
      if (!targetShift) {
        return res.status(404).json({ message: "Escala nao encontrada." });
      }

      await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
      await syncManualShiftPayableForShift({
        orgId,
        shift: targetShift,
        payableAmount: input.payableAmount,
        promoteToStaffDefault: input.promoteToStaffDefault !== false,
      });

      return res.json(await buildShiftPayableLinkResponse(orgId, targetShift));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.post("/api/shift-assignments/generate-month", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const input = generateMonthInputSchema.parse(req.body);
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, input.staffId ?? null);
      const [year, monthNumber] = input.month.split("-").map(Number);
      const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);
      const totalDaysInMonth = monthEnd.getDate();

      const allStaff = await storage.getStaff(orgId);
      const targetStaff = enforcedStaffId
        ? allStaff.filter((member) => member.id === enforcedStaffId)
        : input.staffId
          ? allStaff.filter((member) => member.id === input.staffId)
        : allStaff;

      if ((input.staffId || enforcedStaffId) && targetStaff.length === 0) {
        return res.status(404).json({ message: "Funcionario nao encontrado." });
      }

      const targetStaffIds = new Set<number>(targetStaff.map((member) => member.id));
      const payablesForMonth = await storage.getAccountsPayable(orgId, {
        referenceMonth: input.month,
      });
      const manualPayableShiftIdsForTargetStaff = new Set<number>(
        payablesForMonth
          .filter((item) => Number.isInteger(item.staffId) && targetStaffIds.has(Number(item.staffId)))
          .map((item) => parseManualPayableShiftId(item.notes))
          .filter((shiftId): shiftId is number => shiftId !== null),
      );

      let monthlyShifts = await storage.getShiftAssignments(orgId, {
        start: monthStart,
        end: monthEnd,
      });

      const isGeneratedShift = (note?: string | null) =>
        typeof note === "string" && note.startsWith(`${AUTO_MONTH_NOTE_PREFIX}${input.month}]`);

      if (input.clearGenerated) {
        const generatedShifts = monthlyShifts.filter(
          (shift) =>
            isGeneratedShift(shift.notes) &&
            (!input.staffId || shift.staffId === input.staffId),
        );
        const generatedShiftsToPreserve = generatedShifts.filter((shift) =>
          manualPayableShiftIdsForTargetStaff.has(shift.id),
        );
        const generatedShiftsToDelete = generatedShifts.filter((shift) =>
          !manualPayableShiftIdsForTargetStaff.has(shift.id),
        );

        for (const generatedShift of generatedShiftsToDelete) {
          await syncManualShiftPayableForShift({
            orgId,
            shift: generatedShift,
            remove: true,
          });
          await storage.deleteShiftAssignment(orgId, generatedShift.id);
        }

        monthlyShifts = await storage.getShiftAssignments(orgId, {
          start: monthStart,
          end: monthEnd,
        });

        if (generatedShiftsToPreserve.length > 0) {
          console.log(
            `[generate-month] preservados ${generatedShiftsToPreserve.length} plantao(oes) com valor manual em ${input.month}`,
          );
        }
      }

      type ShiftRange = { start: Date; end: Date };
      const shiftRangesByStaff = new Map<number, ShiftRange[]>();
      for (const shift of monthlyShifts) {
        const existingRanges = shiftRangesByStaff.get(shift.staffId) ?? [];
        existingRanges.push({
          start: new Date(shift.startTime),
          end: new Date(shift.endTime),
        });
        shiftRangesByStaff.set(shift.staffId, existingRanges);
      }

      let createdCount = 0;
      let skippedCount = 0;
      let invalidSlotCount = 0;
      let overlapSkipCount = 0;
      let validationSkipCount = 0;
      let configuredStaffCount = 0;

      for (const member of targetStaff) {
        if (member.active === false) continue;

        const schedule = parseStaffWorkSchedule(member.workSchedule);
        const hasWeeklyRule = WEEKDAY_KEYS.some((key) => {
          const rule = schedule.weekly[key];
          return Boolean(rule.enabled && (rule.slots?.length ?? 0) > 0);
        });
        const hasOddRule = Boolean(schedule.oddDays.enabled && (schedule.oddDays.slots?.length ?? 0) > 0);
        const hasEvenRule = Boolean(schedule.evenDays.enabled && (schedule.evenDays.slots?.length ?? 0) > 0);
        const hasRecurringSchedule = hasWeeklyRule || hasOddRule || hasEvenRule;

        const shiftRule = getShiftProfileRule(member.shift, environmentSettings.shiftProfiles);
        const canGenerateFromProfileRule =
          !hasRecurringSchedule
          && shiftRule.enabled
          && Boolean(shiftRule.exactShiftHours && shiftRule.exactShiftHours > 0);
        const preferredProfileShiftType =
          schedule.profileCycleStart
          && shiftRule.allowedShiftTypes.includes(schedule.profileCycleStart)
            ? schedule.profileCycleStart
            : null;
        const profileShiftType = preferredProfileShiftType ?? getDefaultShiftTypeForRule(shiftRule.allowedShiftTypes);

        if (!hasRecurringSchedule && !canGenerateFromProfileRule) continue;
        configuredStaffCount++;

        const memberRanges = shiftRangesByStaff.get(member.id) ?? [];

        for (let day = 1; day <= totalDaysInMonth; day++) {
          const currentDay = new Date(year, monthNumber - 1, day, 0, 0, 0, 0);
          if (hasRecurringSchedule) {
            const dailySchedule = resolveDailySchedule(schedule, currentDay);
            if (dailySchedule.blocked) {
              continue;
            }
            if (!dailySchedule.hasRestrictions) {
              continue;
            }
            if (dailySchedule.invalidSlots > 0) {
              skippedCount += dailySchedule.invalidSlots;
              invalidSlotCount += dailySchedule.invalidSlots;
            }
            if (dailySchedule.windows.length === 0) {
              continue;
            }

            for (const window of dailySchedule.windows) {
              const startTime = new Date(window.start);
              const endTime = new Date(window.end);
              const generatedShiftType = resolveShiftTypeFromWindow(startTime, endTime);

              const hasOverlap = memberRanges.some((range) =>
                rangesOverlap(startTime, endTime, range.start, range.end),
              );
              if (hasOverlap) {
                skippedCount++;
                overlapSkipCount++;
                continue;
              }

              try {
                await assertShiftAssignmentAllowed({
                  orgId,
                  staffId: member.id,
                  shiftType: generatedShiftType,
                  startTime,
                  endTime,
                  environmentSettings,
                });
              } catch (error) {
                if (error instanceof ShiftValidationError) {
                  skippedCount++;
                  validationSkipCount++;
                  continue;
                }
                throw error;
              }

              const notes = `${AUTO_MONTH_NOTE_PREFIX}${input.month}] ${window.source}`;
              const createdShift = await storage.createShiftAssignment({
                organizationId: orgId,
                staffId: member.id,
                residentId: null,
                shiftType: generatedShiftType,
                startTime,
                endTime,
                notes,
              });

              memberRanges.push({
                start: new Date(createdShift.startTime),
                end: new Date(createdShift.endTime),
              });
              createdCount++;
            }
            continue;
          }

          if (!canGenerateFromProfileRule) {
            continue;
          }

          const { startTime, endTime } = buildShiftWindowFromType(
            currentDay,
            profileShiftType,
            shiftRule.exactShiftHours,
          );
          const hasOverlap = memberRanges.some((range) =>
            rangesOverlap(startTime, endTime, range.start, range.end),
          );
          if (hasOverlap) {
            skippedCount++;
            overlapSkipCount++;
            continue;
          }

          try {
            await assertShiftAssignmentAllowed({
              orgId,
              staffId: member.id,
              shiftType: profileShiftType,
              startTime,
              endTime,
              environmentSettings,
            });
          } catch (error) {
            if (error instanceof ShiftValidationError) {
              skippedCount++;
              validationSkipCount++;
              continue;
            }
            throw error;
          }

          const notes = `${AUTO_MONTH_NOTE_PREFIX}${input.month}] regra:${member.shift}`;
          const createdShift = await storage.createShiftAssignment({
            organizationId: orgId,
            staffId: member.id,
            residentId: null,
            shiftType: profileShiftType,
            startTime,
            endTime,
            notes,
          });

          memberRanges.push({
            start: new Date(createdShift.startTime),
            end: new Date(createdShift.endTime),
          });
          createdCount++;
        }

        shiftRangesByStaff.set(member.id, memberRanges);
      }

      const monthShiftsAfterGeneration = await storage.getShiftAssignments(orgId, {
        start: monthStart,
        end: monthEnd,
      });
      const getAutoPayableKey = (staffId: number) =>
        `${AUTO_MONTH_PAYABLE_NOTE_PREFIX}${input.month}][STAFF:${staffId}]`;
      const isAutoPayableForStaff = (note: unknown, staffId: number) =>
        typeof note === "string" && note.includes(getAutoPayableKey(staffId));

      const monthDueDate = `${input.month}-${String(totalDaysInMonth).padStart(2, "0")}`;
      let payablesCreated = 0;
      let payablesUpdated = 0;
      let payablesDeleted = 0;
      let payablesSkippedLocked = 0;

      for (const member of targetStaff) {
        if (member.active === false) continue;

        const shiftValueRaw = Number(member.shiftValue ?? 0);
        const shiftValue = Number.isFinite(shiftValueRaw) && shiftValueRaw > 0
          ? roundMoney(shiftValueRaw)
          : 0;
        const payablesForStaffMonth = await storage.getAccountsPayable(orgId, {
          staffId: member.id,
          referenceMonth: input.month,
        });
        const manualPayableShiftIdsForStaff = new Set<number>(
          payablesForStaffMonth
            .map((item) => parseManualPayableShiftId(item.notes))
            .filter((shiftId): shiftId is number => shiftId !== null),
        );
        const generatedShiftsForStaff = monthShiftsAfterGeneration
          .filter(
            (shift) =>
              shift.staffId === member.id
              && isGeneratedShift(shift.notes)
              && !manualPayableShiftIdsForStaff.has(shift.id),
          )
          .sort((left, right) =>
            new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
          );
        const generatedShiftCount = generatedShiftsForStaff.length;
        const autoPayables = payablesForStaffMonth.filter((item) =>
          isAutoPayableForStaff(item.notes, member.id),
        );
        const paidAutoPayables = autoPayables.filter((item) => item.status === "paid");
        const editableAutoPayables = autoPayables.filter((item) => item.status !== "paid");

        if (paidAutoPayables.length > 0) {
          for (const payable of editableAutoPayables) {
            await storage.deleteAccountPayable(orgId, payable.id);
            payablesDeleted++;
          }
          payablesSkippedLocked += paidAutoPayables.length;
          continue;
        }

        const primaryEditable = editableAutoPayables[0];
        const duplicatedEditable = editableAutoPayables.slice(primaryEditable ? 1 : 0);
        for (const duplicated of duplicatedEditable) {
          await storage.deleteAccountPayable(orgId, duplicated.id);
          payablesDeleted++;
        }

        if (shiftValue <= 0 || generatedShiftCount <= 0) {
          if (primaryEditable) {
            await storage.deleteAccountPayable(orgId, primaryEditable.id);
            payablesDeleted++;
          }
          continue;
        }

        const amount = roundMoney(generatedShiftCount * shiftValue);
        const consideredShiftIds = generatedShiftsForStaff.map((shift) => shift.id).join(",");
        const autoPayableNote = `${getAutoPayableKey(member.id)} ${generatedShiftCount}x${shiftValue.toFixed(2)} ids:${consideredShiftIds}`;
        const basePayablePayload = {
          organizationId: orgId,
          staffId: member.id,
          title: `Plantoes ${input.month} - ${member.name}`,
          category: "staff",
          referenceMonth: input.month,
          dueDate: monthDueDate,
          amount,
          discount: 0,
          extra: 0,
          paymentMethod: null,
          notes: autoPayableNote,
        } as const;

        if (primaryEditable) {
          await storage.updateAccountPayable(orgId, primaryEditable.id, {
            ...basePayablePayload,
            status: "pending",
            paidAt: null,
          });
          payablesUpdated++;
        } else {
          await storage.createAccountPayable({
            ...basePayablePayload,
            status: "pending",
            paidAt: null,
          });
          payablesCreated++;
        }
      }

      res.json({
        month: input.month,
        staffProcessed: targetStaff.length,
        staffWithSchedule: configuredStaffCount,
        created: createdCount,
        skipped: skippedCount,
        skippedByInvalidSlot: invalidSlotCount,
        skippedByOverlap: overlapSkipCount,
        skippedByValidation: validationSkipCount,
        clearedGenerated: Boolean(input.clearGenerated),
        payablesCreated,
        payablesUpdated,
        payablesDeleted,
        payablesSkippedLocked,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.post("/api/shift-assignments/:id/exclude-day", requireAuth, requireRole("admin"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const shiftId = Number(req.params.id);
      if (!Number.isInteger(shiftId) || shiftId <= 0) {
        return res.status(400).json({ message: "ID de escala invalido." });
      }

      const shifts = await storage.getShiftAssignments(orgId);
      const targetShift = shifts.find((shift) => shift.id === shiftId);
      if (!targetShift) {
        return res.status(404).json({ message: "Escala nao encontrada." });
      }

      const staffMember = await storage.getStaffMember(orgId, targetShift.staffId);
      if (!staffMember) {
        return res.status(404).json({ message: "Funcionario nao encontrado." });
      }

      const blockedDate = toDateKey(new Date(targetShift.startTime));
      const schedule = parseStaffWorkSchedule(staffMember.workSchedule);
      if (!schedule.blockedDates.includes(blockedDate)) {
        schedule.blockedDates.push(blockedDate);
        schedule.blockedDates.sort();
      }

      await storage.updateStaff(orgId, staffMember.id, {
        workSchedule: JSON.stringify(schedule),
      });
      await syncManualShiftPayableForShift({
        orgId,
        shift: targetShift,
        remove: true,
      });
      await storage.deleteShiftAssignment(orgId, targetShift.id);

      res.json({
        message: "Dia dispensado com sucesso.",
        shiftId: targetShift.id,
        staffId: staffMember.id,
        blockedDate,
      });
    } catch (err) {
      throw err;
    }
  });
  app.post("/api/shift-assignments", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const input = shiftInputSchema.parse(req.body);
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, input.staffId);
      if (!enforcedStaffId) {
        return res.status(400).json({ message: "Profissional da escala nao informado." });
      }
      const normalizedInput = { ...input, staffId: enforcedStaffId };
      await assertShiftAssignmentAllowed({
        orgId,
        staffId: normalizedInput.staffId,
        shiftType: normalizedInput.shiftType,
        startTime: normalizedInput.startTime,
        endTime: normalizedInput.endTime,
        environmentSettings,
      });
      const { payableAmount, promoteToStaffDefault, ...shiftPayload } = normalizedInput;
      const createdShift = await storage.createShiftAssignment({ ...shiftPayload, organizationId: orgId });
      await syncManualShiftPayableForShift({
        orgId,
        shift: createdShift,
        payableAmount,
        promoteToStaffDefault: promoteToStaffDefault !== false,
      });

      res.status(201).json(createdShift);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof ShiftValidationError) return res.status(400).json({ message: err.message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.put("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const environmentSettings = (res.locals.environmentSettings as EnvironmentSettings | undefined)
        ?? (await getOrganizationEnvironmentSettings(orgId))?.settings
        ?? DEFAULT_ENVIRONMENT_SETTINGS;
      const shiftId = Number(req.params.id);
      const updates = shiftInputSchema.partial().parse(req.body);
      const { payableAmount, promoteToStaffDefault, ...shiftUpdates } = updates;

      const currentShifts = await storage.getShiftAssignments(orgId);
      const currentShift = currentShifts.find((shift) => shift.id === shiftId);
      if (!currentShift) {
        return res.status(404).json({ message: "Escala não encontrada" });
      }

      const requestedStaffId = shiftUpdates.staffId ?? currentShift.staffId;
      const enforcedStaffId = await enforceCaregiverOwnStaffId(orgId, req.session.user, requestedStaffId);
      if (!enforcedStaffId) {
        return res.status(400).json({ message: "Profissional da escala nao informado." });
      }
      const nextStaffId = enforcedStaffId;
      const nextShiftType = (shiftUpdates.shiftType ?? currentShift.shiftType ?? "avulso") as "12h_manha" | "12h_noite" | "24h" | "avulso";
      const nextStartTime = shiftUpdates.startTime ?? new Date(currentShift.startTime);
      const nextEndTime = shiftUpdates.endTime ?? new Date(currentShift.endTime);

      await assertShiftAssignmentAllowed({
        orgId,
        staffId: nextStaffId,
        shiftType: nextShiftType,
        startTime: nextStartTime,
        endTime: nextEndTime,
        excludeShiftId: shiftId,
        environmentSettings,
      });

      const normalizedUpdates = shiftUpdates.staffId !== undefined || req.session.user?.role === "cuidador"
        ? { ...shiftUpdates, staffId: nextStaffId }
        : shiftUpdates;
      const updatedShift = await storage.updateShiftAssignment(orgId, shiftId, normalizedUpdates);
      await syncManualShiftPayableForShift({
        orgId,
        shift: updatedShift,
        payableAmount,
        promoteToStaffDefault: promoteToStaffDefault !== false,
      });

      res.json(updatedShift);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof ShiftValidationError) return res.status(400).json({ message: err.message });
      if (err instanceof Error) return res.status(400).json({ message: err.message });
      next(err);
    }
  });
  app.delete("/api/shift-assignments/:id", requireAuth, requireRole(...SHIFT_WRITE_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const shiftId = Number(req.params.id);
    if (!Number.isInteger(shiftId) || shiftId <= 0) {
      return res.status(400).json({ message: "ID de escala invalido." });
    }

    const shifts = await storage.getShiftAssignments(orgId);
    const targetShift = shifts.find((shift) => shift.id === shiftId);
    if (!targetShift) {
      return res.status(404).json({ message: "Escala nao encontrada." });
    }

    await enforceCaregiverOwnStaffId(orgId, req.session.user, targetShift.staffId);
    await syncManualShiftPayableForShift({
      orgId,
      shift: targetShift,
      remove: true,
    });
    await storage.deleteShiftAssignment(orgId, shiftId);
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
  type MonthlyFeeGenerationSummary = {
    month: string;
    totalContracts: number;
    activeContracts: number;
    created: number;
    skippedExisting: number;
    skippedInvalidValue: number;
    skippedInvalidDueDate: number;
  };
  const generateMonthlyFeesInputSchema = z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes invalido. Use YYYY-MM."),
  });
  const clampDayInMonth = (year: number, monthNumber: number, day: number) => {
    const maxDay = new Date(year, monthNumber, 0).getDate();
    const normalizedDay = Number.isFinite(day) ? Math.trunc(day) : 1;
    return Math.min(Math.max(1, normalizedDay), maxDay);
  };
  const buildMonthlyFeeDueDate = (referenceMonth: string, paymentDay: unknown) => {
    const [year, monthNumber] = referenceMonth.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return null;
    }
    const parsedPaymentDay = Number(paymentDay ?? 5);
    const dueDay = clampDayInMonth(year, monthNumber, parsedPaymentDay);
    return `${referenceMonth}-${String(dueDay).padStart(2, "0")}`;
  };
  const isContractActiveInReferenceMonth = (
    contract: {
      status?: string | null;
      startDate?: string | null;
      endDate?: string | null;
    },
    referenceMonth: string,
  ) => {
    if ((contract.status ?? "active") !== "active") return false;
    const [year, monthNumber] = referenceMonth.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return false;
    }
    const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);

    if (!contract.startDate) return false;
    const startDate = parseDateOnly(contract.startDate);
    if (!startDate) return false;

    const endDate = contract.endDate ? parseDateOnly(contract.endDate, true) : null;
    const startsBeforeOrDuringMonth = startDate.getTime() <= monthEnd.getTime();
    const endsAfterOrDuringMonth = !endDate || endDate.getTime() >= monthStart.getTime();
    return startsBeforeOrDuringMonth && endsAfterOrDuringMonth;
  };
  const generateMonthlyFeesForOrganizationMonth = async (
    orgId: number,
    month: string,
  ): Promise<MonthlyFeeGenerationSummary> => {
    const [contracts, monthFees] = await Promise.all([
      storage.getContracts(orgId),
      storage.getMonthlyFees(orgId, { referenceMonth: month }),
    ]);

    const activeContracts = contracts.filter((contract) =>
      isContractActiveInReferenceMonth(contract, month),
    );
    const existingContractIds = new Set(
      monthFees
        .filter((fee) => fee.referenceMonth === month)
        .map((fee) => fee.contractId),
    );

    let created = 0;
    let skippedExisting = 0;
    let skippedInvalidValue = 0;
    let skippedInvalidDueDate = 0;

    for (const contract of activeContracts) {
      if (existingContractIds.has(contract.id)) {
        skippedExisting++;
        continue;
      }

      const amount = roundMoney(Math.max(0, Number(contract.monthlyValue ?? 0)));
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedInvalidValue++;
        continue;
      }

      const dueDate = buildMonthlyFeeDueDate(month, contract.paymentDay);
      if (!dueDate) {
        skippedInvalidDueDate++;
        continue;
      }

      await storage.createMonthlyFee({
        organizationId: orgId,
        contractId: contract.id,
        residentId: contract.residentId,
        referenceMonth: month,
        dueDate,
        amount,
        status: "pending",
        discount: 0,
        fine: 0,
        paymentMethod: contract.paymentMethod ?? null,
        notes: "Gerada automaticamente com base no contrato mensal.",
      });
      existingContractIds.add(contract.id);
      created++;
    }

    return {
      month,
      totalContracts: contracts.length,
      activeContracts: activeContracts.length,
      created,
      skippedExisting,
      skippedInvalidValue,
      skippedInvalidDueDate,
    };
  };
  app.get("/api/monthly-fees", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getMonthlyFees(orgId, {
      contractId: req.query.contractId ? Number(req.query.contractId) : undefined,
      residentId: req.query.residentId ? Number(req.query.residentId) : undefined,
      status: req.query.status as string | undefined,
      referenceMonth: req.query.referenceMonth as string | undefined,
    }));
  });
  app.post("/api/monthly-fees/generate-month", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res, next) => {
    try {
      const orgId = getOrgId(req);
      const input = generateMonthlyFeesInputSchema.parse(req.body);
      const summary = await generateMonthlyFeesForOrganizationMonth(orgId, input.month);
      res.status(201).json(summary);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
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

  // ===== ACCOUNTS PAYABLE =====
  app.get("/api/accounts-payable", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getAccountsPayable(orgId, {
      staffId: req.query.staffId ? Number(req.query.staffId) : undefined,
      status: req.query.status as string | undefined,
      referenceMonth: req.query.referenceMonth as string | undefined,
    }));
  });
  app.get("/api/accounts-payable/:id/details", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const payableId = Number(req.params.id);
    if (!Number.isInteger(payableId) || payableId <= 0) {
      return res.status(400).json({ message: "ID invalido." });
    }

    const payable = await storage.getAccountPayable(orgId, payableId);
    if (!payable) {
      return res.status(404).json({ message: "Conta a pagar nao encontrada." });
    }

    const noteText = typeof payable.notes === "string" ? payable.notes : "";
    const autoMatch = noteText.match(AUTO_PAYABLE_NOTE_REGEX);
    const manualShiftMatch = noteText.match(MANUAL_PAYABLE_SHIFT_ID_REGEX);
    const isAutoGenerated = Boolean(autoMatch);
    const isManualShiftPayable = noteText.includes(MANUAL_SHIFT_PAYABLE_NOTE_PREFIX);
    const parsedManualShiftId = manualShiftMatch?.[1] ? Number(manualShiftMatch[1]) : NaN;
    const manualShiftId = Number.isInteger(parsedManualShiftId) && parsedManualShiftId > 0
      ? parsedManualShiftId
      : null;
    const parsedReferenceMonth = autoMatch?.[1];
    const parsedStaffId = autoMatch?.[3] ? Number(autoMatch[3]) : undefined;
    const referenceMonth = payable.referenceMonth || parsedReferenceMonth || null;
    const resolvedStaffId = payable.staffId ?? parsedStaffId ?? null;

    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let shiftsConsidered: Array<{
      id: number;
      startTime: Date;
      endTime: Date;
      shiftType: ShiftAssignmentType;
      notes?: string | null;
    }> = [];

    if (manualShiftId) {
      const shifts = await storage.getShiftAssignments(orgId, {
        staffId: resolvedStaffId ?? undefined,
      });
      const linkedShift = shifts.find((shift) => shift.id === manualShiftId);
      if (linkedShift) {
        const shiftStart = new Date(linkedShift.startTime);
        const shiftEnd = new Date(linkedShift.endTime);
        periodStart = toDateKey(shiftStart);
        periodEnd = toDateKey(shiftEnd);
        shiftsConsidered = [{
          id: linkedShift.id,
          startTime: shiftStart,
          endTime: shiftEnd,
          shiftType: linkedShift.shiftType as ShiftAssignmentType,
          notes: linkedShift.notes,
        }];
      } else if (payable.dueDate) {
        periodStart = payable.dueDate;
        periodEnd = payable.dueDate;
      }
    } else if (resolvedStaffId && referenceMonth) {
      const [year, monthNumber] = referenceMonth.split("-").map(Number);
      if (Number.isFinite(year) && Number.isFinite(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);
        periodStart = `${referenceMonth}-01`;
        periodEnd = `${referenceMonth}-${String(monthEnd.getDate()).padStart(2, "0")}`;

        const shiftsInMonth = await storage.getShiftAssignments(orgId, {
          staffId: resolvedStaffId,
          start: monthStart,
          end: monthEnd,
        });

        const idsMatch = noteText.match(AUTO_PAYABLE_IDS_REGEX);
        const consideredIds = idsMatch?.[1]
          ? idsMatch[1]
              .split(",")
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value > 0)
          : [];

        if (consideredIds.length > 0) {
          const idSet = new Set(consideredIds);
          shiftsConsidered = shiftsInMonth
            .filter((shift) => idSet.has(shift.id))
            .map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
        } else if (isAutoGenerated) {
          const monthShiftPrefix = `${AUTO_MONTH_NOTE_PREFIX}${referenceMonth}]`;
          shiftsConsidered = shiftsInMonth
            .filter((shift) => typeof shift.notes === "string" && shift.notes.startsWith(monthShiftPrefix))
            .map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
        } else {
          // Lançamentos manuais sem vínculo explícito não devem puxar todos os plantões do mês.
          if (isManualShiftPayable) {
            shiftsConsidered = [];
          }
          if (!isManualShiftPayable) {
            shiftsConsidered = shiftsInMonth.map((shift) => ({
              id: shift.id,
              startTime: new Date(shift.startTime),
              endTime: new Date(shift.endTime),
              shiftType: shift.shiftType as ShiftAssignmentType,
              notes: shift.notes,
            }));
          }
        }

        shiftsConsidered.sort((left, right) => left.startTime.getTime() - right.startTime.getTime());
      }
    }

    const unitMatch = noteText.match(AUTO_PAYABLE_UNIT_REGEX);
    const parsedUnitValue = unitMatch?.[2] ? Number(unitMatch[2]) : NaN;
    const fallbackUnitValue = shiftsConsidered.length > 0
      ? Number(payable.amount ?? 0) / shiftsConsidered.length
      : 0;
    const resolvedUnitValueRaw = Number.isFinite(parsedUnitValue) ? parsedUnitValue : fallbackUnitValue;
    const unitValue = roundMoney(Math.max(0, Number.isFinite(resolvedUnitValueRaw) ? resolvedUnitValueRaw : 0));
    const totalShifts = shiftsConsidered.length;
    const calculatedTotal = roundMoney(unitValue * totalShifts);

    return res.json({
      id: payable.id,
      status: payable.status,
      title: payable.title,
      category: payable.category,
      referenceMonth,
      dueDate: payable.dueDate,
      paidAt: payable.paidAt,
      paymentMethod: payable.paymentMethod,
      notes: payable.notes,
      amount: payable.amount,
      discount: payable.discount ?? 0,
      extra: payable.extra ?? 0,
      isAutoGenerated,
      staffId: resolvedStaffId,
      staffName: payable.staffName ?? null,
      periodStart,
      periodEnd,
      totalShifts,
      unitValue,
      calculatedTotal,
      shifts: shiftsConsidered.map((shift) => ({
        id: shift.id,
        date: toDateKey(shift.startTime),
        startTime: shift.startTime,
        endTime: shift.endTime,
        shiftType: shift.shiftType,
        shiftTypeLabel: SHIFT_TYPE_LABELS[shift.shiftType] ?? shift.shiftType,
        notes: shift.notes ?? null,
      })),
    });
  });
  app.post("/api/accounts-payable", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    res.status(201).json(await storage.createAccountPayable({ ...req.body, organizationId: orgId }));
  });
  app.put("/api/accounts-payable/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    const body = { ...req.body };
    if (body.paidAt && typeof body.paidAt === "string") {
      body.paidAt = new Date(body.paidAt);
    }
    res.json(await storage.updateAccountPayable(orgId, Number(req.params.id), body));
  });
  app.delete("/api/accounts-payable/:id", requireAuth, requireRole(...FINANCIAL_ROLES), async (req, res) => {
    const orgId = getOrgId(req);
    await storage.deleteAccountPayable(orgId, Number(req.params.id));
    res.status(204).send();
  });

  // ===== CRM (KANBAN) =====
  const normalizeLegacyCrmStage = (value: unknown) => {
    if (typeof value !== "string") return value;
    const normalized = value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized === "lost" ? "no_interest" : normalized;
  };
  const CRM_STAGE_KEY_REGEX = /^[a-z0-9_]{2,40}$/;
  const CRM_STAGE_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
  const crmStageSchema = z.preprocess(
    normalizeLegacyCrmStage,
    z.string().regex(CRM_STAGE_KEY_REGEX, "Etapa invalida."),
  );
  const stageUsesLostReason = (stage?: string | null) => stage === "no_interest";
  const getCrmStageValuesFromSettings = (settings: EnvironmentSettings): string[] =>
    settings.crmKanban.stages.map((stage) => stage.value);
  const loadEnvironmentSettingsForOrg = async (orgId: number) => {
    const settingsResult = await getOrganizationEnvironmentSettings(orgId);
    if (!settingsResult) {
      const error = new Error("Organizacao nao encontrada.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }
    return settingsResult;
  };

  const CRM_FOLLOW_UP_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-([0][1-9]|[12]\d|3[01])$/;
  const crmFollowUpTaskSchema = z.object({
    id: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1, "Titulo da tarefa obrigatorio").max(140),
    dueDate: z.string().regex(CRM_FOLLOW_UP_DATE_REGEX, "Data da tarefa invalida. Use YYYY-MM-DD."),
    done: z.boolean().optional().default(false),
    notes: z.string().trim().optional().nullable(),
    assigneeName: z.string().trim().optional().nullable(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional().nullable(),
  });
  const normalizeCrmFollowUpTasks = (tasks: unknown): string => {
    const parsedTasks = z
      .array(crmFollowUpTaskSchema)
      .max(100, "Limite de 100 tarefas de follow-up por oportunidade.")
      .parse(tasks ?? []);
    const nowIso = new Date().toISOString();
    const normalized = parsedTasks.map((task, index) => {
      const parsedCreatedAt = task.createdAt ? new Date(task.createdAt) : null;
      const createdAtIso = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
        ? parsedCreatedAt.toISOString()
        : nowIso;
      const parsedCompletedAt = task.completedAt ? new Date(task.completedAt) : null;
      const completedAtIso = task.done
        ? (parsedCompletedAt && !Number.isNaN(parsedCompletedAt.getTime())
            ? parsedCompletedAt.toISOString()
            : nowIso)
        : null;
      const stableId = task.id && task.id.trim().length > 0
        ? task.id.trim().slice(0, 80)
        : `fu_${Date.now()}_${index + 1}`;
      return {
        id: stableId,
        title: task.title.trim(),
        dueDate: task.dueDate,
        done: Boolean(task.done),
        notes: task.notes?.trim() ? task.notes.trim() : null,
        assigneeName: task.assigneeName?.trim() ? task.assigneeName.trim() : null,
        createdAt: createdAtIso,
        completedAt: completedAtIso,
      };
    });
    return JSON.stringify(normalized);
  };
  const crmCreateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    title: z.string().trim().min(2, "Titulo obrigatorio"),
    contactName: z.string().trim().optional().nullable(),
    contactPhone: z.string().trim().optional().nullable(),
    contactEmail: z.string().trim().optional().nullable(),
    source: z.string().trim().optional().nullable(),
    stage: crmStageSchema.optional(),
    amount: z.coerce.number().min(0).optional().default(0),
    expectedCloseDate: z.string().trim().optional().nullable(),
    ownerId: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    followUpTasks: z.array(crmFollowUpTaskSchema).optional().default([]),
    lostReason: z.string().trim().optional().nullable(),
    position: z.coerce.number().int().min(0).optional().default(0),
  });
  const crmUpdateSchema = crmCreateSchema.partial();
  const crmMoveSchema = z.object({
    stage: crmStageSchema,
    position: z.coerce.number().int().min(0).optional(),
  });
  const crmKanbanStageSchema = z.object({
    value: crmStageSchema,
    label: z.string().trim().min(1).max(80),
    color: z.string().trim().regex(CRM_STAGE_COLOR_REGEX, "Cor invalida. Use #RRGGBB."),
  });
  const crmStagesUpdateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    stages: z.array(crmKanbanStageSchema).min(1).max(20),
  }).superRefine((payload, ctx) => {
    const seen = new Set<string>();
    payload.stages.forEach((stage, index) => {
      const key = stage.value.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages", index, "value"],
          message: "Etapa duplicada.",
        });
      } else {
        seen.add(key);
      }
    });
  });
  const crmFollowUpsUpdateSchema = z.object({
    organizationId: z.coerce.number().int().positive().optional(),
    followUpTasks: z.array(crmFollowUpTaskSchema).max(100),
  });

  app.get("/api/crm/stages", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      res.json({
        stages: settingsResult.settings.crmKanban.stages,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/crm/stages", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const parsed = crmStagesUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const currentSettings = settingsResult.settings;
      const previousStageValues = getCrmStageValuesFromSettings(currentSettings);
      const nextSettings = normalizeEnvironmentSettings({
        ...currentSettings,
        crmKanban: {
          stages: parsed.stages,
        },
      });
      const nextStageValues = getCrmStageValuesFromSettings(nextSettings);
      const fallbackStage = nextStageValues[0];
      const removedStageValues = previousStageValues.filter((stage) => !nextStageValues.includes(stage));

      let migratedCount = 0;
      if (removedStageValues.length > 0 && fallbackStage) {
        migratedCount = await storage.reassignCrmOpportunityStages(orgId, removedStageValues, fallbackStage);
      }

      await storage.updateOrganization(orgId, {
        environmentSettings: JSON.stringify(nextSettings),
      });

      res.json({
        stages: nextSettings.crmKanban.stages,
        migratedCount,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/crm/opportunities", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      const stageRaw = typeof req.query.stage === "string" ? req.query.stage : undefined;
      const stage = stageRaw ? String(normalizeLegacyCrmStage(stageRaw)) : undefined;
      if (stage && !allowedStages.includes(stage)) {
        return res.status(400).json({ message: "Etapa invalida para esta organizacao." });
      }
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const ownerId = req.query.ownerId ? Number(req.query.ownerId) : undefined;
      const opportunities = await storage.getCrmOpportunities(orgId, {
        stage,
        search,
        ownerId: Number.isInteger(ownerId) ? ownerId : undefined,
      });
      res.json(opportunities);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID invalido." });
      }
      const opportunity = await storage.getCrmOpportunity(orgId, opportunityId);
      if (!opportunity) {
        return res.status(404).json({ message: "Oportunidade nao encontrada." });
      }
      res.json(opportunity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/crm/opportunities", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const parsed = crmCreateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      const resolvedStage = parsed.stage ?? allowedStages[0];
      if (!resolvedStage || !allowedStages.includes(resolvedStage)) {
        return res.status(400).json({ message: "Etapa invalida para esta organizacao." });
      }
      const created = await storage.createCrmOpportunity({
        organizationId: orgId,
        title: parsed.title,
        contactName: parsed.contactName || null,
        contactPhone: parsed.contactPhone || null,
        contactEmail: parsed.contactEmail || null,
        source: parsed.source || null,
        stage: resolvedStage,
        amount: parsed.amount,
        expectedCloseDate: parsed.expectedCloseDate || null,
        ownerId: parsed.ownerId ?? null,
        notes: parsed.notes || null,
        followUpTasks: normalizeCrmFollowUpTasks(parsed.followUpTasks),
        lostReason: stageUsesLostReason(resolvedStage) ? (parsed.lostReason || null) : null,
        position: parsed.position,
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID invalido." });
      }

      const parsed = crmUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      if (parsed.stage && !allowedStages.includes(parsed.stage)) {
        return res.status(400).json({ message: "Etapa invalida para esta organizacao." });
      }
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        ...parsed,
        contactName: parsed.contactName === undefined ? undefined : (parsed.contactName || null),
        contactPhone: parsed.contactPhone === undefined ? undefined : (parsed.contactPhone || null),
        contactEmail: parsed.contactEmail === undefined ? undefined : (parsed.contactEmail || null),
        source: parsed.source === undefined ? undefined : (parsed.source || null),
        expectedCloseDate: parsed.expectedCloseDate === undefined ? undefined : (parsed.expectedCloseDate || null),
        ownerId: parsed.ownerId === undefined ? undefined : (parsed.ownerId ?? null),
        notes: parsed.notes === undefined ? undefined : (parsed.notes || null),
        followUpTasks: parsed.followUpTasks === undefined
          ? undefined
          : normalizeCrmFollowUpTasks(parsed.followUpTasks),
        lostReason: stageUsesLostReason(parsed.stage)
          ? (parsed.lostReason === undefined ? undefined : (parsed.lostReason || null))
          : (parsed.stage ? null : undefined),
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/crm/opportunities/:id/stage", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID invalido." });
      }
      const parsed = crmMoveSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, req.body?.organizationId ?? req.query.organizationId);
      const settingsResult = await loadEnvironmentSettingsForOrg(orgId);
      const allowedStages = getCrmStageValuesFromSettings(settingsResult.settings);
      if (!allowedStages.includes(parsed.stage)) {
        return res.status(400).json({ message: "Etapa invalida para esta organizacao." });
      }
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        stage: parsed.stage,
        position: parsed.position,
        lostReason: stageUsesLostReason(parsed.stage) ? undefined : null,
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/crm/opportunities/:id/follow-ups", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID invalido." });
      }
      const parsed = crmFollowUpsUpdateSchema.parse(req.body);
      const orgId = await resolveOrgIdForCrm(req, parsed.organizationId ?? req.query.organizationId);
      const updated = await storage.updateCrmOpportunity(orgId, opportunityId, {
        followUpTasks: normalizeCrmFollowUpTasks(parsed.followUpTasks),
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/crm/opportunities/:id", requireAuth, requireRole(...CRM_ROLES), async (req, res, next) => {
    try {
      const opportunityId = Number(req.params.id);
      if (!Number.isInteger(opportunityId) || opportunityId <= 0) {
        return res.status(400).json({ message: "ID invalido." });
      }
      const orgId = await resolveOrgIdForCrm(req, req.query.organizationId);
      await storage.deleteCrmOpportunity(orgId, opportunityId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ===== STATS =====
  app.get("/api/stats", requireAuth, async (req, res) => {
    const orgId = getOrgId(req);
    res.json(await storage.getDashboardStats(orgId));
  });

  const resolveCurrentMonthKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  };
  const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "sim"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "nao", "não"].includes(normalized)) return false;
    return fallback;
  };
  const parsePositiveIntegerEnv = (value: string | undefined, fallback: number, min: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const intValue = Math.trunc(parsed);
    if (intValue < min) return fallback;
    return intValue;
  };
  const autoMonthlyFeesEnabled = parseBooleanEnv(process.env.MONTHLY_FEES_AUTO_ENABLED, true);
  const autoMonthlyFeesIntervalMinutes = parsePositiveIntegerEnv(
    process.env.MONTHLY_FEES_AUTO_INTERVAL_MINUTES,
    180,
    10,
  );
  let monthlyFeeAutoGenerationRunning = false;
  const runAutoMonthlyFeesGeneration = async (source: "startup" | "interval") => {
    if (monthlyFeeAutoGenerationRunning) return;
    monthlyFeeAutoGenerationRunning = true;
    try {
      const referenceMonth = resolveCurrentMonthKey();
      const organizations = await storage.getOrganizations(true);
      let createdTotal = 0;
      let skippedExistingTotal = 0;
      let activeOrgs = 0;

      for (const organization of organizations) {
        if (normalizeOrgStatus(organization) !== "active") continue;
        activeOrgs++;
        try {
          const summary = await generateMonthlyFeesForOrganizationMonth(organization.id, referenceMonth);
          createdTotal += summary.created;
          skippedExistingTotal += summary.skippedExisting;
        } catch (error) {
          console.error(
            `[monthly-fees:auto] falha na organização ${organization.id} (${organization.name})`,
            error,
          );
        }
      }

      if (createdTotal > 0 || source === "startup") {
        console.log(
          `[monthly-fees:auto:${source}] mês ${referenceMonth} | organizações ativas=${activeOrgs} | criadas=${createdTotal} | já existentes=${skippedExistingTotal}`,
        );
      }
    } catch (error) {
      console.error("[monthly-fees:auto] erro na rotina automática", error);
    } finally {
      monthlyFeeAutoGenerationRunning = false;
    }
  };

  await seedDatabase();
  if (autoMonthlyFeesEnabled) {
    setTimeout(() => {
      void runAutoMonthlyFeesGeneration("startup");
    }, 1_000);

    const autoTimer = setInterval(() => {
      void runAutoMonthlyFeesGeneration("interval");
    }, autoMonthlyFeesIntervalMinutes * 60 * 1_000);
    autoTimer.unref?.();

    console.log(
      `[monthly-fees:auto] habilitado | intervalo=${autoMonthlyFeesIntervalMinutes}min`,
    );
  } else {
    console.log("[monthly-fees:auto] desabilitado por variável de ambiente.");
  }

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

  const org1 = await storage.createOrganization({ name: "Bem Viver ILPI", address: "Rua das Flores, 123 - São Paulo/SP", phone: "(11) 3333-0001", email: "contato@bemviver.com.br", cnpj: "12.345.678/0001-90", capacity: 50, status: "active", active: true });
  const org2 = await storage.createOrganization({ name: "Lar Esperança", address: "Av. das Acácias, 456 - Campinas/SP", phone: "(19) 3333-0002", email: "contato@laresperanca.com.br", cnpj: "98.765.432/0001-10", capacity: 30, status: "active", active: true });

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
  const orgs = await storage.getOrganizations(true);
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

  const orgs = await storage.getOrganizations(true);
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
