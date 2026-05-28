import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiFetch, isAuthError } from "../api";
import { clearUserAccessToken, getUserAccessToken } from "../auth/tokenStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useI18n } from "../i18n/useI18n";
import { log } from "../utils/logger";
import styles from "./Admin.module.css";

interface AdminUser {
  uuid: string;
  username: string;
  role: string;
  disabled_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 渲染管理员用户管理页面，支持查看、创建、启停、删除和清理用户。
 */
const AdminPage = () => {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    user: AdminUser;
    action: "disable" | "enable" | "cleanup" | "delete";
  } | null>(null);
  const { user: currentUser, loading: userLoading } = useCurrentUser({
    redirectTo: "/login",
  });
  const navigate = useNavigate();

  const token = getUserAccessToken();

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch<{ users: AdminUser[] }>(
        "/api/v1/admin/users",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const list: AdminUser[] = resp.data?.users || [];
      const sorted = [...list].sort((a, b) => {
        const aIsAdmin = a.role === "admin";
        const bIsAdmin = b.role === "admin";
        if (aIsAdmin && !bIsAdmin) return -1;
        if (!aIsAdmin && bIsAdmin) return 1;
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      setUsers(sorted);
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      setError(t("admin.fetchUsersFailed"));
    } finally {
      setLoading(false);
    }
  }, [navigate, t, token]);

  useEffect(() => {
    if (!currentUser) return;
    const roles = currentUser.roles || [];
    const isAdmin = roles.includes("admin");
    if (!isAdmin) {
      void navigate("/launchpad");
      return;
    }

    void (async () => {
      await fetchUsers();
    })();
  }, [currentUser, fetchUsers, navigate]);

  const performAction = async (
    user: AdminUser,
    action: "disable" | "enable" | "cleanup" | "delete",
  ) => {
    if (!token) {
      void navigate("/login");
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
      setMessage(resp.message || t("admin.actionSuccess"));
      void fetchUsers();
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      setError((err as Error).message || t("admin.actionFailed"));
    }
  };

  const openConfirm = (
    user: AdminUser,
    action: "disable" | "enable" | "cleanup" | "delete",
  ) => {
    setConfirmState({ user, action });
  };

  const confirmText = (ctx: {
    user: AdminUser;
    action: "disable" | "enable" | "cleanup" | "delete";
  }) => {
    const { user, action } = ctx;
    const base = {
      disable: t("admin.confirmDisable", { username: user.username }),
      enable: t("admin.confirmEnable", { username: user.username }),
      cleanup: t("admin.confirmCleanup", { username: user.username }),
      delete: t("admin.confirmDelete", { username: user.username }),
    } as const;
    return base[action];
  };

  return (
    <>
      {userLoading && (
        <div className={styles.state}>{t("admin.verifying")}</div>
      )}
      {!userLoading && !currentUser && <Navigate to="/login" replace />}
      {!userLoading && currentUser && (
        <div
          className={`admin-page ${styles.page}`}
          data-page="admin"
          data-ui="admin-page"
        >
          <header
            className={`admin-page-header ${styles.header}`}
            data-slot="admin-header"
          >
            <div>
              <h1 className={styles.title}>{t("admin.title")}</h1>
              <p className={styles.sub}>
                {t("admin.currentAdmin", { username: currentUser.username })}
              </p>
            </div>
            <div className={styles.meta} data-slot="admin-header-actions">
              <span className={styles.badge}>{t("admin.role")}</span>
              <button
                className={styles.refresh}
                data-ui="admin-logout-button"
                onClick={() => {
                  clearUserAccessToken();
                  void navigate("/login", { replace: true });
                }}
              >
                {t("admin.logout")}
              </button>
            </div>
          </header>

          {message && (
            <div className={styles.notice} data-ui="admin-notice">
              {message}
            </div>
          )}
          {error && (
            <div className={styles.error} data-ui="admin-error">
              {error}
            </div>
          )}

          {loading ? (
            <div className={styles.state} data-ui="admin-loading-users">
              {t("admin.loadingUsers")}
            </div>
          ) : (
            <>
              <section
                className={`admin-card ${styles.card}`}
                data-ui="admin-user-management-card"
              >
                <div
                  className={`admin-card-header ${styles.cardHeader}`}
                  data-slot="admin-card-header"
                >
                  <div
                    className={`admin-card-header-top ${styles.cardHeaderTop}`}
                    data-slot="admin-card-header-top"
                  >
                    <h2>{t("admin.userManagement")}</h2>
                    <button
                      className={styles.refresh}
                      data-ui="admin-refresh-users-button"
                      onClick={() => {
                        void fetchUsers();
                      }}
                      disabled={loading}
                    >
                      {t("common.refresh")}
                    </button>
                  </div>
                  <p className={styles.cardSub}>
                    {t("admin.userManagementHint")}
                  </p>
                </div>
                <div
                  className={`admin-table-wrapper ${styles.tableWrapper}`}
                  data-slot="admin-table-wrapper"
                >
                  <table
                    className={`admin-user-table ${styles.table}`}
                    data-ui="admin-user-table"
                  >
                    <thead>
                      <tr>
                        <th>{t("admin.username")}</th>
                        <th>{t("admin.roleHeader")}</th>
                        <th>{t("admin.status")}</th>
                        <th>{t("admin.createdAt")}</th>
                        <th>{t("admin.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const isDeleted = Boolean(u.deleted_at);
                        const isDisabled = Boolean(u.disabled_at);
                        const isProtectedAdmin = u.role === "admin";
                        return (
                          <tr
                            key={u.uuid}
                            data-entity="admin-user"
                            data-user-uuid={u.uuid}
                          >
                            <td>{u.username}</td>
                            <td>{u.role}</td>
                            <td>
                              {isDeleted
                                ? t("admin.deleted")
                                : isDisabled
                                  ? t("admin.disabled")
                                  : t("admin.enabled")}
                            </td>
                            <td>{new Date(u.created_at).toLocaleString()}</td>
                            <td
                              className={`${styles.actions} ${
                                isDeleted ? styles.actionsCenter : ""
                              }`}
                            >
                              {!isDeleted && (
                                <>
                                  {isDisabled ? (
                                    <button
                                      onClick={() => openConfirm(u, "enable")}
                                      className={styles.action}
                                      data-ui="admin-enable-user-button"
                                      disabled={isProtectedAdmin}
                                    >
                                      {t("admin.enable")}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => openConfirm(u, "disable")}
                                      className={styles.action}
                                      data-ui="admin-disable-user-button"
                                      disabled={isProtectedAdmin}
                                    >
                                      {t("admin.disable")}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => openConfirm(u, "delete")}
                                    className={styles.danger}
                                    data-ui="admin-delete-user-button"
                                    disabled={isProtectedAdmin}
                                  >
                                    {t("admin.markDelete")}
                                  </button>
                                </>
                              )}
                              {isDeleted && (
                                <div className={styles.deletedActions}>
                                  <button
                                    onClick={() => openConfirm(u, "cleanup")}
                                    className={styles.action}
                                    data-ui="admin-cleanup-user-button"
                                    disabled={isProtectedAdmin}
                                  >
                                    {t("admin.cleanup")}
                                  </button>
                                  <span className={styles.muted}>
                                    {t("admin.deleted")}
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {confirmState && (
        <div className={`admin-modal-backdrop ${styles.modalBackdrop}`}>
          <div
            className={`admin-modal ${styles.modal}`}
            data-ui="admin-confirm-modal"
          >
            <h3>{t("admin.confirmAction")}</h3>
            <p className={styles.modalText}>{confirmText(confirmState)}</p>
            <div className={styles.modalActions}>
              <button
                className={styles.secondary}
                onClick={() => setConfirmState(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className={styles.primary}
                onClick={() => {
                  void performAction(confirmState.user, confirmState.action);
                  setConfirmState(null);
                }}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminPage;
