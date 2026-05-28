import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { apiFetch, apiFetchRaw, isAuthError } from "../api";
import {
  getStoredAccountSessions,
  getUserAccessToken,
  removeStoredAccountSession,
  setCurrentUserSession,
  type StoredAccountSession,
} from "../auth/tokenStore";
import type { CurrentUser } from "../hooks/useCurrentUser";
import { useI18n } from "../i18n/useI18n";
import { log } from "../utils/logger";
import styles from "./ControlCenter.module.css";

export type ControlCenterSection = "account" | "preferences" | "admin";

const TRANSIENT_MESSAGE_TIMEOUT_MS = 3000;

interface AdminUser {
  uuid: string;
  username: string;
  role: string;
  disabled_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

type AdminCreateUserForm = {
  username: string;
  password: string;
};

type ConfirmAction = "disable" | "enable" | "cleanup" | "delete";
type AuthTokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token: string;
};

/**
 * 在消息显示一段时间后自动清空，避免提示长期残留在局部界面中。
 */
function useAutoDismissState<T>(
  value: T | null,
  onClear: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || value === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onClear();
    }, TRANSIENT_MESSAGE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, onClear, value]);
}

type ControlCenterProps = {
  isOpen: boolean;
  activeSection: ControlCenterSection;
  currentUser: CurrentUser | null;
  isAdmin: boolean;
  locale: "zh-CN" | "en-US";
  themeName: "light" | "dark";
  backgroundName: "orbital" | "mesh" | "aurora";
  contentInset: number;
  launchpadSidebarEnabled: boolean;
  onClose: () => void;
  onSelectSection: (section: ControlCenterSection) => void;
  onToggleLocale: () => void;
  onToggleTheme: () => void;
  onCycleBackground: () => void;
  onChangeContentInset: (contentInset: number) => void;
  onToggleLaunchpadSidebar: () => void;
  onLogout: () => void;
};

/**
 * 登录后统一控制中心模态框。
 */
const ControlCenter = ({
  isOpen,
  activeSection,
  currentUser,
  isAdmin,
  locale,
  themeName,
  backgroundName,
  contentInset,
  launchpadSidebarEnabled,
  onClose,
  onSelectSection,
  onToggleLocale,
  onToggleTheme,
  onCycleBackground,
  onChangeContentInset,
  onToggleLaunchpadSidebar,
  onLogout,
}: ControlCenterProps) => {
  const { t } = useI18n();
  const [usernameForm, setUsernameForm] = useState({ new_username: "" });
  const [passwordForm, setPasswordForm] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [usernameMessage, setUsernameMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminCreateForm, setAdminCreateForm] = useState<AdminCreateUserForm>({
    username: "",
    password: "",
  });
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminRefreshing, setAdminRefreshing] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const [accountSwitchMessage, setAccountSwitchMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [switchingAccountUuid, setSwitchingAccountUuid] = useState<
    string | null
  >(null);
  const [confirmState, setConfirmState] = useState<{
    user: AdminUser;
    action: ConfirmAction;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const fetchAdminUsers = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      const token = getUserAccessToken();
      if (!token) {
        onLogout();
        return;
      }

      if (mode === "refresh") {
        setAdminRefreshing(true);
      } else {
        setAdminLoading(true);
      }
      setAdminError(null);
      try {
        const resp = await apiFetch<{ users: AdminUser[] }>(
          "/api/v1/admin/users",
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const list = resp.data?.users ?? [];
        const sorted = list
          .filter((user) => user.role !== "admin")
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          );
        setAdminUsers(sorted);
      } catch (error) {
        if (isAuthError(error)) {
          onLogout();
          return;
        }
        log.error("运行期错误", error);
        setAdminError(t("admin.fetchUsersFailed"));
      } finally {
        if (mode === "refresh") {
          setAdminRefreshing(false);
        } else {
          setAdminLoading(false);
        }
      }
    },
    [onLogout, t],
  );

  useEffect(() => {
    if (!isOpen || activeSection !== "admin" || !isAdmin) {
      return;
    }

    void (async () => {
      await fetchAdminUsers();
    })();
  }, [activeSection, fetchAdminUsers, isAdmin, isOpen]);

  useAutoDismissState(
    usernameMessage,
    () => {
      setUsernameMessage(null);
    },
    isOpen,
  );
  useAutoDismissState(
    passwordMessage,
    () => {
      setPasswordMessage(null);
    },
    isOpen,
  );
  useAutoDismissState(
    adminError,
    () => {
      setAdminError(null);
    },
    isOpen,
  );
  useAutoDismissState(
    adminMessage,
    () => {
      setAdminMessage(null);
    },
    isOpen,
  );
  useAutoDismissState(
    accountSwitchMessage,
    () => {
      setAccountSwitchMessage(null);
    },
    isOpen,
  );

  const sectionItems = useMemo(() => {
    const items: Array<{
      id: ControlCenterSection;
      label: string;
      icon: ReactNode;
    }> = [
      {
        id: "account",
        label: t("nav.account"),
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={styles.controlCenterMenuIcon}
          >
            <path
              d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        id: "preferences",
        label: t("nav.preferences"),
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={styles.controlCenterMenuIcon}
          >
            <path
              d="M4 7h10M17 7h3M10 17H4M20 17h-7M14 7a2 2 0 1 0 0 0ZM10 17a2 2 0 1 0 0 0Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
    ];

    if (isAdmin) {
      items.push({
        id: "admin",
        label: t("nav.admin"),
        icon: (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className={styles.controlCenterMenuIcon}
          >
            <path
              d="M12 3.75 5.75 6.5v5.02c0 3.7 2.26 7.01 5.72 8.38l.53.21.53-.21c3.46-1.37 5.72-4.68 5.72-8.38V6.5L12 3.75Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      });
    }

    return items;
  }, [isAdmin, t]);

  const currentLocaleLabel = locale === "zh-CN" ? "中文" : "English";
  const currentThemeLabel =
    themeName === "dark"
      ? t("preferences.themeDark")
      : t("preferences.themeLight");
  const currentBackgroundLabel =
    backgroundName === "mesh"
      ? t("preferences.backgroundMesh")
      : backgroundName === "aurora"
        ? t("preferences.backgroundAurora")
        : t("preferences.backgroundOrbital");
  const currentSectionTitle =
    activeSection === "preferences"
      ? t("controlCenter.preferencesTitle")
      : activeSection === "admin"
        ? t("controlCenter.adminTitle")
        : t("controlCenter.accountTitle");
  const storedAccounts =
    isOpen && activeSection === "account" ? getStoredAccountSessions() : [];

  if (!isOpen) {
    return null;
  }

  const handleUsernameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUsernameMessage(null);

    const token = getUserAccessToken();
    if (!token) {
      onLogout();
      return;
    }

    try {
      await apiFetch<null>("/api/v1/user/username", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(usernameForm),
      });
      setUsernameMessage({
        text: t("settings.usernameUpdated"),
        type: "success",
      });
      window.setTimeout(() => {
        onClose();
        onLogout();
      }, 1200);
    } catch (error) {
      if (isAuthError(error)) {
        onLogout();
        return;
      }
      log.error("运行期错误", error);
      setUsernameMessage({ text: t("settings.requestFailed"), type: "error" });
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMessage({
        text: t("settings.passwordMismatch"),
        type: "error",
      });
      return;
    }

    const token = getUserAccessToken();
    if (!token) {
      onLogout();
      return;
    }

    try {
      await apiFetch<null>("/api/v1/user/password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          old_password: passwordForm.old_password,
          new_password: passwordForm.new_password,
        }),
      });
      setPasswordMessage({
        text: t("settings.passwordUpdated"),
        type: "success",
      });
      setPasswordForm({
        old_password: "",
        new_password: "",
        confirm_password: "",
      });
    } catch (error) {
      if (isAuthError(error)) {
        onLogout();
        return;
      }
      log.error("运行期错误", error);
      setPasswordMessage({ text: t("settings.requestFailed"), type: "error" });
    }
  };

  const performAdminAction = async (user: AdminUser, action: ConfirmAction) => {
    const token = getUserAccessToken();
    if (!token) {
      onLogout();
      return;
    }

    const path = (() => {
      switch (action) {
        case "disable":
          return `/api/v1/admin/users/${user.uuid}/disable`;
        case "enable":
          return `/api/v1/admin/users/${user.uuid}/enable`;
        case "cleanup":
          return `/api/v1/admin/users/${user.uuid}/cleanup`;
        case "delete":
          return `/api/v1/admin/users/${user.uuid}`;
      }
    })();

    try {
      const resp = await apiFetch<null>(path, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setAdminMessage(resp.message || t("admin.actionSuccess"));
      await fetchAdminUsers();
    } catch (error) {
      if (isAuthError(error)) {
        onLogout();
        return;
      }
      log.error("运行期错误", error);
      setAdminError((error as Error).message || t("admin.actionFailed"));
    }
  };

  const handleAdminCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const token = getUserAccessToken();
    if (!token) {
      onLogout();
      return;
    }

    setAdminError(null);
    setAdminMessage(null);
    try {
      const resp = await apiFetch<AdminUser>("/api/v1/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(adminCreateForm),
      });
      setAdminMessage(resp.message || t("admin.createUserSuccess"));
      setAdminCreateForm({ username: "", password: "" });
      await fetchAdminUsers();
    } catch (error) {
      if (isAuthError(error)) {
        onLogout();
        return;
      }
      log.error("运行期错误", error);
      setAdminError((error as Error).message || t("admin.createUserFailed"));
    }
  };

  const confirmText = (user: AdminUser, action: ConfirmAction) => {
    if (action === "disable") {
      return t("admin.confirmDisable", { username: user.username });
    }
    if (action === "enable") {
      return t("admin.confirmEnable", { username: user.username });
    }
    if (action === "cleanup") {
      return t("admin.confirmCleanup", { username: user.username });
    }
    return t("admin.confirmDelete", { username: user.username });
  };

  const handleSwitchAccount = async (session: StoredAccountSession) => {
    setAccountSwitchMessage(null);
    setSwitchingAccountUuid(session.userUuid);

    try {
      const data = await apiFetchRaw<AuthTokenResponse>("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });

      if (!data.access_token) {
        setAccountSwitchMessage({
          text: t("auth.accountSwitchFailed"),
          type: "error",
        });
        return;
      }

      setCurrentUserSession(data.access_token, data.refresh_token);
      setAccountSwitchMessage({
        text: t("auth.accountSwitched"),
        type: "success",
      });
      window.setTimeout(() => {
        window.location.reload();
      }, 400);
    } catch (error) {
      removeStoredAccountSession(session.userUuid);
      log.error("运行期错误", error);
      setAccountSwitchMessage({
        text: t("auth.accountSwitchFailed"),
        type: "error",
      });
    } finally {
      setSwitchingAccountUuid(null);
    }
  };

  const handleRemoveStoredAccount = (session: StoredAccountSession) => {
    removeStoredAccountSession(session.userUuid);
    setAccountSwitchMessage({
      text: t("auth.accountRemoved"),
      type: "success",
    });
  };

  return (
    <div
      className={`control-center-backdrop ${styles.controlCenterBackdrop}`}
      data-ui="control-center-backdrop"
      onClick={onClose}
    >
      <div
        className={`control-center-modal ${styles.controlCenterModal}`}
        data-ui="control-center"
        data-section={activeSection}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.controlCenter")}
      >
        <header
          className={styles.controlCenterTopbar}
          data-slot="control-center-topbar"
        >
          <div className={styles.controlCenterHeaderMain}>
            <h2 className={styles.controlCenterHeading}>
              {currentSectionTitle}
            </h2>
          </div>
          <button
            type="button"
            className={`control-center-close-button ${styles.controlCenterCloseButton}`}
            data-ui="control-center-close-button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                d="m6 6 12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <section
          className={`control-center-content ${styles.controlCenterContent}`}
          data-slot="control-center-content"
        >
          <aside
            className={styles.controlCenterSidebar}
            data-slot="control-center-sidebar"
          >
            <nav
              className={styles.controlCenterNav}
              aria-label={t("nav.controlCenter")}
              data-slot="control-center-nav"
            >
              {sectionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.controlCenterNavItem}
                  data-ui="control-center-nav-item"
                  data-section-target={item.id}
                  data-active={activeSection === item.id}
                  onClick={() => onSelectSection(item.id)}
                >
                  <span className={styles.controlCenterMenuLabel}>
                    {item.icon}
                    <span className={styles.controlCenterMenuTitle}>
                      {item.label}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <div
            className={styles.controlCenterMain}
            data-slot="control-center-main"
          >
            <div
              className={`control-center-content-body ${styles.controlCenterContentBody}`}
              data-slot="control-center-body"
            >
              {activeSection === "account" ? (
                <>
                  <section
                    className={`control-center-overview ${styles.sectionOverview}`}
                    data-ui="control-center-account-overview"
                  >
                    <div className={styles.overviewIdentity}>
                      <span
                        className={styles.overviewAvatar}
                        aria-hidden="true"
                      >
                        {currentUser?.username
                          ?.trim()
                          .charAt(0)
                          .toUpperCase() || "U"}
                      </span>
                      <div className={styles.overviewIdentityText}>
                        <p className={styles.overviewLabel}>
                          {t("settings.currentUser")}
                        </p>
                        <p className={styles.overviewTitle}>
                          {currentUser?.username ?? t("common.loading")}
                        </p>
                      </div>
                    </div>
                  </section>

                  <div
                    className={`control-center-section-grid ${styles.sectionGrid}`}
                  >
                    <section
                      className={`control-center-section-card ${styles.sectionCard}`}
                      data-ui="control-center-username-card"
                    >
                      <div className={styles.sectionCardHeader}>
                        <h4 className={styles.sectionCardTitle}>
                          {t("settings.changeUsername")}
                        </h4>
                      </div>
                      <form
                        className={styles.sectionForm}
                        data-ui="control-center-username-form"
                        onSubmit={(event) => void handleUsernameSubmit(event)}
                      >
                        <label htmlFor="control_center_new_username">
                          {t("settings.newUsername")}
                        </label>
                        <input
                          id="control_center_new_username"
                          className={styles.sectionInput}
                          type="text"
                          data-ui="control-center-username-input"
                          value={usernameForm.new_username}
                          onChange={(event) =>
                            setUsernameForm({
                              new_username: event.target.value,
                            })
                          }
                          required
                        />
                        <button
                          type="submit"
                          className={styles.sectionButton}
                          data-ui="control-center-username-submit"
                        >
                          {t("settings.updateUsername")}
                        </button>
                      </form>
                      {usernameMessage ? (
                        <div
                          className={
                            usernameMessage.type === "success"
                              ? styles.sectionNotice
                              : styles.sectionError
                          }
                        >
                          {usernameMessage.text}
                        </div>
                      ) : null}
                    </section>

                    <section
                      className={`control-center-section-card ${styles.sectionCard}`}
                      data-ui="control-center-password-card"
                    >
                      <div className={styles.sectionCardHeader}>
                        <h4 className={styles.sectionCardTitle}>
                          {t("settings.changePassword")}
                        </h4>
                      </div>
                      <form
                        className={styles.sectionForm}
                        data-ui="control-center-password-form"
                        onSubmit={(event) => void handlePasswordSubmit(event)}
                      >
                        <label htmlFor="control_center_old_password">
                          {t("auth.oldPassword")}
                        </label>
                        <input
                          id="control_center_old_password"
                          className={styles.sectionInput}
                          type="password"
                          data-ui="control-center-old-password-input"
                          value={passwordForm.old_password}
                          onChange={(event) =>
                            setPasswordForm((prev) => ({
                              ...prev,
                              old_password: event.target.value,
                            }))
                          }
                          required
                        />
                        <label htmlFor="control_center_new_password">
                          {t("auth.newPassword")}
                        </label>
                        <input
                          id="control_center_new_password"
                          className={styles.sectionInput}
                          type="password"
                          data-ui="control-center-new-password-input"
                          value={passwordForm.new_password}
                          onChange={(event) =>
                            setPasswordForm((prev) => ({
                              ...prev,
                              new_password: event.target.value,
                            }))
                          }
                          required
                        />
                        <label htmlFor="control_center_confirm_password">
                          {t("auth.confirmPassword")}
                        </label>
                        <input
                          id="control_center_confirm_password"
                          className={styles.sectionInput}
                          type="password"
                          data-ui="control-center-confirm-password-input"
                          value={passwordForm.confirm_password}
                          onChange={(event) =>
                            setPasswordForm((prev) => ({
                              ...prev,
                              confirm_password: event.target.value,
                            }))
                          }
                          required
                        />
                        <button
                          type="submit"
                          className={styles.sectionButton}
                          data-ui="control-center-password-submit"
                        >
                          {t("settings.updatePassword")}
                        </button>
                      </form>
                      {passwordMessage ? (
                        <div
                          className={
                            passwordMessage.type === "success"
                              ? styles.sectionNotice
                              : styles.sectionError
                          }
                        >
                          {passwordMessage.text}
                        </div>
                      ) : null}
                    </section>
                  </div>

                  <section
                    className={`control-center-section-card ${styles.sectionCard}`}
                  >
                    <div className={styles.sectionCardHeader}>
                      <h4 className={styles.sectionCardTitle}>
                        {t("auth.savedAccounts")}
                      </h4>
                    </div>
                    <div className={styles.accountSwitchList}>
                      {storedAccounts.length === 0 ? (
                        <div className={styles.sectionMessage}>
                          {t("auth.noSavedAccounts")}
                        </div>
                      ) : (
                        storedAccounts.map((account) => {
                          const isCurrent =
                            account.userUuid === currentUser?.sub;
                          return (
                            <div
                              key={account.userUuid}
                              className={styles.accountSwitchItem}
                            >
                              <div className={styles.accountSwitchIdentity}>
                                <span
                                  className={styles.accountSwitchAvatar}
                                  aria-hidden="true"
                                >
                                  {account.username
                                    .trim()
                                    .charAt(0)
                                    .toUpperCase() || "U"}
                                </span>
                                <div className={styles.accountSwitchText}>
                                  <span className={styles.accountSwitchName}>
                                    {account.username}
                                  </span>
                                  <span className={styles.accountSwitchMeta}>
                                    {isCurrent
                                      ? t("auth.currentAccount")
                                      : t("auth.savedSession")}
                                  </span>
                                </div>
                              </div>
                              <div className={styles.accountSwitchActions}>
                                {!isCurrent ? (
                                  <button
                                    type="button"
                                    className={styles.sectionDangerButton}
                                    data-ui="control-center-remove-saved-account-button"
                                    disabled={
                                      switchingAccountUuid === account.userUuid
                                    }
                                    onClick={() => {
                                      handleRemoveStoredAccount(account);
                                    }}
                                  >
                                    {t("auth.removeSavedAccount")}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={styles.sectionSecondaryButton}
                                  disabled={
                                    isCurrent ||
                                    switchingAccountUuid === account.userUuid
                                  }
                                  onClick={() => {
                                    void handleSwitchAccount(account);
                                  }}
                                >
                                  {isCurrent
                                    ? t("auth.currentAccount")
                                    : switchingAccountUuid === account.userUuid
                                      ? t("common.loading")
                                      : t("auth.switchToAccount")}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {accountSwitchMessage ? (
                      <div
                        className={
                          accountSwitchMessage.type === "success"
                            ? styles.sectionNotice
                            : styles.sectionError
                        }
                      >
                        {accountSwitchMessage.text}
                      </div>
                    ) : null}
                  </section>

                  <section
                    className={`control-center-section-card ${styles.sectionCard}`}
                  >
                    <div className={styles.sectionCardHeaderRow}>
                      <div className={styles.sectionCardHeader}>
                        <h4 className={styles.sectionCardTitle}>
                          {t("nav.logout")}
                        </h4>
                      </div>
                      <button
                        type="button"
                        className={styles.sectionDangerButton}
                        onClick={() => {
                          onClose();
                          onLogout();
                        }}
                      >
                        {t("nav.logout")}
                      </button>
                    </div>
                  </section>
                </>
              ) : null}

              {activeSection === "preferences" ? (
                <>
                  <section
                    className={`control-center-overview ${styles.sectionOverview}`}
                    data-ui="control-center-preferences-overview"
                  >
                    <div className={styles.overviewIdentity}>
                      <span
                        className={styles.overviewAvatar}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 24 24" fill="none">
                          <path
                            d="M4 7h10M17 7h3M10 17H4M20 17h-7M14 7a2 2 0 1 0 0 0ZM10 17a2 2 0 1 0 0 0Z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <div className={styles.overviewIdentityText}>
                        <p className={styles.overviewLabel}>
                          {t("nav.preferences")}
                        </p>
                        <p className={styles.overviewTitle}>
                          {t("controlCenter.preferencesSummary")}
                        </p>
                      </div>
                    </div>
                  </section>

                  <div
                    className={styles.preferencesList}
                    data-slot="control-center-preferences-list"
                  >
                    <section
                      className={`control-center-preference-card ${styles.preferenceCard}`}
                      data-ui="control-center-language-card"
                    >
                      <div className={styles.preferenceInfo}>
                        <p className={styles.preferenceLabel}>
                          {t("preferences.language")}
                        </p>
                        <p className={styles.preferenceValue}>
                          {currentLocaleLabel}
                        </p>
                      </div>
                      <div className={styles.preferenceActions}>
                        <button
                          type="button"
                          className={styles.sectionSecondaryButton}
                          data-ui="control-center-language-button"
                          onClick={onToggleLocale}
                        >
                          {t("controlCenter.switchLanguage")}
                        </button>
                      </div>
                    </section>

                    <section
                      className={`control-center-preference-card ${styles.preferenceCard}`}
                      data-ui="control-center-theme-card"
                    >
                      <div className={styles.preferenceInfo}>
                        <p className={styles.preferenceLabel}>
                          {t("preferences.theme")}
                        </p>
                        <p className={styles.preferenceValue}>
                          {currentThemeLabel}
                        </p>
                      </div>
                      <div className={styles.preferenceActions}>
                        <button
                          type="button"
                          className={styles.sectionSecondaryButton}
                          data-ui="control-center-theme-button"
                          onClick={onToggleTheme}
                        >
                          {themeName === "dark"
                            ? t("preferences.themeLight")
                            : t("preferences.themeDark")}
                        </button>
                      </div>
                    </section>

                    <section
                      className={`control-center-preference-card ${styles.preferenceCard}`}
                      data-ui="control-center-background-card"
                    >
                      <div className={styles.preferenceInfo}>
                        <p className={styles.preferenceLabel}>
                          {t("preferences.background")}
                        </p>
                        <p className={styles.preferenceValue}>
                          {currentBackgroundLabel}
                        </p>
                      </div>
                      <div className={styles.preferenceActions}>
                        <button
                          type="button"
                          className={styles.sectionSecondaryButton}
                          data-ui="control-center-background-button"
                          onClick={onCycleBackground}
                        >
                          {t("controlCenter.nextBackground")}
                        </button>
                      </div>
                    </section>

                    <section
                      className={`control-center-preference-card ${styles.preferenceCard}`}
                      data-ui="control-center-content-inset-card"
                    >
                      <div className={styles.preferenceInfo}>
                        <p className={styles.preferenceLabel}>
                          {t("controlCenter.contentInset")}
                        </p>
                        <p className={styles.preferenceValue}>
                          {t("controlCenter.contentInsetValue", {
                            value: contentInset,
                          })}
                        </p>
                      </div>
                      <div className={styles.preferenceSliderGroup}>
                        <input
                          id="control_center_content_inset"
                          className={styles.preferenceSlider}
                          type="range"
                          data-ui="control-center-content-inset-slider"
                          min="8"
                          max="120"
                          step="8"
                          value={contentInset}
                          onChange={(event) =>
                            onChangeContentInset(Number(event.target.value))
                          }
                        />
                        <div className={styles.preferenceSliderScale}>
                          <span>
                            {t("controlCenter.contentInsetComfortable")}
                          </span>
                          <span>{t("controlCenter.contentInsetCompact")}</span>
                        </div>
                      </div>
                    </section>

                    <section
                      className={`control-center-preference-card ${styles.preferenceCard}`}
                      data-ui="control-center-launchpad-sidebar-card"
                    >
                      <div className={styles.preferenceInfo}>
                        <p className={styles.preferenceLabel}>
                          {t("controlCenter.launchpadSidebar")}
                        </p>
                        <p className={styles.preferenceValue}>
                          {launchpadSidebarEnabled
                            ? t("controlCenter.launchpadSidebarEnabled")
                            : t("controlCenter.launchpadSidebarDisabled")}
                        </p>
                      </div>
                      <div className={styles.preferenceActions}>
                        <button
                          type="button"
                          className={styles.sectionSecondaryButton}
                          data-ui="control-center-launchpad-sidebar-button"
                          onClick={onToggleLaunchpadSidebar}
                        >
                          {launchpadSidebarEnabled
                            ? t("controlCenter.disable")
                            : t("controlCenter.enable")}
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              ) : null}

              {activeSection === "admin" && isAdmin ? (
                <>
                  <section
                    className={`control-center-overview ${styles.sectionOverview}`}
                    data-ui="control-center-admin-overview"
                  >
                    <div className={styles.overviewIdentity}>
                      <span
                        className={styles.overviewAvatar}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 24 24" fill="none">
                          <path
                            d="M12 3.75 5.75 6.5v5.02c0 3.7 2.26 7.01 5.72 8.38l.53.21.53-.21c3.46-1.37 5.72-4.68 5.72-8.38V6.5L12 3.75Z"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <div className={styles.overviewIdentityText}>
                        <p className={styles.overviewLabel}>
                          {t("admin.title")}
                        </p>
                        <p className={styles.overviewTitle}>
                          {currentUser?.username ?? t("common.loading")}
                        </p>
                      </div>
                    </div>
                  </section>

                  {adminMessage ? (
                    <div className={styles.sectionNotice}>{adminMessage}</div>
                  ) : null}
                  {adminError ? (
                    <div className={styles.sectionError}>{adminError}</div>
                  ) : null}

                  <section
                    className={`${styles.sectionCard} ${styles.adminCreateCard}`}
                    data-ui="control-center-admin-create-user-card"
                  >
                    <div className={styles.sectionCardHeader}>
                      <h4 className={styles.sectionCardTitle}>
                        {t("admin.createUserTitle")}
                      </h4>
                    </div>
                    <form
                      className={`${styles.sectionForm} ${styles.adminCreateFormInline}`}
                      data-ui="control-center-admin-create-user-form"
                      onSubmit={(event) => void handleAdminCreateUser(event)}
                    >
                      <div className={styles.adminCreateField}>
                        <label htmlFor="admin_create_user_username">
                          {t("auth.username")}
                        </label>
                        <input
                          id="admin_create_user_username"
                          className={styles.sectionInput}
                          type="text"
                          data-ui="control-center-admin-create-user-username"
                          value={adminCreateForm.username}
                          onChange={(event) =>
                            setAdminCreateForm((prev) => ({
                              ...prev,
                              username: event.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                      <div className={styles.adminCreateField}>
                        <label htmlFor="admin_create_user_password">
                          {t("auth.password")}
                        </label>
                        <input
                          id="admin_create_user_password"
                          className={styles.sectionInput}
                          type="password"
                          data-ui="control-center-admin-create-user-password"
                          value={adminCreateForm.password}
                          onChange={(event) =>
                            setAdminCreateForm((prev) => ({
                              ...prev,
                              password: event.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                      <div className={styles.adminCreateAction}>
                        <button
                          type="submit"
                          className={styles.sectionButton}
                          data-ui="control-center-admin-create-user-submit"
                        >
                          {t("admin.createUserButton")}
                        </button>
                      </div>
                    </form>
                  </section>

                  <section
                    className={`${styles.sectionCard} ${styles.adminUsersCard}`}
                    data-ui="control-center-admin-users-card"
                  >
                    <div className={styles.sectionCardHeaderRow}>
                      <div className={styles.sectionCardHeader}>
                        <h4 className={styles.sectionCardTitle}>
                          {t("admin.userManagement")}
                        </h4>
                      </div>
                      <button
                        type="button"
                        className={styles.sectionSecondaryButton}
                        data-ui="control-center-admin-refresh-users-button"
                        onClick={() => {
                          void fetchAdminUsers("refresh");
                        }}
                        disabled={adminLoading || adminRefreshing}
                      >
                        {adminRefreshing
                          ? t("admin.loadingUsers")
                          : t("common.refresh")}
                      </button>
                    </div>
                    {adminLoading ? (
                      <div className={styles.sectionMessage}>
                        {t("admin.loadingUsers")}
                      </div>
                    ) : (
                      <div
                        className={styles.adminUserList}
                        data-ui="control-center-admin-user-list"
                        data-refreshing={adminRefreshing}
                      >
                        {adminUsers.map((user) => {
                          const isDeleted = Boolean(user.deleted_at);
                          const isDisabled = Boolean(user.disabled_at);
                          const statusLabel = isDeleted
                            ? t("admin.deleted")
                            : isDisabled
                              ? t("admin.disabled")
                              : t("admin.enabled");

                          return (
                            <article
                              key={user.uuid}
                              className={styles.adminUserItem}
                              data-entity="admin-user"
                              data-user-uuid={user.uuid}
                            >
                              <div className={styles.adminUserMain}>
                                <div className={styles.adminUserIdentity}>
                                  <div className={styles.adminUserNameRow}>
                                    <span className={styles.adminUserName}>
                                      {user.username}
                                    </span>
                                    <span className={styles.adminUserRole}>
                                      {user.role}
                                    </span>
                                  </div>
                                  <div className={styles.adminUserMeta}>
                                    <span>{statusLabel}</span>
                                    <span>
                                      {new Date(
                                        user.created_at,
                                      ).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className={styles.adminActions}>
                                {!isDeleted ? (
                                  <>
                                    {isDisabled ? (
                                      <button
                                        type="button"
                                        className={
                                          styles.sectionSecondaryButton
                                        }
                                        data-ui="control-center-admin-enable-user-button"
                                        onClick={() =>
                                          setConfirmState({
                                            user,
                                            action: "enable",
                                          })
                                        }
                                      >
                                        {t("admin.enable")}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className={
                                          styles.sectionSecondaryButton
                                        }
                                        data-ui="control-center-admin-disable-user-button"
                                        onClick={() =>
                                          setConfirmState({
                                            user,
                                            action: "disable",
                                          })
                                        }
                                      >
                                        {t("admin.disable")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={styles.sectionDangerButton}
                                      data-ui="control-center-admin-delete-user-button"
                                      onClick={() =>
                                        setConfirmState({
                                          user,
                                          action: "delete",
                                        })
                                      }
                                    >
                                      {t("admin.markDelete")}
                                    </button>
                                  </>
                                ) : (
                                  <div className={styles.adminDeletedActions}>
                                    <button
                                      type="button"
                                      className={styles.sectionSecondaryButton}
                                      data-ui="control-center-admin-cleanup-user-button"
                                      onClick={() =>
                                        setConfirmState({
                                          user,
                                          action: "cleanup",
                                        })
                                      }
                                    >
                                      {t("admin.cleanup")}
                                    </button>
                                    <span className={styles.mutedText}>
                                      {t("admin.deleted")}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      {confirmState ? (
        <div
          className={`control-center-confirm-backdrop ${styles.confirmBackdrop}`}
          data-ui="control-center-confirm-backdrop"
          onClick={() => setConfirmState(null)}
        >
          <div
            className={`control-center-confirm-modal ${styles.confirmModal}`}
            data-ui="control-center-confirm-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className={styles.confirmTitle}>{t("admin.confirmAction")}</h4>
            <p className={styles.confirmText}>
              {confirmText(confirmState.user, confirmState.action)}
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.sectionSecondaryButton}
                onClick={() => setConfirmState(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={styles.sectionButton}
                onClick={() => {
                  void performAdminAction(
                    confirmState.user,
                    confirmState.action,
                  );
                  setConfirmState(null);
                }}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ControlCenter;
