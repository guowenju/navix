import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ApiRequestError, apiFetchRaw } from "../api";
import { apiFetch } from "../api";
import { setCurrentUserSession } from "../auth/tokenStore";
import AuthLayout from "../components/AuthLayout";
import { useI18n } from "../i18n/useI18n";
import { log } from "../utils/logger";

type AuthTokenResponse = {
  access_token: string;
  token_type: string;
  refresh_token: string;
};

type BootstrapStatusResponse = {
  initialized: boolean;
};

/**
 * 渲染登录页面，负责初始化状态检查、管理员初始化和显式登录流程。
 */
const LoginPage = () => {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [initialized, setInitialized] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { message?: unknown } | null;
  const notification =
    typeof locationState?.message === "string" ? locationState.message : null;

  useEffect(() => {
    let active = true;

    /**
     * 读取初始化状态，决定当前页面展示首次初始化还是普通登录表单。
     */
    const fetchBootstrapStatus = async () => {
      setBootstrapLoading(true);
      setError(null);
      try {
        const resp = await apiFetch<BootstrapStatusResponse>(
          "/api/bootstrap/status",
        );
        if (!active) {
          return;
        }
        setInitialized(resp.data?.initialized ?? true);
      } catch (err) {
        log.error("运行期错误", err);
        if (!active) {
          return;
        }
        const isNetworkFailure =
          !window.navigator.onLine || err instanceof TypeError;
        setError(
          t(
            isNetworkFailure
              ? "auth.bootstrapStatusNetworkFailed"
              : "auth.bootstrapStatusFailed",
          ),
        );
      } finally {
        if (active) {
          setBootstrapLoading(false);
        }
      }
    };

    void fetchBootstrapStatus();
    return () => {
      active = false;
    };
  }, [t]);

  /**
   * 提交登录表单并按角色跳转到对应页面。
   * @param event React 表单提交事件
   */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (!initialized) {
        await apiFetch<null>("/api/bootstrap/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        setInitialized(true);
        void navigate("/login", {
          replace: true,
          state: { message: t("auth.bootstrapSuccess") },
        });
        return;
      }

      const data = await apiFetchRaw<AuthTokenResponse>("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (data.access_token) {
        setCurrentUserSession(data.access_token, data.refresh_token);
        void navigate("/launchpad");
      } else {
        setError(t("auth.invalidCredential"));
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message || t("auth.loginFailed"));
      } else {
        setError(t("auth.requestFailed"));
      }
      log.error("运行期错误", err);
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    void handleSubmit(event);
  };

  /**
   * 根据系统初始化状态切换登录页标题和提交按钮文案。
   */
  const cardTitle = bootstrapLoading
    ? t("common.loading")
    : initialized
      ? t("auth.loginTitle")
      : t("auth.bootstrapTitle");
  const cardDescription = initialized ? t("auth.loginDescription") : "";
  const submitLabel = initialized
    ? t("auth.loginButton")
    : t("auth.bootstrapButton");

  return (
    <AuthLayout
      pageName="login"
      cardTitle={cardTitle}
      cardDescription={cardDescription}
    >
      {notification && (
        <div className="message success" data-ui="login-notification">
          {notification}
        </div>
      )}

      <form
        onSubmit={handleFormSubmit}
        className="auth-form"
        data-ui="login-form"
        style={{
          marginTop: notification ? "1rem" : "0",
        }}
      >
        <div className="form-group" data-slot="login-username-group">
          <label htmlFor="username">{t("auth.username")}</label>
          <input
            type="text"
            id="username"
            className="form-input"
            data-ui="login-username-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={bootstrapLoading}
            required
          />
        </div>
        <div className="form-group" data-slot="login-password-group">
          <label htmlFor="password">{t("auth.password")}</label>
          <input
            type="password"
            id="password"
            className="form-input"
            data-ui="login-password-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={bootstrapLoading}
            required
          />
        </div>
        <button
          type="submit"
          className="form-button"
          data-ui="login-submit-button"
          disabled={bootstrapLoading}
        >
          {submitLabel}
        </button>
      </form>

      {error && (
        <div className="message error" data-ui="login-error">
          {error}
        </div>
      )}
    </AuthLayout>
  );
};

export default LoginPage;
