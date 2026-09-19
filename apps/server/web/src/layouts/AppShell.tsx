import { useState, type Dispatch, type SetStateAction } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearUserAccessToken } from "../auth/tokenStore";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useI18n } from "../i18n/useI18n";
import ControlCenter, {
  type ControlCenterSection,
} from "../components/ControlCenter";
import Banner, { type BannerNotice } from "../components/Banner";
import styles from "./AppShell.module.css";

export type LaunchpadMode = "wan" | "lan";

export type AppShellOutletContext = {
  launchpadMode: LaunchpadMode;
  setLaunchpadMode: Dispatch<SetStateAction<LaunchpadMode>>;
};

/**
 * 渲染登录后的应用外壳，负责页面内容区、控制中心入口和全局偏好设置传递。
 */
const AppShell = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useCurrentUser({ redirectTo: "/login" });
  const {
    backgroundName,
    contentInset,
    cycleBackground,
    launchpadSidebarEnabled,
    locale,
    setContentInset,
    setLaunchpadSidebarEnabled,
    setLocale,
    themeName,
    toggleTheme,
    t,
  } = useI18n();
  const isAdmin = user?.roles?.includes("admin");
  const [launchpadMode, setLaunchpadMode] = useState<LaunchpadMode>("lan");
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [activeControlCenterSection, setActiveControlCenterSection] =
    useState<ControlCenterSection>("account");
  const [bannerNotice, setBannerNotice] = useState<BannerNotice | null>(null);
  const isLaunchpadRoute = location.pathname === "/launchpad";

  const handleLogout = () => {
    setIsControlCenterOpen(false);
    setBannerNotice(null);
    clearUserAccessToken();
    void navigate("/login", { replace: true });
  };

  return (
    <div className={styles.shell} data-ui="app-shell">
      <main className={styles.content} data-slot="app-shell-content">
        <div className={styles.pageActions} data-slot="app-shell-page-actions">
          {isLaunchpadRoute ? (
            <button
              type="button"
              className={styles.pageActionButton}
              data-ui="launchpad-mode-toggle"
              aria-label={`${t("launchpad.currentMode")}: ${
                launchpadMode === "wan" ? t("common.wan") : t("common.lan")
              }`}
              title={`${t("launchpad.currentMode")}: ${
                launchpadMode === "wan" ? t("common.wan") : t("common.lan")
              }`}
              onClick={() =>
                setLaunchpadMode((prev) => (prev === "wan" ? "lan" : "wan"))
              }
            >
              {launchpadMode === "wan" ? (
                <svg
                  aria-hidden="true"
                  className={styles.pageActionIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M12 3a9 9 0 1 0 0 18m0-18c2.4 2.19 3.75 5.28 3.75 9S14.4 18.81 12 21m0-18C9.6 5.19 8.25 8.28 8.25 12S9.6 18.81 12 21m-8.25-9h16.5M4.96 7.5h14.08M4.96 16.5h14.08"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  className={styles.pageActionIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M4.75 9.75 12 4l7.25 5.75v8.5A1.75 1.75 0 0 1 17.5 20h-11a1.75 1.75 0 0 1-1.75-1.75v-8.5Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                  <path
                    d="M9.25 20v-4.75c0-.69.56-1.25 1.25-1.25h3c.69 0 1.25.56 1.25 1.25V20"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </svg>
              )}
            </button>
          ) : null}

          {user?.username ? (
            <button
              type="button"
              className={styles.pageActionButton}
              data-ui="control-center-toggle"
              aria-label={t("nav.controlCenter")}
              title={t("nav.controlCenter")}
              data-open={isControlCenterOpen}
              onClick={() => {
                if (isControlCenterOpen) {
                  setIsControlCenterOpen(false);
                  setActiveControlCenterSection("account");
                  return;
                }
                setActiveControlCenterSection("account");
                setIsControlCenterOpen(true);
              }}
            >
              <span className={styles.userActionAvatar} aria-hidden="true">
                {user.username.trim().charAt(0).toUpperCase() || "U"}
              </span>
            </button>
          ) : null}
        </div>
        <Outlet context={{ launchpadMode, setLaunchpadMode }} />
      </main>
      <ControlCenter
        key={
          isControlCenterOpen ? "control-center-open" : "control-center-closed"
        }
        isOpen={isControlCenterOpen}
        activeSection={activeControlCenterSection}
        currentUser={user}
        isAdmin={Boolean(isAdmin)}
        locale={locale}
        themeName={themeName}
        backgroundName={backgroundName}
        contentInset={contentInset}
        launchpadSidebarEnabled={launchpadSidebarEnabled}
        onClose={() => {
          setIsControlCenterOpen(false);
          setActiveControlCenterSection("account");
        }}
        onSelectSection={setActiveControlCenterSection}
        onToggleLocale={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
        onToggleTheme={toggleTheme}
        onCycleBackground={cycleBackground}
        onChangeContentInset={setContentInset}
        onToggleLaunchpadSidebar={() =>
          setLaunchpadSidebarEnabled(!launchpadSidebarEnabled)
        }
        onNotify={setBannerNotice}
        onLogout={handleLogout}
      />
      {bannerNotice ? (
        <div
          className={styles.notificationLayer}
          data-ui="app-notification-layer"
        >
          <Banner
            variant={bannerNotice.variant}
            title={bannerNotice.title}
            description={bannerNotice.description}
            dismissLabel={t("common.close")}
            dataUi="app-notification-banner"
            onDismiss={() => setBannerNotice(null)}
          />
        </div>
      ) : null}
    </div>
  );
};

export default AppShell;
