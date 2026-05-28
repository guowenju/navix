import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { useI18n } from "../i18n/useI18n";
import { log } from "../utils/logger";
import styles from "./Footer.module.css";
import type { VersionInfo } from "@navix/shared-ts";

/**
 * 渲染 Web 页面底部版本信息，并在挂载后读取后端版本号。
 */
const Footer = () => {
  const { t } = useI18n();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await apiFetch<VersionInfo>("/api/version");
        setVersionInfo(response.data ?? null);
      } catch (error) {
        log.error("无法获取后端版本信息", error);
      }
    };

    void fetchVersion();
  }, []); // 空依赖数组确保只在组件挂载时执行一次

  return (
    <footer className={styles.appFooter} data-ui="app-footer">
      {versionInfo ? `v${versionInfo.version}` : t("footer.versionLoading")}
    </footer>
  );
};

export default Footer;
