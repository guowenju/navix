import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, isAuthError } from "../api";
import { clearUserAccessToken, getUserAccessToken } from "../auth/tokenStore";
import { useI18n } from "../i18n/useI18n";
import { log } from "../utils/logger";
import styles from "./UserSettings.module.css";
import type { Claims } from "@navix/shared-ts";

interface Message {
  text: string;
  type: "success" | "error";
}

type UserInfo = Claims;

/**
 * 渲染用户设置页面，支持查看用户信息、修改用户名和修改密码。
 */
const UserSettingsPage = () => {
  const { t } = useI18n();
  const [usernameForm, setUsernameForm] = useState({ new_username: "" });
  const [passwordForm, setPasswordForm] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });

  const [usernameMessage, setUsernameMessage] = useState<Message | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<Message | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserInfo = async () => {
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }

      try {
        const response = await apiFetch<UserInfo>("/api/v1/welcome", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUserInfo(response.data ?? null);
      } catch (err) {
        clearUserAccessToken();
        void navigate("/login");
        log.error("运行期错误", err);
      }
    };

    void fetchUserInfo();
  }, [navigate]);

  /**
   * 处理用户名修改
   */
  const handleChangeUsername = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setUsernameMessage(null);

    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
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
      setTimeout(() => {
        clearUserAccessToken();
        void navigate("/login");
      }, 2000);
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      setUsernameMessage({ text: t("settings.requestFailed"), type: "error" });
      log.error("运行期错误", err);
    }
  };

  /**
   * 处理密码修改
   */
  const handleChangePassword = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
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
      void navigate("/login");
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
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      setPasswordMessage({ text: t("settings.requestFailed"), type: "error" });
      log.error("运行期错误", err);
    }
  };

  const handleUsernameFormSubmit = (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    void handleChangeUsername(event);
  };

  const handlePasswordFormSubmit = (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    void handleChangePassword(event);
  };

  return (
    <div
      className={`user-settings-page ${styles.pageShell}`}
      data-page="user-settings"
      data-ui="user-settings-page"
    >
      <div
        className={`user-settings-top-bar ${styles.topBar}`}
        data-slot="user-settings-top-bar"
      >
        <h1 className={styles.title}>{t("settings.title")}</h1>
      </div>

      <section
        className={`user-settings-hero-card ${styles.heroCard}`}
        data-ui="user-settings-hero-card"
      >
        <div>
          <p className={styles.heroLabel}>{t("settings.currentUser")}</p>
          <p className={styles.heroName}>
            {userInfo ? userInfo.username : t("common.loading")}
          </p>
          <p className={styles.heroMeta}>
            ID: {userInfo ? userInfo.sub : t("common.unknown")}
          </p>
        </div>
        <div className={styles.heroBadge}>{t("settings.security")}</div>
      </section>

      <div
        className={`user-settings-grid ${styles.settingsGrid}`}
        data-slot="user-settings-grid"
      >
        <section
          className={`user-settings-card ${styles.card}`}
          data-ui="user-settings-username-card"
        >
          <div
            className={`user-settings-card-header ${styles.cardHeader}`}
            data-slot="user-settings-card-header"
          >
            <h3>{t("settings.changeUsername")}</h3>
            <p>{t("settings.usernameHint")}</p>
          </div>
          <form
            onSubmit={handleUsernameFormSubmit}
            className={styles.cardForm}
            data-ui="user-settings-username-form"
          >
            <label htmlFor="new_username">{t("settings.newUsername")}</label>
            <input
              type="text"
              id="new_username"
              data-ui="user-settings-username-input"
              value={usernameForm.new_username}
              onChange={(e) =>
                setUsernameForm({ new_username: e.target.value })
              }
              required
            />
            <button type="submit" data-ui="user-settings-username-submit">
              {t("settings.updateUsername")}
            </button>
          </form>
          {usernameMessage && (
            <div
              className={`${styles.inlineMessage} ${usernameMessage.type}`}
              data-ui="user-settings-username-message"
            >
              {usernameMessage.text}
            </div>
          )}
        </section>

        <section
          className={`user-settings-card ${styles.card}`}
          data-ui="user-settings-password-card"
        >
          <div
            className={`user-settings-card-header ${styles.cardHeader}`}
            data-slot="user-settings-card-header"
          >
            <h3>{t("settings.changePassword")}</h3>
            <p>{t("settings.passwordHint")}</p>
          </div>
          <form
            onSubmit={handlePasswordFormSubmit}
            className={styles.cardForm}
            data-ui="user-settings-password-form"
          >
            <label htmlFor="old_password">{t("auth.oldPassword")}</label>
            <input
              type="password"
              id="old_password"
              data-ui="user-settings-old-password-input"
              value={passwordForm.old_password}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  old_password: e.target.value,
                })
              }
              required
            />

            <label htmlFor="new_password">{t("auth.newPassword")}</label>
            <input
              type="password"
              id="new_password"
              data-ui="user-settings-new-password-input"
              value={passwordForm.new_password}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  new_password: e.target.value,
                })
              }
              required
            />

            <label htmlFor="confirm_password">
              {t("auth.confirmPassword")}
            </label>
            <input
              type="password"
              id="confirm_password"
              data-ui="user-settings-confirm-password-input"
              value={passwordForm.confirm_password}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  confirm_password: e.target.value,
                })
              }
              required
            />
            <button type="submit" data-ui="user-settings-password-submit">
              {t("settings.updatePassword")}
            </button>
          </form>
          {passwordMessage && (
            <div
              className={`${styles.inlineMessage} ${passwordMessage.type}`}
              data-ui="user-settings-password-message"
            >
              {passwordMessage.text}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default UserSettingsPage;
