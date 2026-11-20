const configuredApiUrl = (process.env.NEXT_PUBLIC_API_URL || "").trim();
// Empty / localhost values route through Next.js same-origin /v1/* rewrites so localhost,
// LAN IPs, Tailscale IPs (100.x.y.z:3030), and Tailscale HTTPS all work without CORS or Mixed Content errors.
export const API_BASE =
  !configuredApiUrl ||
  configuredApiUrl === "same-origin" ||
  configuredApiUrl.includes("localhost") ||
  configuredApiUrl.includes("127.0.0.1")
    ? ""
    : configuredApiUrl.replace(/\/$/, "");
export const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL || "https://sso.cric.ac.th";

export type DocType =
  | "memo"
  | "order"
  | "external"
  | "announcement"
  | "agenda"
  | "minutes"
  | "sp_bundle"
  | "course_syllabus"
  | "lesson_plan"
  | "post_teaching_normal"
  | "post_teaching_online"
  | "custom_template";

export interface TemplateFieldSchema {
  key: string;
  label: string;
  field_type: "text" | "textarea" | "date" | "number" | "select" | "image";
  required: boolean;
  default_value: string;
  options: string[];
  thai_digits: boolean;
  group: "main" | "items";
}

export interface CustomTemplateRecord {
  id: string;
  name: string;
  category: string;
  description: string;
  file_type: "docx" | "xlsx";
  storage_filename: string;
  fields_schema_json: TemplateFieldSchema[];
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SystemTemplateInfo {
  key: string;
  rel_path: string;
  name: string;
  group: string;
  file_type: "docx" | "xlsx";
  min_tables: number;
  min_sheets: number;
  is_overridden: boolean;
  default_exists: boolean;
  file_size_bytes: number;
  updated_at: string;
}

export interface BundleFileInfo {
  key: string;
  label: string;
  filename: string;
  file_type: string;
  file_url: string;
  pdf_url: string;
  page_image_urls: string[];
  pdf_error?: string;
}

export interface BundleRenderResult {
  bundle_files: BundleFileInfo[];
  zip_filename: string;
  zip_url: string;
  merged_pdf_filename?: string;
  merged_pdf_url?: string;
  grand_total?: number;
  grand_total_thai_text?: string;
  item_count?: number;
}

export interface CourseWeeklyItem {
  week: number;
  topic: string;
  subtopics?: string;
  behavioral_objectives?: string;
  activities: string;
  media: string;
  evaluation: string;
  competency: string;
  theory_hours?: number;
  practice_hours?: number;
}

export interface CourseRecord {
  id?: string;
  course_code: string;
  course_name: string;
  curriculum_level: string;
  credits: string;
  semester: string;
  schedule_text: string;
  prerequisite: string;
  reference_text: string;
  department_name: string;
  division_name: string;
  objectives_json?: string[];
  standards_json?: string[];
  objectives?: string[];
  standards?: string[];
  description: string;
  knowledge_json?: string[];
  skills_json?: string[];
  knowledge?: string[];
  skills?: string[];
  weekly_plan_json?: CourseWeeklyItem[];
  weekly_plan?: CourseWeeklyItem[];
  equipment_json?: Array<{ category: string; item: string; purpose: string }>;
  assessment_json?: Array<{ domain: string; weight: string; method: string; criteria: string }>;
  rubric_json?: Array<{ dimension: string; level4: string; level3: string; level2: string; level1: string }>;
  equipment?: Array<{ category: string; item: string; purpose: string }>;
  assessment?: Array<{ domain: string; weight: string; method: string; criteria: string }>;
  rubric?: Array<{ dimension: string; level4: string; level3: string; level2: string; level1: string }>;
  morals?: string[];
  indicators?: string[];
  evaluation_criteria?: string[];
  instructional_strategies?: string[];
  curriculum_analysis?: string;
  qualification_link?: string;
  credit_summary?: string;
  notes?: string[];
  instructor_name: string;
  instructor_phone: string;
  instructor_email?: string;
}

export interface ValidationIssue {
  level: "ERROR" | "WARNING";
  location: string;
  message: string;
}

export interface RenderResult {
  docx_filename: string;
  pdf_filename: string;
  docx_url: string;
  pdf_url: string;
  page_image_urls: string[];
  pdf_error: string;
  font_family: string;
  validation: ValidationIssue[];
  error_count: number;
  warning_count: number;
}

export interface UserProfile {
  id: string;
  sso_subject?: string | null;
  panel_user_id?: string | null;
  username?: string;
  email: string | null;
  full_name: string;
  position_title: string;
  personnel_type?: "TEACHER" | "STAFF";
  division_code: string;
  division_codes?: string[];
  unit_name?: string;
  units?: string[];
  head_units?: string[];
  phone?: string;
  default_reviewer_email?: string;
  role: "drafter" | "unit_head" | "deputy_director" | "director" | "saraban_admin";
  signature_storage_path?: string;
  avatar_url?: string;
  is_active: boolean;
  synced_at?: string;
}

/** Return clean subtitle (email preferred, or normalized @username without duplicate @). */
export function formatUserSubtitle(user?: Pick<UserProfile, "email" | "username"> | null): string {
  if (!user) return "";
  const email = (user.email || "").trim();
  if (email) return email;
  const rawUser = (user.username || "").trim().replace(/^@+/, "");
  if (!rawUser) return "";
  return rawUser.includes("@") ? rawUser : `@${rawUser}`;
}

/** Resolve local (/v1/...) or external avatar URL cleanly for browser <img> rendering. */
export function resolveAvatarSrc(avatarUrl?: string | null): string {
  const raw = (avatarUrl || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/v1/") && API_BASE) {
    return `${API_BASE}${raw}`;
  }
  return raw;
}

export function notifyProfileUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cric-profile-updated"));
  }
}

export interface DocumentRecord {
  id: string;
  doc_type: DocType;
  division_code: string;
  doc_number: string;
  is_circular: boolean;
  speed_level: string;
  secrecy_level: string;
  font_family: string;
  subject: string;
  payload_json: Record<string, unknown>;
  status: string;
  docx_path: string;
  pdf_path: string;
  page_image_urls?: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
  approval_steps?: Array<{
    id: string;
    step_order: number;
    assignee_email: string;
    assignee_role: string;
    action: string;
    comment: string;
    acted_at?: string;
  }>;
}

export interface NotificationRecord {
  id: string;
  recipient_email: string;
  actor_email: string;
  document_id?: string | null;
  event_type: string;
  title: string;
  message: string;
  link_url: string;
  is_read: boolean;
  created_at: string;
}

export function notifyNotificationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("cric-notifications-changed"));
  }
}

export interface DashboardDocItem {
  id: string;
  doc_type: DocType;
  division_code: string;
  doc_number: string;
  subject: string;
  status: string;
  created_by: string;
  updated_at: string;
  docx_path?: string;
  step_role?: string;
}

export interface DashboardSummaryResponse {
  counts: {
    total: number;
    draft: number;
    pending_review: number;
    needs_revision: number;
    pending_approval: number;
    approved: number;
    numbered: number;
  };
  by_type: Array<{ key: string; label: string; count: number }>;
  by_division: Array<{ code: string; count: number }>;
  action_queue: {
    waiting_my_action: DashboardDocItem[];
    my_drafts_or_revisions: DashboardDocItem[];
    waiting_numbering: DashboardDocItem[];
  };
  recent_documents: DashboardDocItem[];
  sequences: Array<NumberSequence & { next_formatted: string }>;
  resources: {
    courses_count: number;
    custom_templates_count: number;
    ai_copilot_enabled: boolean;
  };
  recent_activity: Array<{
    id: number;
    actor_email: string;
    event_type: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface NumberSequence {
  id: number;
  registry_key: string;
  registry_name: string;
  prefix: string;
  year_be: number;
  last_number: number;
  updated_by: string;
  updated_at: string;
}

export interface SecretInfo {
  has_secret: boolean;
  masked_preview: string;
}

export interface OrgProfile {
  organization_name: string;
  address_lines: string[];
  doc_number_prefix: string;
  phone_fax: string;
  esaraban_name: string;
  email: string;
  director: { name: string; title: string };
  sp1_signers?: {
    plan_head: string;
    deputy_plan: string;
    supplies_head: string;
    deputy_resource: string;
  };
  divisions: Record<string, { name: string; deputy_title: string; units?: string[] }>;
}

export interface AdminSettingsResponse {
  org_profile: OrgProfile;
  integrations: {
    sso_issuer: string;
    sso_realm?: string;
    sso_client_id: string;
    sso_client_secret_info: SecretInfo;
    allowed_domain: string;
    auth_dev_mode: boolean;
    panel_api_url: string;
    panel_api_token_info: SecretInfo;
    panel_sync_secret_info?: SecretInfo;
    repair_system_url?: string;
    short_course_url?: string;
    student_screening_url?: string;
    project_system_url?: string;
    evaluation_system_url?: string;
    auto_sync_enabled?: boolean;
    auto_sync_interval_minutes?: number;
    auto_sync_sources?: "panel" | "plan" | "both";
    auto_sync_on_startup?: boolean;
    sync_status?: UserSyncStatus;
  };
  notifications: {
    enabled: boolean;
    provider: string;
    webhook_url_info: SecretInfo;
    telegram_chat_id: string;
    events: string[];
  };
  ai_provider: {
    enabled?: boolean;
    provider: string;
    model: string;
    base_url: string;
    custom_system_prompt: string;
    api_key_info: SecretInfo;
    env_keys: Record<string, boolean>;
  };
  default_font: string;
  auto_preview_default: boolean;
  linter_rules: {
    custom_misspellings: Record<string, string>;
    custom_forbidden_phrases: string[];
  };
}

export interface ServiceItem {
  id: string;
  title: string;
  description?: string;
  url: string;
  iconUrl?: string;
  icon_url?: string | null;
  category?: string;
  allowedRoles?: string[];
  isActive?: boolean;
  is_active?: boolean;
  openInNewTab?: boolean;
  isFavorite?: boolean;
  favoriteOrder?: number;
}

export interface AuditLogEntry {
  id: number;
  document_id?: string | null;
  actor_email: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DiagnosticsInfo {
  db_backend: string;
  libreoffice_available: boolean;
  pdftoppm_available: boolean;
  sarabun_fonts_detected: string[];
  rendered_file_count: number;
  preview_file_count: number;
}

export function getActiveUserEmail(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("cric_user_email") || "";
}

export function setActiveUserEmail(email: string): void {
  if (typeof window !== "undefined") {
    if (email) {
      window.localStorage.setItem("cric_user_email", email);
    } else {
      window.localStorage.removeItem("cric_user_email");
    }
    window.dispatchEvent(new Event("cric-user-changed"));
  }
}

export function getSsoLoginUrl(nextPath = "/"): string {
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  return `${API_BASE}/v1/auth/sso/login?next=${encodeURIComponent(safeNext)}`;
}

function buildAuthHeaders(extraHeaders?: HeadersInit): Headers {
  const headers = new Headers(extraHeaders || {});
  const activeUser = getActiveUserEmail();
  if (activeUser) {
    headers.set("X-User-Email", activeUser);
    headers.set("X-User-Identifier", activeUser);
  }
  return headers;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = buildAuthHeaders(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      detail = err.detail || detail;
    } catch {
      // ignore
    }
    throw new ApiError(resp.status, detail);
  }
  return resp.json() as Promise<T>;
}

export interface TimetableParsedItem {
  course_code: string;
  course_name: string;
  t_hours: number;
  p_hours: number;
  credit_num: number;
  credits: string;
  curriculum_level: string;
  student_group: string;
  total_students: number;
  schedule_text: string;
  room: string;
  semester: string;
  system_type?: "ปกติ" | "ทวิภาคี";
  is_special?: boolean;
  selected?: boolean;
}

export interface TimetableMetadata {
  semester?: string;
  instructor_name?: string;
  department_name?: string;
  major_name?: string;
  curriculum_head_name?: string;
  deputy_academic_name?: string;
  director_name?: string;
}

export interface TimetableParseResponse {
  items: TimetableParsedItem[];
  metadata?: TimetableMetadata;
  source: string;
  warnings: string[];
}

export interface TimetableImportResponse {
  imported: CourseRecord[];
  skipped_count: number;
  courses: CourseRecord[];
}

export interface Sornor02ImportPayload {
  url: string;
  auth_mode: "none" | "cookie" | "credentials";
  username?: string;
  password?: string;
  cookie_header?: string;
  default_semester?: string;
}

export interface UserSyncStatus {
  last_sync_at?: string;
  last_sync_status?: string;
  last_sync_mode?: string;
  panel_count?: number;
  plan_count?: number;
  synced_count?: number;
  sources?: string[];
  last_error?: string;
}

export interface UserSyncResponse {
  source: string;
  sources?: string[];
  panel_count?: number;
  plan_count?: number;
  synced_count: number;
  users: UserProfile[];
  sync_status?: UserSyncStatus;
}

export const api = {
  listServices: (role?: string) =>
    apiFetch<{
      source: string;
      panel_url: string;
      role?: string;
      services: ServiceItem[];
    }>(`/v1/services${role ? `?role=${encodeURIComponent(role)}` : ""}`),
  me: () =>
    apiFetch<{
      user: UserProfile;
      auth_source?: string;
      auth_dev_mode: boolean;
      sso_issuer: string;
      sso_realm?: string;
    }>("/v1/auth/me"),
  logout: async () => {
    const res = await apiFetch<{ ok: boolean; sso_logout_url?: string | null }>("/v1/auth/logout", {
      method: "POST",
    });
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("cric_user_email");
      window.dispatchEvent(new Event("cric-user-changed"));
    }
    return res;
  },
  updateMyProfile: async (body: {
    full_name?: string;
    email?: string;
    position_title?: string;
    personnel_type?: "TEACHER" | "STAFF";
    division_code?: string;
    division_codes?: string[];
    unit_name?: string;
    units?: string[];
    head_units?: string[];
    phone?: string;
    default_reviewer_email?: string;
  }) => {
    const res = await apiFetch<{ user: UserProfile }>("/v1/auth/me", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    notifyProfileUpdated();
    return res;
  },
  getSsoConfig: () =>
    apiFetch<{
      sso_issuer: string;
      sso_realm: string;
      sso_client_id?: string;
      client_configured: boolean;
      allowed_domain: string;
      auth_dev_mode: boolean;
      panel_url?: string;
      login_url: string | null;
      login_endpoint?: string;
      logout_endpoint?: string;
      suggested_redirect_uri?: string;
      suggested_post_logout_uri?: string;
    }>("/v1/auth/sso/config"),
  syncSsoSession: (sessionToken: string) =>
    apiFetch<{ success: boolean; user: UserProfile; token: string }>("/v1/auth/sso/sync-session", {
      method: "POST",
      body: JSON.stringify({ sessionToken }),
    }),
  listUsers: () => apiFetch<{ users: UserProfile[] }>("/v1/auth/users"),
  syncPanelUsers: () => apiFetch<UserSyncResponse>("/v1/auth/sync-panel", { method: "POST" }),
  syncPlanUsers: () => apiFetch<UserSyncResponse>("/v1/auth/sync-plan", { method: "POST" }),
  syncAllUsers: () => apiFetch<UserSyncResponse>("/v1/auth/sync-all", { method: "POST" }),
  getUserSyncStatus: () =>
    apiFetch<{
      auto_sync_enabled: boolean;
      auto_sync_interval_minutes: number;
      auto_sync_sources: "panel" | "plan" | "both";
      auto_sync_on_startup: boolean;
      sync_status: UserSyncStatus;
    }>("/v1/auth/sync-status"),
  uploadSignature: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch<{ ok: boolean; signature_storage_path: string }>("/v1/auth/signature", { method: "POST", body: fd });
    notifyProfileUpdated();
    return res;
  },
  deleteMySignature: async () => {
    const res = await apiFetch<{ ok: boolean }>("/v1/auth/signature", { method: "DELETE" });
    notifyProfileUpdated();
    return res;
  },
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch<{ ok: boolean; avatar_url: string }>("/v1/auth/avatar", { method: "POST", body: fd });
    notifyProfileUpdated();
    return res;
  },
  deleteMyAvatar: async () => {
    const res = await apiFetch<{ ok: boolean }>("/v1/auth/avatar", { method: "DELETE" });
    notifyProfileUpdated();
    return res;
  },
  fetchMySignatureBlobUrl: async (): Promise<string | null> => {
    const resp = await fetch(`${API_BASE}/v1/auth/me/signature?t=${Date.now()}`, {
      credentials: "include",
      headers: buildAuthHeaders(),
      cache: "no-store",
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  },

  validateDoc: (payload: Record<string, unknown>) =>
    apiFetch<{ font_family: string; validation: ValidationIssue[]; error_count: number; warning_count: number }>(
      "/v1/validate",
      { method: "POST", body: JSON.stringify({ payload, convert_pdf: false }) }
    ),
  renderDoc: (payload: Record<string, unknown>, convertPdf = true, previewKey?: string, signal?: AbortSignal) =>
    apiFetch<RenderResult>("/v1/render", {
      method: "POST",
      body: JSON.stringify({ payload, convert_pdf: convertPdf, preview_key: previewKey || null }),
      signal,
    }),

  listDocuments: (status?: string) =>
    apiFetch<{ documents: DocumentRecord[] }>(`/v1/documents${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  getDashboardSummary: () => apiFetch<DashboardSummaryResponse>("/v1/dashboard"),
  listNotifications: (unreadOnly = false, limit = 50) =>
    apiFetch<{ unread_count: number; notifications: NotificationRecord[] }>(
      `/v1/notifications?unread_only=${unreadOnly ? "true" : "false"}&limit=${limit}`
    ),
  markNotificationRead: async (notifId: string) => {
    const res = await apiFetch<{ ok: boolean; unread_count: number }>(
      `/v1/notifications/${encodeURIComponent(notifId)}/read`,
      { method: "POST" }
    );
    notifyNotificationsChanged();
    return res;
  },
  markAllNotificationsRead: async () => {
    const res = await apiFetch<{ ok: boolean; updated: number; unread_count: number }>(
      "/v1/notifications/read-all",
      { method: "POST" }
    );
    notifyNotificationsChanged();
    return res;
  },
  deleteNotification: async (notifId: string) => {
    const res = await apiFetch<{ ok: boolean; unread_count: number }>(
      `/v1/notifications/${encodeURIComponent(notifId)}`,
      { method: "DELETE" }
    );
    notifyNotificationsChanged();
    return res;
  },
  subscribeNotificationStream: (handlers: {
    onSnapshot: (data: { unread_count: number; notifications: NotificationRecord[] }) => void;
    onNotification: (data: { notification: NotificationRecord; unread_count: number }) => void;
    onError?: () => void;
  }) => {
    let closed = false;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      controller = new AbortController();
      try {
        const resp = await fetch(`${API_BASE}/v1/notifications/stream`, {
          credentials: "include",
          headers: buildAuthHeaders({ Accept: "text/event-stream" }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`SSE HTTP ${resp.status}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let eventName = "message";
            const dataLines: string[] = [];
            for (const rawLine of frame.split("\n")) {
              const line = rawLine.replace(/\r$/, "");
              if (!line || line.startsWith(":")) continue;
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
            }
            if (dataLines.length === 0) continue;
            try {
              const parsed = JSON.parse(dataLines.join("\n"));
              if (eventName === "snapshot") handlers.onSnapshot(parsed);
              else if (eventName === "notification") handlers.onNotification(parsed);
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }
      } catch {
        if (!closed) handlers.onError?.();
      }
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller?.abort();
    };
  },
  getDocument: (id: string) =>
    apiFetch<{ document: DocumentRecord; audit_logs: Array<{ id: number; actor_email: string; event_type: string; created_at: string }> }>(`/v1/documents/${id}`),
  saveDocument: (payload: Record<string, unknown>, id?: string) =>
    apiFetch<{ document: DocumentRecord; render: RenderResult }>("/v1/documents", { method: "POST", body: JSON.stringify({ id, payload }) }),
  submitDocument: (id: string, reviewerEmail: string | null, approverEmail: string) =>
    apiFetch<{ document: DocumentRecord }>(`/v1/documents/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ reviewer_email: reviewerEmail || null, approver_email: approverEmail }),
    }),
  approveDocument: (id: string, comment = "", stampSignature = true) =>
    apiFetch<{ document: DocumentRecord; render: RenderResult }>(`/v1/documents/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment, stamp_signature: stampSignature }),
    }),
  returnDocument: (id: string, comment: string) =>
    apiFetch<{ document: DocumentRecord }>(`/v1/documents/${id}/return`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  numberDocument: (id: string, registryKey?: string, yearBe?: number) =>
    apiFetch<{ document: DocumentRecord; render: RenderResult }>(`/v1/documents/${id}/number`, {
      method: "POST",
      body: JSON.stringify({ registry_key: registryKey || null, year_be: yearBe || null }),
    }),

  listSequences: () => apiFetch<{ sequences: NumberSequence[] }>("/v1/registry/sequences"),
  updateSequence: (id: number, body: Partial<Pick<NumberSequence, "registry_name" | "prefix" | "year_be" | "last_number">>) =>
    apiFetch<{ sequence: NumberSequence }>(`/v1/registry/sequences/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  createSequence: (body: { registry_key: string; registry_name: string; prefix: string; year_be: number; last_number: number }) =>
    apiFetch<{ sequence: NumberSequence }>("/v1/registry/sequences", { method: "POST", body: JSON.stringify(body) }),

  getAiSettings: () =>
    apiFetch<{ enabled: boolean; provider: string; model: string; base_url: string; custom_system_prompt?: string; has_custom_key: boolean; env_keys: Record<string, boolean> }>("/v1/ai/settings"),
  toggleAiCopilot: (enabled: boolean) =>
    apiFetch<{ ok: boolean; enabled: boolean }>("/v1/ai/enabled", { method: "PUT", body: JSON.stringify({ enabled }) }),
  updateAiSettings: (body: { provider: string; model: string; base_url: string; api_key?: string; custom_system_prompt?: string; enabled?: boolean }) =>
    apiFetch<{ ok: boolean; enabled: boolean; provider: string; model: string }>("/v1/ai/settings", { method: "PUT", body: JSON.stringify(body) }),
  aiDraft: (body: { doc_type: string; prompt: string; division_name: string; purpose: string; provider_override?: string }) =>
    apiFetch<{ subject: string; paragraphs: string[]; closing_purpose: string; mode: string }>("/v1/ai/draft", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  aiPolish: (body: { paragraphs: string[]; closing_purpose: string; provider_override?: string }) =>
    apiFetch<{ paragraphs: string[]; closing_purpose: string; mode: string }>("/v1/ai/polish", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Admin & Settings
  getPublicSettings: () =>
    apiFetch<{ org_profile: OrgProfile; default_font: string; auto_preview_default: boolean; ai_copilot_enabled: boolean }>("/v1/settings/public"),
  getAdminSettings: () => apiFetch<AdminSettingsResponse>("/v1/settings/admin"),
  updateOrgProfile: (body: OrgProfile) =>
    apiFetch<{ ok: boolean; org_profile: OrgProfile }>("/v1/settings/org-profile", { method: "PUT", body: JSON.stringify(body) }),
  updateIntegrations: (body: {
    sso_issuer: string;
    sso_realm?: string;
    sso_client_id: string;
    sso_client_secret: string;
    allowed_domain: string;
    auth_dev_mode: boolean;
    panel_api_url: string;
    panel_api_token: string;
    panel_sync_secret?: string;
    repair_system_url?: string;
    short_course_url?: string;
    student_screening_url?: string;
    project_system_url?: string;
    evaluation_system_url?: string;
    auto_sync_enabled?: boolean;
    auto_sync_interval_minutes?: number;
    auto_sync_sources?: "panel" | "plan" | "both";
    auto_sync_on_startup?: boolean;
  }) => apiFetch<{ ok: boolean }>("/v1/settings/integrations", { method: "PUT", body: JSON.stringify(body) }),
  testIntegration: (target: "sso" | "panel" | "plan") =>
    apiFetch<{ ok: boolean; status_code: number; latency_ms: number; url?: string; error?: string }>("/v1/settings/integrations/test", {
      method: "POST",
      body: JSON.stringify({ target }),
    }),
  updateNotifications: (body: {
    enabled: boolean;
    provider: string;
    webhook_url: string;
    telegram_chat_id: string;
    events: string[];
  }) => apiFetch<{ ok: boolean }>("/v1/settings/notifications", { method: "PUT", body: JSON.stringify(body) }),
  testNotifications: () => apiFetch<{ ok: boolean; detail: string }>("/v1/settings/notifications/test", { method: "POST" }),
  updateLinterAndDefaults: (body: {
    default_font: string;
    auto_preview_default: boolean;
    custom_misspellings: Record<string, string>;
    custom_forbidden_phrases: string[];
  }) => apiFetch<{ ok: boolean }>("/v1/settings/linter-and-defaults", { method: "PUT", body: JSON.stringify(body) }),
  getAuditLogs: (q = "", limit = 100) =>
    apiFetch<{ logs: AuditLogEntry[] }>(`/v1/settings/audit-logs?q=${encodeURIComponent(q)}&limit=${limit}`),
  getDiagnostics: () => apiFetch<DiagnosticsInfo>("/v1/settings/diagnostics"),
  cleanupPreviews: () => apiFetch<{ ok: boolean; removed: number }>("/v1/settings/cleanup-previews", { method: "POST" }),

  createUser: (body: {
    username?: string;
    email?: string | null;
    full_name: string;
    position_title: string;
    personnel_type?: "TEACHER" | "STAFF";
    division_code: string;
    division_codes?: string[];
    unit_name?: string;
    units?: string[];
    head_units?: string[];
    phone?: string;
    default_reviewer_email?: string;
    role: string;
    is_active: boolean;
  }) => apiFetch<{ user: UserProfile }>("/v1/auth/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (
    identifier: string,
    body: Partial<
      Pick<
        UserProfile,
        | "username"
        | "email"
        | "full_name"
        | "position_title"
        | "personnel_type"
        | "division_code"
        | "division_codes"
        | "unit_name"
        | "units"
        | "head_units"
        | "phone"
        | "default_reviewer_email"
        | "role"
        | "is_active"
      >
    >,
  ) => apiFetch<{ user: UserProfile }>(`/v1/auth/users/${encodeURIComponent(identifier)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteUser: (identifier: string) =>
    apiFetch<{ ok: boolean; deleted: UserProfile }>(`/v1/auth/users/${encodeURIComponent(identifier)}`, {
      method: "DELETE",
    }),
  adminUploadSignature: (identifier: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ ok: boolean; signature_storage_path: string }>(`/v1/auth/users/${encodeURIComponent(identifier)}/signature`, {
      method: "POST",
      body: fd,
    });
  },
  getDivisionLinks: () =>
    apiFetch<{
      links: {
        repair_system_url: string;
        short_course_url: string;
        student_screening_url: string;
        project_system_url: string;
        evaluation_system_url: string;
      };
    }>("/v1/bundles/division-links"),
  renderDivisionForm: (formType: string, payload: Record<string, unknown>, convertPdf = true, previewKey?: string) =>
    apiFetch<{
      form_type: string;
      title: string;
      docx_filename: string;
      docx_url: string;
      pdf_filename: string | null;
      pdf_url: string | null;
      page_image_urls: string[];
    }>("/v1/bundles/forms/render", {
      method: "POST",
      body: JSON.stringify({ form_type: formType, payload, convert_pdf: convertPdf, preview_key: previewKey || null }),
    }),
  saveDivisionForm: (formType: string, divisionCode: string, subject: string, payload: Record<string, unknown>, convertPdf = true) =>
    apiFetch<{ document: DocumentRecord; render: { docx_url: string; pdf_url: string | null; page_image_urls: string[] } }>("/v1/bundles/forms/save", {
      method: "POST",
      body: JSON.stringify({ form_type: formType, division_code: divisionCode, subject, payload, convert_pdf: convertPdf }),
    }),
  listQaTools: () =>
    apiFetch<{
      tools: Array<{
        code: string;
        title: string;
        filename: string;
        division_code: string;
        division_name: string;
        unit_name: string;
      }>;
    }>("/v1/bundles/qa-tools"),
  getQaToolSchema: (code: string) =>
    apiFetch<{
      code: string;
      title: string;
      division_code: string;
      division_name: string;
      unit_name: string;
      table_count: number;
      tables: Array<{
        t_idx: number;
        caption: string;
        headers: string[];
        col_types: string[];
        rows: Array<{
          r_idx: number;
          cells: Array<{
            key: string;
            c_idx: number;
            type: "checkbox" | "text";
            value: string;
            editable: boolean;
          }>;
        }>;
      }>;
    }>(`/v1/bundles/qa-tools/${encodeURIComponent(code)}`),
  renderQaTool: (code: string, payload: Record<string, unknown>, convertPdf = true, previewKey?: string) =>
    apiFetch<{
      code: string;
      title: string;
      docx_filename: string;
      docx_url: string;
      pdf_filename: string | null;
      pdf_url: string | null;
      page_image_urls: string[];
    }>(`/v1/bundles/qa-tools/${encodeURIComponent(code)}/render`, {
      method: "POST",
      body: JSON.stringify({ payload, convert_pdf: convertPdf, preview_key: previewKey || null }),
    }),
  saveQaTool: (code: string, subject: string, payload: Record<string, unknown>, convertPdf = true) =>
    apiFetch<{ document: DocumentRecord; render: { docx_url: string; pdf_url: string | null; page_image_urls: string[] } }>(
      `/v1/bundles/qa-tools/${encodeURIComponent(code)}/save`,
      {
        method: "POST",
        body: JSON.stringify({ subject, payload, convert_pdf: convertPdf }),
      }
    ),

  // Courses & Bundles (สผ 2-69 + แผนการสอน 2-69)
  listCourses: (mineOnly = false) =>
    apiFetch<{ courses: CourseRecord[] }>(`/v1/courses${mineOnly ? "?mine_only=true" : ""}`),
  getTimetableTemplateUrl: () => `${API_BASE}/v1/courses/timetable-template`,
  parseTimetable: (formData: FormData) =>
    apiFetch<TimetableParseResponse>("/v1/courses/parse-timetable", {
      method: "POST",
      body: formData,
    }),
  importSornor02: (payload: Sornor02ImportPayload) =>
    apiFetch<TimetableParseResponse>("/v1/courses/import-sornor02", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importCourses: (items: TimetableParsedItem[]) =>
    apiFetch<TimetableImportResponse>("/v1/courses/import", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  saveCourse: (body: CourseRecord) =>
    apiFetch<{ course: CourseRecord }>("/v1/courses", { method: "POST", body: JSON.stringify(body) }),
  deleteCourse: (courseId: string) =>
    apiFetch<{ ok: boolean }>(`/v1/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" }),

  renderSpBundle: (payload: Record<string, unknown>, convertPdf = true, previewKey?: string) =>
    apiFetch<BundleRenderResult>("/v1/bundles/sp/render", {
      method: "POST",
      body: JSON.stringify({ payload, convert_pdf: convertPdf, preview_key: previewKey || null }),
    }),
  saveSpBundle: (payload: Record<string, unknown>, divisionCode = "ฝว.", subject?: string, id?: string) =>
    apiFetch<{ document: DocumentRecord; render: BundleRenderResult }>("/v1/bundles/sp/save", {
      method: "POST",
      body: JSON.stringify({ id: id || null, division_code: divisionCode, subject: subject || null, payload }),
    }),

  renderTeachingBundle: (docType: DocType, payload: Record<string, unknown>, convertPdf = true, previewKey?: string) =>
    apiFetch<BundleRenderResult>("/v1/bundles/teaching/render", {
      method: "POST",
      body: JSON.stringify({ doc_type: docType, payload, convert_pdf: convertPdf, preview_key: previewKey || null }),
    }),
  saveTeachingBundle: (docType: DocType, payload: Record<string, unknown>, divisionCode = "ฝว.", subject?: string, id?: string) =>
    apiFetch<{ document: DocumentRecord; render: BundleRenderResult }>("/v1/bundles/teaching/save", {
      method: "POST",
      body: JSON.stringify({ id: id || null, doc_type: docType, division_code: divisionCode, subject: subject || null, payload }),
    }),
  uploadTeachingPhoto: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ filename: string; original_name: string }>("/v1/bundles/teaching/upload-photo", {
      method: "POST",
      body: fd,
    });
  },
  submitBundle: (docId: string, reviewerEmail: string | null, approverEmail: string) =>
    apiFetch<{ document: DocumentRecord }>(`/v1/bundles/${docId}/submit`, {
      method: "POST",
      body: JSON.stringify({ reviewer_email: reviewerEmail || null, approver_email: approverEmail }),
    }),

  aiDraftSp: (body: { project_name: string; department_name: string; budget_hint?: number; prompt?: string }) =>
    apiFetch<{
      objectives: string[];
      expected_outcome: string;
      tor_background: string;
      tor_objective: string;
      items: Array<{ name: string; spec: string; qty: number; unit: string; unit_price: number; note: string }>;
      mode: string;
    }>("/v1/ai/draft-sp", { method: "POST", body: JSON.stringify(body) }),
  aiDraftTeaching: (body: {
    mode: "course_plan" | "post_teaching";
    course_code?: string;
    course_name?: string;
    curriculum_level?: string;
    description?: string;
    prompt?: string;
  }) =>
    apiFetch<Record<string, unknown>>("/v1/ai/draft-teaching", { method: "POST", body: JSON.stringify(body) }),
  aiFillTemplate: (body: {
    template_id?: string;
    template_name: string;
    fields_schema: TemplateFieldSchema[];
    prompt: string;
  }) =>
    apiFetch<{ fields: Record<string, unknown>; items: Array<Record<string, unknown>>; mode: string }>("/v1/ai/fill-template", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Custom & System Document Templates
  listCustomTemplates: (includeInactive = false) =>
    apiFetch<{ templates: CustomTemplateRecord[] }>(`/v1/templates/custom${includeInactive ? "?include_inactive=true" : ""}`),
  getCustomTemplate: (id: string) =>
    apiFetch<{ template: CustomTemplateRecord }>(`/v1/templates/custom/${encodeURIComponent(id)}`),
  createCustomTemplate: (
    file: File,
    meta: { name: string; category: string; description: string; is_active: boolean },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", meta.name);
    fd.append("category", meta.category);
    fd.append("description", meta.description);
    fd.append("is_active", String(meta.is_active));
    return apiFetch<{ template: CustomTemplateRecord; detected_count: number }>("/v1/templates/custom", {
      method: "POST",
      body: fd,
    });
  },
  updateCustomTemplate: (
    id: string,
    body: {
      name?: string;
      category?: string;
      description?: string;
      is_active?: boolean;
      fields_schema?: TemplateFieldSchema[];
    },
  ) =>
    apiFetch<{ template: CustomTemplateRecord }>(`/v1/templates/custom/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  replaceCustomTemplateFile: (id: string, file: File, rescan = true) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("rescan", String(rescan));
    return apiFetch<{ template: CustomTemplateRecord; detected_count: number }>(
      `/v1/templates/custom/${encodeURIComponent(id)}/file`,
      { method: "POST", body: fd },
    );
  },
  deleteCustomTemplate: (id: string) =>
    apiFetch<{ ok: boolean }>(`/v1/templates/custom/${encodeURIComponent(id)}`, { method: "DELETE" }),
  downloadWithAuth: async (path: string, fallbackFilename: string) => {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: buildAuthHeaders(),
    });
    if (!res.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fallbackFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  uploadCustomTemplateImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ filename: string; original_name: string }>(`/v1/templates/custom/${encodeURIComponent(id)}/upload-image`, {
      method: "POST",
      body: fd,
    });
  },
  renderCustomTemplate: (id: string, data: Record<string, unknown>, convertPdf = true, previewKey?: string) =>
    apiFetch<RenderResult & { file_type: string }>(`/v1/templates/custom/${encodeURIComponent(id)}/render`, {
      method: "POST",
      body: JSON.stringify({ data, convert_pdf: convertPdf, preview_key: previewKey || null }),
    }),
  saveCustomTemplateDoc: (
    id: string,
    body: { id?: string; division_code: string; subject?: string; data: Record<string, unknown> },
  ) =>
    apiFetch<{ document: DocumentRecord; render: RenderResult & { file_type: string } }>(
      `/v1/templates/custom/${encodeURIComponent(id)}/save`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  batchCustomTemplate: (id: string, file: File, includePdf: boolean) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("include_pdf", String(includePdf));
    return apiFetch<{
      count: number;
      include_pdf: boolean;
      zip_filename: string;
      zip_url: string;
      items: Array<{ row: string; filename: string; pdf: string }>;
    }>(`/v1/templates/custom/${encodeURIComponent(id)}/batch`, { method: "POST", body: fd });
  },

  listSystemTemplates: () => apiFetch<{ templates: SystemTemplateInfo[] }>("/v1/templates/system"),
  previewSystemTemplate: (key: string) =>
    apiFetch<{
      key: string;
      name: string;
      file_type: string;
      docx_url: string;
      pdf_url: string;
      page_image_urls: string[];
      pdf_error: string;
    }>(`/v1/templates/system/${encodeURIComponent(key)}/preview`, { method: "POST" }),
  uploadSystemTemplateOverride: (key: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ ok: boolean; template: SystemTemplateInfo }>(`/v1/templates/system/${encodeURIComponent(key)}/upload`, {
      method: "POST",
      body: fd,
    });
  },
  resetSystemTemplateOverride: (key: string) =>
    apiFetch<{ ok: boolean; removed_override: boolean; template: SystemTemplateInfo }>(
      `/v1/templates/system/${encodeURIComponent(key)}/reset`,
      { method: "POST" },
    ),
};
