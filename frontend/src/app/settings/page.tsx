"use client";

import { useEffect, useState } from "react";
import { Layers, X } from "lucide-react";
import { AdminTemplatesTab } from "@/components/AdminTemplatesTab";
import { AdminUsersTab } from "@/components/AdminUsersTab";
import { confirmAction, confirmDanger, toastError, toastSuccess } from "@/lib/swal";
import {
  Activity,
  Bell,
  Building2,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  AdminSettingsResponse,
  api,
  AuditLogEntry,
  DiagnosticsInfo,
  OrgProfile,
  UserProfile,
} from "@/lib/api";

type TabId = "org" | "users" | "integrations" | "ai_linter" | "templates" | "audit";

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "org", label: "หน่วยงาน & ฝ่ายงาน", icon: Building2 },
  { id: "users", label: "บุคลากร & ลายเซ็น", icon: Users },
  { id: "integrations", label: "SSO, Panel & แจ้งเตือน", icon: Link2 },
  { id: "ai_linter", label: "AI, ฟอนต์ & กฎตรวจคำ", icon: Sparkles },
  { id: "templates", label: "แม่แบบเอกสาร", icon: Layers },
  { id: "audit", label: "Audit Logs & สถานะระบบ", icon: Activity },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("org");
  const [forbidden, setForbidden] = useState(false);
  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // Admin data
  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [newDivCode, setNewDivCode] = useState("");
  const [newDivName, setNewDivName] = useState("");
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});

  // Users
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  // Integrations & Notifications
  const [ssoIssuer, setSsoIssuer] = useState("https://sso.cric.ac.th/realms/cric-college");
  const [ssoRealm, setSsoRealm] = useState("cric-college");
  const [ssoClientId, setSsoClientId] = useState("cric-edocx");
  const [ssoClientSecret, setSsoClientSecret] = useState("");
  const [allowedDomain, setAllowedDomain] = useState("cric.ac.th");
  const [authDevMode, setAuthDevMode] = useState(true);
  const [panelUrl, setPanelUrl] = useState("http://localhost:3000");
  const [panelToken, setPanelToken] = useState("");
  const [panelSyncSecret, setPanelSyncSecret] = useState("");
  const [repairUrl, setRepairUrl] = useState("");
  const [shortCourseUrl, setShortCourseUrl] = useState("");
  const [screeningUrl, setScreeningUrl] = useState("");
  const [projectSysUrl, setProjectSysUrl] = useState("https://plan.cric.ac.th");
  const [evalSysUrl, setEvalSysUrl] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [autoSyncInterval, setAutoSyncInterval] = useState(30);
  const [autoSyncSources, setAutoSyncSources] = useState<"panel" | "plan" | "both">("both");
  const [autoSyncOnStartup, setAutoSyncOnStartup] = useState(true);
  const [ssoRedirectHint, setSsoRedirectHint] = useState("");
  const [ssoLogoutHint, setSsoLogoutHint] = useState("");

  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifProvider, setNotifProvider] = useState("custom_webhook");
  const [notifWebhookUrl, setNotifWebhookUrl] = useState("");
  const [notifChatId, setNotifChatId] = useState("");
  const [notifEvents, setNotifEvents] = useState<string[]>(["submitted", "approved", "returned", "numbered"]);

  // AI & Linter & Defaults
  const [aiEnabled, setAiEnabled] = useState(true);
  const [togglingAi, setTogglingAi] = useState(false);
  const [aiProvider, setAiProvider] = useState("gemini");
  const [aiModel, setAiModel] = useState("gemini-2.5-flash");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiCustomPrompt, setAiCustomPrompt] = useState("");
  const [defaultFont, setDefaultFont] = useState("TH Sarabun New");
  const [autoPreviewDefault, setAutoPreviewDefault] = useState(true);
  const [misspellingsText, setMisspellingsText] = useState("");
  const [forbiddenText, setForbiddenText] = useState("");

  // Audit & Diagnostics
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [diag, setDiag] = useState<DiagnosticsInfo | null>(null);

  async function loadAll() {
    setErrMsg("");
    setForbidden(false);
    try {
      const [adm, usrRes, logRes, diagRes, ssoCfgRes, meRes] = await Promise.all([
        api.getAdminSettings(),
        api.listUsers(),
        api.getAuditLogs(logQuery),
        api.getDiagnostics(),
        api.getSsoConfig().catch(() => null),
        api.me().catch(() => null),
      ]);
      if (meRes?.user?.email) setCurrentUserEmail(meRes.user.email);
      setSettings(adm);
      if (ssoCfgRes?.suggested_redirect_uri) setSsoRedirectHint(ssoCfgRes.suggested_redirect_uri);
      if (ssoCfgRes?.suggested_post_logout_uri) setSsoLogoutHint(ssoCfgRes.suggested_post_logout_uri);
      setOrg(adm.org_profile);

      setSsoIssuer(adm.integrations.sso_issuer);
      setSsoRealm(adm.integrations.sso_realm || "cric-college");
      setSsoClientId(adm.integrations.sso_client_id);
      setAllowedDomain(adm.integrations.allowed_domain);
      setAuthDevMode(adm.integrations.auth_dev_mode);
      setPanelUrl(adm.integrations.panel_api_url);
      setRepairUrl(adm.integrations.repair_system_url || "");
      setShortCourseUrl(adm.integrations.short_course_url || "");
      setScreeningUrl(adm.integrations.student_screening_url || "");
      setProjectSysUrl(adm.integrations.project_system_url || "https://plan.cric.ac.th");
      setEvalSysUrl(adm.integrations.evaluation_system_url || "");
      setAutoSyncEnabled(adm.integrations.auto_sync_enabled ?? true);
      setAutoSyncInterval(adm.integrations.auto_sync_interval_minutes ?? 30);
      setAutoSyncSources(adm.integrations.auto_sync_sources || "both");
      setAutoSyncOnStartup(adm.integrations.auto_sync_on_startup ?? true);

      setNotifEnabled(adm.notifications.enabled);
      setNotifProvider(adm.notifications.provider);
      setNotifChatId(adm.notifications.telegram_chat_id);
      setNotifEvents(adm.notifications.events);

      setAiEnabled(adm.ai_provider.enabled !== false);
      setAiProvider(adm.ai_provider.provider);
      setAiModel(adm.ai_provider.model);
      setAiBaseUrl(adm.ai_provider.base_url);
      setAiCustomPrompt(adm.ai_provider.custom_system_prompt || "");
      setDefaultFont(adm.default_font);
      setAutoPreviewDefault(adm.auto_preview_default);

      const mPairs = Object.entries(adm.linter_rules.custom_misspellings || {}).map(([k, v]) => `${k}=${v}`);
      setMisspellingsText(mPairs.join("\n"));
      setForbiddenText((adm.linter_rules.custom_forbidden_phrases || []).join("\n"));

      setUsers(usrRes.users);
      setLogs(logRes.logs);
      setDiag(diagRes);
    } catch (err) {
      const m = err instanceof Error ? err.message : "โหลดการตั้งค่าไม่สำเร็จ";
      if (m.includes("เฉพาะเจ้าหน้าที่สารบรรณ") || m.includes("403")) {
        setForbidden(true);
      } else {
        setErrMsg(m);
      }
    }
  }

  useEffect(() => {
    loadAll();
    const handler = () => loadAll();
    window.addEventListener("cric-user-changed", handler);
    return () => window.removeEventListener("cric-user-changed", handler);
  }, []);

  async function saveOrg() {
    if (!org) return;
    setMsg("");
    setErrMsg("");
    try {
      await api.updateOrgProfile(org);
      const m = "บันทึกข้อมูลหน่วยงาน ผู้บริหาร และฝ่ายงานเรียบร้อยแล้ว";
      setMsg(m);
      toastSuccess("บันทึกข้อมูลหน่วยงานแล้ว");
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกข้อมูลหน่วยงานไม่สำเร็จ", m);
    }
  }

  async function handleDeleteDivision(code: string, divName: string) {
    if (!org) return;
    const ok = await confirmDanger({
      title: `ลบฝ่ายงาน "${code} ${divName}"?`,
      text: "รายชื่อฝ่ายงานนี้จะถูกลบออกจากตัวเลือกแบบฟอร์ม (กรุณากดบันทึกข้อมูลหน่วยงานเพื่อยืนยันถาวร)",
      confirmText: "ลบฝ่ายงาน",
    });
    if (!ok) return;
    const copy = { ...org.divisions };
    delete copy[code];
    setOrg({ ...org, divisions: copy });
    toastSuccess(`นำฝ่ายงาน ${code} ออกจากรายการแล้ว`, "อย่าลืมกดบันทึกข้อมูลหน่วยงานด้านล่าง");
  }

  async function saveIntegrations(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErrMsg("");
    try {
      await api.updateIntegrations({
        sso_issuer: ssoIssuer,
        sso_realm: ssoRealm,
        sso_client_id: ssoClientId,
        sso_client_secret: ssoClientSecret,
        allowed_domain: allowedDomain,
        auth_dev_mode: authDevMode,
        panel_api_url: panelUrl,
        panel_api_token: panelToken,
        panel_sync_secret: panelSyncSecret,
        repair_system_url: repairUrl,
        short_course_url: shortCourseUrl,
        student_screening_url: screeningUrl,
        project_system_url: projectSysUrl,
        evaluation_system_url: evalSysUrl,
        auto_sync_enabled: autoSyncEnabled,
        auto_sync_interval_minutes: autoSyncInterval,
        auto_sync_sources: autoSyncSources,
        auto_sync_on_startup: autoSyncOnStartup,
      });
      setSsoClientSecret("");
      setPanelToken("");
      setPanelSyncSecret("");
      setMsg("บันทึกการตั้งค่า SSO และ Panel เรียบร้อยแล้ว");
      toastSuccess("บันทึกการเชื่อมต่อ SSO / Panel แล้ว");
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกการเชื่อมต่อไม่สำเร็จ", m);
    }
  }

  async function handleTestConn(target: "sso" | "panel" | "plan") {
    setMsg("");
    setErrMsg("");
    const res = await api.testIntegration(target);
    if (res.ok) {
      const m = `เชื่อมต่อ ${target.toUpperCase()} สำเร็จ (HTTP ${res.status_code}, ${res.latency_ms} ms)`;
      setMsg(m);
      toastSuccess(`เชื่อมต่อ ${target.toUpperCase()} สำเร็จ`, `${res.latency_ms} ms`);
    } else {
      const m = `เชื่อมต่อ ${target.toUpperCase()} ไม่สำเร็จ: ${res.error || `HTTP ${res.status_code}`}`;
      setErrMsg(m);
      toastError(`เชื่อมต่อ ${target.toUpperCase()} ไม่สำเร็จ`, res.error || `HTTP ${res.status_code}`);
    }
  }

  async function saveNotifications(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErrMsg("");
    try {
      await api.updateNotifications({
        enabled: notifEnabled,
        provider: notifProvider,
        webhook_url: notifWebhookUrl,
        telegram_chat_id: notifChatId,
        events: notifEvents,
      });
      setNotifWebhookUrl("");
      setMsg("บันทึกการตั้งค่าการแจ้งเตือน Webhook เรียบร้อยแล้ว");
      toastSuccess("บันทึกการตั้งค่าแจ้งเตือนแล้ว");
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกการแจ้งเตือนไม่สำเร็จ", m);
    }
  }

  async function handleTestNotif() {
    setMsg("");
    setErrMsg("");
    const res = await api.testNotifications();
    if (res.ok) {
      const m = `ส่งข้อความทดสอบ Webhook สำเร็จ (${res.detail})`;
      setMsg(m);
      toastSuccess("ส่งข้อความทดสอบ Webhook สำเร็จ");
    } else {
      const m = `ทดสอบ Webhook ไม่สำเร็จ: ${res.detail}`;
      setErrMsg(m);
      toastError("ทดสอบ Webhook ไม่สำเร็จ", res.detail);
    }
  }

  async function handleToggleAiCopilot(nextEnabled: boolean) {
    if (!nextEnabled) {
      const ok = await confirmAction({
        title: "ปิดใช้งาน AI Co-pilot ชั่วคราว?",
        text: "ผู้ใช้ทั้งหมดจะไม่เห็นปุ่มผู้ช่วยร่าง AI และ API ที่เกี่ยวกับ AI จะถูกปิดชั่วคราว จนกว่าผู้ดูแลระบบจะเปิดใช้งานอีกครั้ง",
        confirmText: "ยืนยันปิดใช้งาน",
        icon: "warning",
      });
      if (!ok) return;
    }
    setTogglingAi(true);
    setMsg("");
    setErrMsg("");
    try {
      const res = await api.toggleAiCopilot(nextEnabled);
      setAiEnabled(res.enabled);
      const m = res.enabled
        ? "เปิดใช้งาน AI Co-pilot สำหรับผู้ใช้ทุกคนแล้ว"
        : "ปิดใช้งาน AI Co-pilot ชั่วคราวเรียบร้อยแล้ว";
      setMsg(m);
      toastSuccess(res.enabled ? "เปิดใช้งาน AI Co-pilot แล้ว" : "ปิดใช้งาน AI Co-pilot แล้ว");
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "สลับสถานะ AI Co-pilot ไม่สำเร็จ";
      setErrMsg(m);
      toastError("สลับสถานะ AI Co-pilot ไม่สำเร็จ", m);
    } finally {
      setTogglingAi(false);
    }
  }

  async function saveAiAndLinter(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErrMsg("");
    try {
      await api.updateAiSettings({
        enabled: aiEnabled,
        provider: aiProvider,
        model: aiModel,
        base_url: aiBaseUrl,
        api_key: aiKey,
        custom_system_prompt: aiCustomPrompt,
      });
      const misspellingMap: Record<string, string> = {};
      misspellingsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line) => {
          const [w, r] = line.split("=").map((s) => s.trim());
          if (w && r) misspellingMap[w] = r;
        });
      const forbiddenList = forbiddenText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await api.updateLinterAndDefaults({
        default_font: defaultFont,
        auto_preview_default: autoPreviewDefault,
        custom_misspellings: misspellingMap,
        custom_forbidden_phrases: forbiddenList,
      });
      setAiKey("");
      setMsg("บันทึกตั้งค่า AI, ฟอนต์เริ่มต้น และกฎตรวจคำเรียบร้อยแล้ว");
      toastSuccess("บันทึกการตั้งค่า AI และกฎตรวจคำแล้ว");
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกการตั้งค่า AI ไม่สำเร็จ", m);
    }
  }

  async function handleCleanupPreviews() {
    const ok = await confirmDanger({
      title: "ล้างไฟล์พรีวิวชั่วคราว?",
      text: "ไฟล์ตัวอย่างพรีวิวชั่วคราว (.png/.pdf/.docx) จะถูกล้างออกจากดิสก์เพื่อคืนพื้นที่ (ไม่กระทบเอกสารที่บันทึกไว้)",
      confirmText: "ล้างไฟล์ชั่วคราว",
    });
    if (!ok) return;
    const res = await api.cleanupPreviews();
    const m = `ล้างไฟล์พรีวิวชั่วคราวแล้ว ${res.removed} ไฟล์`;
    setMsg(m);
    toastSuccess("ล้างไฟล์พรีวิวชั่วคราวแล้ว", `${res.removed} ไฟล์`);
    const d = await api.getDiagnostics();
    setDiag(d);
  }

  if (forbidden) {
    return (
      <div className="ledger-panel mx-auto max-w-xl border-amber-300 bg-amber-50 p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-700" />
        <h2 className="text-base font-bold text-amber-950">จำกัดสิทธิ์เฉพาะผู้ดูแลระบบหลังบ้าน</h2>
        <p className="mt-1 text-sm text-amber-900">
          บัญชีปัจจุบันไม่มีสิทธิ์เข้าถึงหน้าตั้งค่าระบบ (ต้องใช้บทบาท <code>saraban_admin</code> หรือ <code>director</code>)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Crisp Underline Navigation Strip */}
      <div className="ledger-panel overflow-x-auto">
        <div className="flex min-w-max items-center border-b border-[#E2E8F0] px-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  active
                    ? "border-[#1D4ED8] text-[#1E3A8A]"
                    : "border-transparent text-[#475569] hover:text-[#0F172A]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {msg && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900">{msg}</div>}
      {errMsg && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-[#991B1B]">{errMsg}</div>}

      {/* TAB 1: Organization & Divisions */}
      {tab === "org" && org && (
        <section className="ledger-panel overflow-hidden">
          <div className="ledger-panel-header">
            <h2 className="text-sm font-bold text-[#0F172A]">ข้อมูลหน่วยงาน ผู้บริหาร และฝ่ายงาน</h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ชื่อหน่วยงาน / สถานศึกษา</label>
                <input
                  type="text"
                  value={org.organization_name}
                  onChange={(e) => setOrg({ ...org, organization_name: e.target.value })}
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">คำนำหน้าเลขหนังสือส่งออก</label>
                <input
                  type="text"
                  value={org.doc_number_prefix}
                  onChange={(e) => setOrg({ ...org, doc_number_prefix: e.target.value })}
                  className="ledger-input tabular-nums-th"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ที่อยู่บรรทัดที่ 1</label>
                <input
                  type="text"
                  value={org.address_lines[0] || ""}
                  onChange={(e) => setOrg({ ...org, address_lines: [e.target.value, org.address_lines[1] || ""] })}
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ที่อยู่บรรทัดที่ 2</label>
                <input
                  type="text"
                  value={org.address_lines[1] || ""}
                  onChange={(e) => setOrg({ ...org, address_lines: [org.address_lines[0] || "", e.target.value] })}
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">โทร/โทรสาร</label>
                <input
                  type="text"
                  value={org.phone_fax}
                  onChange={(e) => setOrg({ ...org, phone_fax: e.target.value })}
                  className="ledger-input tabular-nums-th"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">อีเมลสารบรรณ</label>
                <input
                  type="text"
                  value={org.email}
                  onChange={(e) => setOrg({ ...org, email: e.target.value })}
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ชื่อผู้อำนวยการ / ผู้ลงนามหลัก</label>
                <input
                  type="text"
                  value={org.director.name}
                  onChange={(e) => setOrg({ ...org, director: { ...org.director, name: e.target.value } })}
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ตำแหน่งผู้ลงนามหลัก</label>
                <input
                  type="text"
                  value={org.director.title}
                  onChange={(e) => setOrg({ ...org, director: { ...org.director, title: e.target.value } })}
                  className="ledger-input"
                />
              </div>
            </div>

            <div className="border-t border-[#E2E8F0] pt-4">
              <h3 className="mb-2 text-xs font-bold text-[#0F172A]">ผู้ลงนามมาตรฐานในแบบ สผ.1 (กรอบความเห็น ข้อ 3–6)</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ข้อ 3 หัวหน้างานพัฒนายุทธศาสตร์ แผนงาน และงบประมาณ</label>
                  <input
                    type="text"
                    value={org.sp1_signers?.plan_head || ""}
                    onChange={(e) =>
                      setOrg({
                        ...org,
                        sp1_signers: {
                          plan_head: e.target.value,
                          deputy_plan: org.sp1_signers?.deputy_plan || "",
                          supplies_head: org.sp1_signers?.supplies_head || "",
                          deputy_resource: org.sp1_signers?.deputy_resource || "",
                        },
                      })
                    }
                    className="ledger-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ข้อ 4 รองผู้อำนวยการฝ่ายยุทธศาสตร์และแผนงาน</label>
                  <input
                    type="text"
                    value={org.sp1_signers?.deputy_plan || ""}
                    onChange={(e) =>
                      setOrg({
                        ...org,
                        sp1_signers: {
                          plan_head: org.sp1_signers?.plan_head || "",
                          deputy_plan: e.target.value,
                          supplies_head: org.sp1_signers?.supplies_head || "",
                          deputy_resource: org.sp1_signers?.deputy_resource || "",
                        },
                      })
                    }
                    className="ledger-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ข้อ 5 หัวหน้างานพัสดุ</label>
                  <input
                    type="text"
                    value={org.sp1_signers?.supplies_head || ""}
                    onChange={(e) =>
                      setOrg({
                        ...org,
                        sp1_signers: {
                          plan_head: org.sp1_signers?.plan_head || "",
                          deputy_plan: org.sp1_signers?.deputy_plan || "",
                          supplies_head: e.target.value,
                          deputy_resource: org.sp1_signers?.deputy_resource || "",
                        },
                      })
                    }
                    className="ledger-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ข้อ 6 รองผู้อำนวยการฝ่ายบริหารทรัพยากร</label>
                  <input
                    type="text"
                    value={org.sp1_signers?.deputy_resource || ""}
                    onChange={(e) =>
                      setOrg({
                        ...org,
                        sp1_signers: {
                          plan_head: org.sp1_signers?.plan_head || "",
                          deputy_plan: org.sp1_signers?.deputy_plan || "",
                          supplies_head: org.sp1_signers?.supplies_head || "",
                          deputy_resource: e.target.value,
                        },
                      })
                    }
                    className="ledger-input"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-[#E2E8F0] pt-4">
              <h3 className="mb-2 text-xs font-bold text-[#0F172A]">รายชื่อฝ่ายงาน รหัสย่อ และงาน/แผนกวิชาในสังกัด</h3>
              <div className="space-y-3">
                {Object.entries(org.divisions).map(([code, info]) => {
                  const divUnits = info.units || [];
                  const draftUnit = unitDrafts[code] || "";
                  return (
                    <div key={code} className="space-y-2.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                        <div className="sm:col-span-2">
                          <input type="text" value={code} disabled className="ledger-input bg-slate-100 py-1.5 text-xs font-bold" />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            value={info.name}
                            onChange={(e) =>
                              setOrg({
                                ...org,
                                divisions: { ...org.divisions, [code]: { ...info, name: e.target.value } },
                              })
                            }
                            className="ledger-input py-1.5 text-xs"
                          />
                        </div>
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            value={info.deputy_title}
                            onChange={(e) =>
                              setOrg({
                                ...org,
                                divisions: { ...org.divisions, [code]: { ...info, deputy_title: e.target.value } },
                              })
                            }
                            className="ledger-input py-1.5 text-xs"
                          />
                        </div>
                        <div className="flex items-center justify-end sm:col-span-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteDivision(code, info.name)}
                            className="rounded p-1.5 text-[#B91C1C] hover:bg-red-50"
                            title="ลบฝ่ายงาน"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-[#E2E8F0] pt-2">
                        <div className="mb-1.5 text-[11px] font-semibold text-[#475569]">งาน / แผนกวิชา ({divUnits.length})</div>
                        <div className="flex flex-wrap gap-1.5">
                          {divUnits.map((unitName) => (
                            <span
                              key={`${code}-${unitName}`}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] text-[#334155]"
                            >
                              <span>{unitName}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setOrg({
                                    ...org,
                                    divisions: {
                                      ...org.divisions,
                                      [code]: { ...info, units: divUnits.filter((u) => u !== unitName) },
                                    },
                                  })
                                }
                                className="text-[#94A3B8] hover:text-[#B91C1C]"
                                title="ลบงานนี้"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            placeholder={`เพิ่มงาน/แผนกวิชาใน${info.name}...`}
                            value={draftUnit}
                            onChange={(e) => setUnitDrafts((prev) => ({ ...prev, [code]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const clean = draftUnit.trim();
                                if (clean && !divUnits.includes(clean)) {
                                  setOrg({
                                    ...org,
                                    divisions: { ...org.divisions, [code]: { ...info, units: [...divUnits, clean] } },
                                  });
                                }
                                setUnitDrafts((prev) => ({ ...prev, [code]: "" }));
                              }
                            }}
                            className="ledger-input flex-1 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const clean = draftUnit.trim();
                              if (!clean) return;
                              if (!divUnits.includes(clean)) {
                                setOrg({
                                  ...org,
                                  divisions: { ...org.divisions, [code]: { ...info, units: [...divUnits, clean] } },
                                });
                              }
                              setUnitDrafts((prev) => ({ ...prev, [code]: "" }));
                            }}
                            className="inline-flex shrink-0 items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-100"
                          >
                            <Plus className="h-3 w-3" />
                            เพิ่มงาน
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="รหัสย่อ (เช่น ฝพ.)"
                  value={newDivCode}
                  onChange={(e) => setNewDivCode(e.target.value)}
                  className="ledger-input w-32 py-1.5 text-xs"
                />
                <input
                  type="text"
                  placeholder="ชื่อฝ่ายเต็ม (เช่น ฝ่ายพัฒนากิจการพิเศษ)"
                  value={newDivName}
                  onChange={(e) => setNewDivName(e.target.value)}
                  className="ledger-input flex-1 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newDivCode.trim() || !newDivName.trim()) return;
                    setOrg({
                      ...org,
                      divisions: {
                        ...org.divisions,
                        [newDivCode.trim()]: {
                          name: newDivName.trim(),
                          deputy_title: `รองผู้อำนวยการ${newDivName.trim()}`,
                          units: [],
                        },
                      },
                    });
                    setNewDivCode("");
                    setNewDivName("");
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E293B]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  เพิ่มฝ่ายงาน
                </button>
              </div>
            </div>

            <button type="button" onClick={saveOrg} className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E40AF]">
              <Save className="h-4 w-4" />
              บันทึกข้อมูลหน่วยงาน
            </button>
          </div>
        </section>
      )}

      {/* TAB 2: Users, RBAC & Signatures (plan.cric.ac.th parity) */}
      {tab === "users" && (
        <AdminUsersTab
          users={users}
          setUsers={setUsers}
          divisions={org?.divisions || {}}
          currentUserEmail={currentUserEmail}
          onReload={loadAll}
          onMsg={setMsg}
          onErr={setErrMsg}
        />
      )}

      {/* TAB 3: Integrations & Notifications */}
      {tab === "integrations" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <form onSubmit={saveIntegrations} className="ledger-panel overflow-hidden text-sm">
            <div className="ledger-panel-header">
              <h2 className="text-sm font-bold text-[#0F172A]">เชื่อมต่อ sso.cric.ac.th (Keycloak) และ panel.cric.ac.th</h2>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">SSO Issuer URL (Keycloak OIDC Realm)</label>
                <input type="text" value={ssoIssuer} onChange={(e) => setSsoIssuer(e.target.value)} placeholder="https://sso.cric.ac.th/realms/cric-college" className="ledger-input" />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">Keycloak Realm</label>
                  <input type="text" value={ssoRealm} onChange={(e) => setSsoRealm(e.target.value)} placeholder="cric-college" className="ledger-input" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">SSO Client ID</label>
                  <input type="text" value={ssoClientId} onChange={(e) => setSsoClientId(e.target.value)} placeholder="cric-edocx" className="ledger-input" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">
                  SSO Client Secret {settings?.integrations.sso_client_secret_info.has_secret ? `(${settings.integrations.sso_client_secret_info.masked_preview})` : ""}
                </label>
                <input type="password" value={ssoClientSecret} onChange={(e) => setSsoClientSecret(e.target.value)} placeholder="เว้นว่างเพื่อคงค่าเดิม" className="ledger-input" />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">Allowed Domain</label>
                  <input type="text" value={allowedDomain} onChange={(e) => setAllowedDomain(e.target.value)} className="ledger-input" />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0F172A] sm:pt-5">
                  <input type="checkbox" checked={authDevMode} onChange={(e) => setAuthDevMode(e.target.checked)} className="accent-[#1D4ED8]" />
                  เปิดโหมดสลับผู้ใช้จำลอง (Dev Switcher)
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">Panel API URL (พอร์ทัลหลัก)</label>
                <input type="text" value={panelUrl} onChange={(e) => setPanelUrl(e.target.value)} placeholder="http://localhost:3000 หรือ https://panel.cric.ac.th" className="ledger-input" />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">
                    Panel API Token {settings?.integrations.panel_api_token_info.has_secret ? `(${settings.integrations.panel_api_token_info.masked_preview})` : ""}
                  </label>
                  <input type="password" value={panelToken} onChange={(e) => setPanelToken(e.target.value)} placeholder="เว้นว่างเพื่อคงค่าเดิม" className="ledger-input" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">
                    Panel Sync Secret {settings?.integrations.panel_sync_secret_info?.has_secret ? `(${settings.integrations.panel_sync_secret_info.masked_preview})` : ""}
                  </label>
                  <input type="password" value={panelSyncSecret} onChange={(e) => setPanelSyncSecret(e.target.value)} placeholder="เว้นว่างเพื่อคงค่าเดิม" className="ledger-input" />
                </div>
              </div>
              <div className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                <div className="text-xs font-bold text-[#0F172A]">ลิงก์ระบบงานภายนอกประจำ 4 ฝ่าย (/divisions)</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">แจ้งซ่อม (ฝ่ายบริหารทรัพย์)</label>
                    <input type="url" value={repairUrl} onChange={(e) => setRepairUrl(e.target.value)} placeholder="https://..." className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ระบบสมัครระยะสั้น (ฝ่ายบริหารทรัพย์)</label>
                    <input type="url" value={shortCourseUrl} onChange={(e) => setShortCourseUrl(e.target.value)} placeholder="https://..." className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ระบบคัดกรองนักเรียน (ฝ่ายพัฒนา)</label>
                    <input type="url" value={screeningUrl} onChange={(e) => setScreeningUrl(e.target.value)} placeholder="https://..." className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ระบบโครงการ (ฝ่ายแผน)</label>
                    <input type="url" value={projectSysUrl} onChange={(e) => setProjectSysUrl(e.target.value)} placeholder="https://plan.cric.ac.th" className="ledger-input py-1 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ระบบประเมิน (ฝ่ายแผน)</label>
                    <input type="url" value={evalSysUrl} onChange={(e) => setEvalSysUrl(e.target.value)} placeholder="https://..." className="ledger-input py-1 text-xs" />
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-blue-200 bg-[#EFF6FF] p-3 text-xs text-[#1E3A8A]">
                <div className="mb-1.5 font-bold">ค่าสำหรับตั้งค่าใน Keycloak Client ({ssoClientId || "cric-edocx"})</div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 rounded border border-blue-200 bg-white px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold text-[#64748B]">Valid Redirect URI</div>
                      <div className="truncate font-mono text-[11px] text-[#0F172A]">
                        {ssoRedirectHint || (typeof window !== "undefined" ? `${window.location.origin}/v1/auth/sso/callback` : "/v1/auth/sso/callback")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const val = ssoRedirectHint || `${window.location.origin}/v1/auth/sso/callback`;
                        navigator.clipboard?.writeText(val);
                        toastSuccess("คัดลอก Valid Redirect URI แล้ว", val);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold text-[#334155] hover:bg-slate-50"
                    >
                      <Copy className="h-3 w-3" />
                      คัดลอก
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded border border-blue-200 bg-white px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold text-[#64748B]">Valid Post Logout Redirect URI</div>
                      <div className="truncate font-mono text-[11px] text-[#0F172A]">
                        {ssoLogoutHint || (typeof window !== "undefined" ? `${window.location.origin}/` : "/")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const val = ssoLogoutHint || `${window.location.origin}/`;
                        navigator.clipboard?.writeText(val);
                        toastSuccess("คัดลอก Post Logout URI แล้ว", val);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold text-[#334155] hover:bg-slate-50"
                    >
                      <Copy className="h-3 w-3" />
                      คัดลอก
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-emerald-900">ตั้งค่า Auto Sync บุคลากรอัตโนมัติ (Panel & Plan)</span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-emerald-900">
                    <input
                      type="checkbox"
                      checked={autoSyncEnabled}
                      onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                      className="accent-emerald-700"
                    />
                    เปิดใช้งาน Auto Sync
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ความถี่การซิงค์อัตโนมัติ</label>
                    <select
                      value={autoSyncInterval}
                      onChange={(e) => setAutoSyncInterval(Number(e.target.value))}
                      className="ledger-input py-1 text-xs"
                    >
                      <option value={5}>ทุก 5 นาที</option>
                      <option value={15}>ทุก 15 นาที</option>
                      <option value={30}>ทุก 30 นาที</option>
                      <option value={60}>ทุก 1 ชั่วโมง</option>
                      <option value={360}>ทุก 6 ชั่วโมง</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[#475569]">แหล่งข้อมูล</label>
                    <select
                      value={autoSyncSources}
                      onChange={(e) => setAutoSyncSources(e.target.value as "panel" | "plan" | "both")}
                      className="ledger-input py-1 text-xs"
                    >
                      <option value="both">ทั้ง Panel และ Plan (แนะนำ)</option>
                      <option value="panel">เฉพาะ Panel (panel.cric.ac.th)</option>
                      <option value="plan">เฉพาะ Plan (plan.cric.ac.th)</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#334155]">
                      <input
                        type="checkbox"
                        checked={autoSyncOnStartup}
                        onChange={(e) => setAutoSyncOnStartup(e.target.checked)}
                        className="accent-emerald-700"
                      />
                      ซิงค์ทันทีเมื่อสตาร์ทเซิร์ฟเวอร์
                    </label>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200/70 pt-2 text-[11px] text-emerald-900">
                  <span>
                    Webhook URL: <code className="rounded bg-white px-1.5 py-0.5 font-mono">/v1/auth/webhooks/user-sync</code>
                  </span>
                  {settings?.integrations.sync_status?.last_sync_at && (
                    <span>
                      ซิงค์ล่าสุด: <strong>{new Date(settings.integrations.sync_status.last_sync_at).toLocaleString("th-TH")}</strong> (
                      {settings.integrations.sync_status.synced_count ?? 0} รายการ)
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" className="rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF]">บันทึกการเชื่อมต่อ</button>
                <button type="button" onClick={() => handleTestConn("sso")} className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">ทดสอบ SSO</button>
                <button type="button" onClick={() => handleTestConn("panel")} className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">ทดสอบ Panel</button>
                <button type="button" onClick={() => handleTestConn("plan")} className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">ทดสอบ Plan</button>
              </div>
            </div>
          </form>

          <form onSubmit={saveNotifications} className="ledger-panel overflow-hidden text-sm">
            <div className="ledger-panel-header flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                <Bell className="h-4 w-4 text-amber-600" />
                แจ้งเตือนสถานะเอกสาร (Webhook)
              </h2>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                <input type="checkbox" checked={notifEnabled} onChange={(e) => setNotifEnabled(e.target.checked)} className="accent-[#1D4ED8]" />
                เปิดใช้งาน
              </label>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ช่องทางแจ้งเตือน</label>
                <select value={notifProvider} onChange={(e) => setNotifProvider(e.target.value)} className="ledger-input">
                  <option value="custom_webhook">Custom JSON Webhook</option>
                  <option value="discord">Discord Webhook</option>
                  <option value="telegram">Telegram Bot API (sendMessage)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">
                  Webhook URL {settings?.notifications.webhook_url_info.has_secret ? `(${settings.notifications.webhook_url_info.masked_preview})` : ""}
                </label>
                <input type="password" value={notifWebhookUrl} onChange={(e) => setNotifWebhookUrl(e.target.value)} placeholder="https://... (เว้นว่างเพื่อคงค่าเดิม)" className="ledger-input" />
              </div>
              {notifProvider === "telegram" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">Telegram Chat ID</label>
                  <input type="text" value={notifChatId} onChange={(e) => setNotifChatId(e.target.value)} className="ledger-input" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">เหตุการณ์ที่แจ้งเตือน</label>
                <div className="flex flex-wrap gap-3 text-xs text-[#0F172A]">
                  {[
                    ["submitted", "ส่งตรวจ"],
                    ["approved", "อนุมัติ"],
                    ["returned", "ส่งกลับแก้ไข"],
                    ["numbered", "ออกเลขแล้ว"],
                  ].map(([ev, lbl]) => (
                    <label key={ev} className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={notifEvents.includes(ev)}
                        onChange={(e) =>
                          setNotifEvents((prev) => (e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)))
                        }
                        className="accent-[#1D4ED8]"
                      />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <button type="submit" className="rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF]">บันทึกการแจ้งเตือน</button>
                <button type="button" onClick={handleTestNotif} className="rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">ทดสอบส่งข้อความ</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TAB 4: AI, Font Defaults & Custom Linter Rules */}
      {tab === "ai_linter" && (
        <form onSubmit={saveAiAndLinter} className="ledger-panel overflow-hidden text-sm">
          <div className="ledger-panel-header">
            <h2 className="text-sm font-bold text-[#0F172A]">AI Co-pilot ฟอนต์เริ่มต้น และกฎตรวจคำเฉพาะหน่วยงาน</h2>
          </div>
          <div className="space-y-4 p-5">
            <div
              className={`flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between ${
                aiEnabled ? "border-emerald-200 bg-emerald-50/70" : "border-slate-300 bg-slate-100"
              }`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-[#0F172A]">สถานะระบบผู้ช่วย AI Co-pilot</span>
                  <span
                    className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold ${
                      aiEnabled ? "bg-emerald-700 text-white" : "bg-slate-600 text-white"
                    }`}
                  >
                    {aiEnabled ? "เปิดใช้งาน (Active)" : "ปิดใช้งานชั่วคราว (Disabled)"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#475569]">
                  {aiEnabled
                    ? "ผู้ใช้ทุกคนสามารถใช้ AI ช่วยร่างหนังสือ วัสดุฝึก แผนการสอน และเติมแบบฟอร์มแม่แบบได้"
                    : "ผู้ดูแลระบบกำลังปิดใช้งาน AI Co-pilot ชั่วคราว ปุ่มผู้ช่วย AI ในทุกหน้าจะถูกซ่อนจากผู้ใช้"}
                </p>
              </div>
              <button
                type="button"
                disabled={togglingAi}
                onClick={() => handleToggleAiCopilot(!aiEnabled)}
                aria-pressed={aiEnabled}
                className={`inline-flex shrink-0 items-center justify-center rounded-md px-4 py-2 text-xs font-bold shadow-sm transition-colors disabled:opacity-50 ${
                  aiEnabled
                    ? "border border-[#B91C1C] bg-white text-[#B91C1C] hover:bg-red-50"
                    : "bg-[#1D4ED8] text-white hover:bg-[#1E40AF]"
                }`}
              >
                {togglingAi ? "กำลังบันทึก..." : aiEnabled ? "ปิดใช้งาน AI Co-pilot" : "เปิดใช้งาน AI Co-pilot"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ผู้ให้บริการ AI</label>
                <select
                  value={aiProvider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setAiProvider(p);
                    if (p === "gemini") setAiModel("gemini-2.5-flash");
                    if (p === "openai") setAiModel("gpt-4o-mini");
                    if (p === "local") setAiModel("llama3.1");
                  }}
                  className="ledger-input"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="local">Local LLM (Ollama / vLLM)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">โมเดล</label>
                <input type="text" value={aiModel} onChange={(e) => setAiModel(e.target.value)} className="ledger-input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">
                  API Key {settings?.ai_provider.api_key_info.has_secret ? `(${settings.ai_provider.api_key_info.masked_preview})` : ""}
                </label>
                <input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="เว้นว่างเพื่อคงค่าเดิม" className="ledger-input" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">Base URL (สำหรับ Local LLM / Proxy)</label>
                <input type="text" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} className="ledger-input" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">ฟอนต์เริ่มต้นของระบบ</label>
                <select value={defaultFont} onChange={(e) => setDefaultFont(e.target.value)} className="ledger-input">
                  <option value="TH Sarabun New">TH Sarabun New</option>
                  <option value="TH SarabunIT๙">TH SarabunIT๙</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pt-5 text-xs font-semibold text-[#0F172A]">
                <input type="checkbox" checked={autoPreviewDefault} onChange={(e) => setAutoPreviewDefault(e.target.checked)} className="accent-[#1D4ED8]" />
                เปิดอัปเดตตัวอย่างอัตโนมัติเป็นค่าเริ่มต้น
              </label>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#475569]">คำสั่งเสริมสำหรับ AI (เช่น โทนภาษาหรือข้อกำหนดของวิทยาลัย)</label>
              <textarea rows={2} value={aiCustomPrompt} onChange={(e) => setAiCustomPrompt(e.target.value)} className="ledger-input prose-saraban" placeholder="เช่น ให้ใช้ชื่อเต็มสำนักงานคณะกรรมการการอาชีวศึกษาในเอกสารภายนอก..." />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">พจนานุกรมคำผิดเพิ่มเติม (บรรทัดละ 1 คู่ รูปแบบ คำผิด=คำถูก)</label>
                <textarea rows={4} value={misspellingsText} onChange={(e) => setMisspellingsText(e.target.value)} placeholder="วท.ชร.=วิทยาลัยเทคนิคเชียงราย" className="ledger-input font-mono text-xs" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#475569]">คำต้องห้ามเพิ่มเติมของหน่วยงาน (บรรทัดละ 1 คำ)</label>
                <textarea rows={4} value={forbiddenText} onChange={(e) => setForbiddenText(e.target.value)} placeholder="คำที่ไม่ให้ปรากฏในหนังสือราชการ" className="ledger-input text-xs" />
              </div>
            </div>
            <button type="submit" className="rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E40AF]">
              บันทึกการตั้งค่า AI และกฎตรวจคำ
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: Audit Logs & System Diagnostics */}
      {tab === "audit" && (
        <div className="space-y-5">
          {diag && (
            <section className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#0F172A]">สถานะความพร้อมของระบบ</h2>
                <button type="button" onClick={handleCleanupPreviews} className="tabular-nums-th rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">
                  ล้างไฟล์พรีวิวชั่วคราว ({diag.preview_file_count} ไฟล์)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-4">
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[#475569]">ฐานข้อมูล</div>
                  <div className="mt-1 font-bold text-[#0F172A]">{diag.db_backend}</div>
                </div>
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[#475569]">ตัวแปลง PDF (LibreOffice)</div>
                  <div className={`mt-1 font-bold ${diag.libreoffice_available ? "text-emerald-700" : "text-amber-700"}`}>
                    {diag.libreoffice_available ? "พร้อมใช้งาน" : "ไม่พบ (ใช้ Word Fallback)"}
                  </div>
                </div>
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[#475569]">ตัวแปลงภาพ PNG (pdftoppm)</div>
                  <div className={`mt-1 font-bold ${diag.pdftoppm_available ? "text-emerald-700" : "text-amber-700"}`}>
                    {diag.pdftoppm_available ? "พร้อมใช้งาน" : "ไม่พบ (ใช้ iframe Fallback)"}
                  </div>
                </div>
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="text-[#475569]">ฟอนต์สารบรรณที่พบ</div>
                  <div className="mt-1 font-bold text-[#0F172A]">{diag.sarabun_fonts_detected.join(", ") || "ระบบ Windows"}</div>
                </div>
              </div>
            </section>
          )}

          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">ประวัติการใช้งานระบบ (Audit Logs)</h2>
                <span className="text-[11px] text-[#64748B] md:hidden">(เลื่อนตารางซ้าย-ขวาได้)</span>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <input
                  type="text"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  placeholder="ค้นหาอีเมล หรือเหตุการณ์..."
                  className="ledger-input flex-1 py-1 text-xs sm:w-56"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const r = await api.getAuditLogs(logQuery);
                    setLogs(r.logs);
                  }}
                  className="shrink-0 rounded-md bg-[#0F172A] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1E293B]"
                >
                  ค้นหา
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="ledger-table text-xs">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>ผู้ดำเนินการ</th>
                    <th>เหตุการณ์</th>
                    <th>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="tabular-nums-th font-mono text-[11px] text-[#475569]">{l.created_at.slice(0, 19).replace("T", " ")}</td>
                      <td className="text-[#0F172A]">{l.actor_email}</td>
                      <td className="font-semibold text-[#1E3A8A]">{l.event_type}</td>
                      <td className="font-mono text-[11px] text-[#475569]">{JSON.stringify(l.metadata)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 6: Templates Management */}
      {tab === "templates" && (
        <AdminTemplatesTab
          onStatus={(m, e) => {
            setMsg(m);
            setErrMsg(e || "");
          }}
        />
      )}
    </div>
  );
}
