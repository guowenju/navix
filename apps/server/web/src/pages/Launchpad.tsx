import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { SelectField } from "@navix/shared-ui";
import { apiFetch, apiFetchResponse, isAuthError } from "../api";
import { clearUserAccessToken, getUserAccessToken } from "../auth/tokenStore";
import DynamicIcon from "../components/DynamicIcon";
import { useI18n } from "../i18n/useI18n";
import type { AppShellOutletContext } from "../layouts/AppShell";
import { log } from "../utils/logger";
import iconStyles from "../components/DynamicIcon.module.css";
import styles from "./Launchpad.module.css";
import type { Claims } from "@navix/shared-ts";

type SearchEngineId = "bing" | "google";

interface LaunchpadWebsite {
  uuid: string;
  group_uuid: string;
  title: string;
  url: string;
  url_lan?: string | null;
  default_icon?: string | null;
  local_icon_path?: string | null;
  background_color?: string | null;
  description?: string | null;
  sort_order?: number | null;
}

interface LaunchpadGroup {
  uuid: string;
  name: string;
  description?: string | null;
  sort_order?: number | null;
  websites: LaunchpadWebsite[];
}

type SiteContextMenuState = {
  site: LaunchpadWebsite;
  x: number;
  y: number;
};

type SiteEditFormState = {
  uuid: string;
  group_uuid: string;
  title: string;
  url: string;
  url_lan: string;
  default_icon: string;
  local_icon_path: string | null;
  description: string;
};

interface BuiltInSearchEngine {
  id: SearchEngineId;
  name: string;
  url_template: string;
  default_icon: string;
}

const SEARCH_ENGINE_STORAGE_KEY = "launchpadSearchEngine";

const builtInSearchEngines: BuiltInSearchEngine[] = [
  {
    id: "bing",
    name: "Bing",
    url_template: "https://cn.bing.com/search?q=%s",
    default_icon: "logos:bing",
  },
  {
    id: "google",
    name: "Google",
    url_template: "https://www.google.com/search?q=%s",
    default_icon: "devicon:google",
  },
];

/**
 * 渲染启动台站点的默认图标，在缺少自定义图标时展示品牌化占位图形。
 */
const DefaultIcon = ({ label, alt }: { label: string; alt: string }) => (
  <div className={styles.defaultIcon}>
    <svg viewBox="0 0 48 48" role="img" aria-label={alt}>
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3dd5f3" />
          <stop offset="100%" stopColor="#6c8bff" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#grad)" opacity="0.95" />
      <path
        d="M10 27c6 2.5 12.5 2.5 19 0 1-.4 1.5-1.7.9-2.6C27.5 17 22.5 14 17 14c-3.6 0-6.8 1.4-9.5 4-.9.9-.5 2.4.5 2.9z"
        fill="#0c1220"
        opacity="0.38"
      />
      <circle cx="32" cy="16" r="3" fill="#e9f5ff" />
      <circle cx="16" cy="30" r="2" fill="#e9f5ff" opacity="0.8" />
    </svg>
    <span className={styles.defaultIconLabel}>{label}</span>
  </div>
);

/**
 * 把服务端返回的站点数据映射成编辑弹窗使用的表单状态。
 *
 * 这里保留 default_icon / local_icon_path，即使当前弹窗不暴露图标字段，
 * 保存时也能继续透传已有值，避免用户编辑其他字段时把图标意外清空。
 */
function toEditForm(site: LaunchpadWebsite): SiteEditFormState {
  return {
    uuid: site.uuid,
    group_uuid: site.group_uuid,
    title: site.title,
    url: site.url,
    url_lan: site.url_lan ?? "",
    default_icon: site.default_icon ?? "",
    local_icon_path: site.local_icon_path ?? null,
    description: site.description ?? "",
  };
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getStoredSearchEngineId(): SearchEngineId {
  if (typeof window === "undefined") {
    return "bing";
  }

  const storedValue = window.localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY);
  return storedValue === "google" ? "google" : "bing";
}

/**
 * 渲染启动台主页面，提供搜索、分组导航、站点管理和显示模式切换。
 */
const LaunchpadPage = () => {
  const { launchpadSidebarEnabled, t } = useI18n();
  const [launchpad, setLaunchpad] = useState<LaunchpadGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<SiteContextMenuState | null>(
    null,
  );
  const [editSite, setEditSite] = useState<SiteEditFormState | null>(null);
  const [activeGroupUuid, setActiveGroupUuid] = useState<string | null>(null);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [userUuid, setUserUuid] = useState<string | null>(null);
  const [iconErrors, setIconErrors] = useState<Record<string, boolean>>({});
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});
  const [savingSite, setSavingSite] = useState(false);
  const [deletingSiteUuid, setDeletingSiteUuid] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSearchEngineId, setActiveSearchEngineId] =
    useState<SearchEngineId>(getStoredSearchEngineId);
  const [searchEngineMenuOpen, setSearchEngineMenuOpen] = useState(false);

  const iconUrlsRef = useRef<Record<string, string>>({});
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const searchEngineMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarTriggerRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { launchpadMode: mode } = useOutletContext<AppShellOutletContext>();

  const sortedLaunchpad = useMemo(() => {
    const byOrderThen = <T extends { sort_order?: number | null }>(
      a: T,
      b: T,
      fallback: (x: T, y: T) => number,
    ) => {
      const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return fallback(a, b);
    };

    const sortedGroups = [...launchpad]
      .map((group) => ({
        ...group,
        websites: [...group.websites].sort((a, b) =>
          byOrderThen(a, b, (x, y) => x.title.localeCompare(y.title)),
        ),
      }))
      .sort((a, b) =>
        byOrderThen(a, b, (x, y) => x.name.localeCompare(y.name)),
      );

    return sortedGroups;
  }, [launchpad]);

  /**
   * 拉取导航基础数据和当前用户信息。
   *
   * 站点本地图标依赖 userUuid 拼接下载地址，因此这里先拿 welcome，
   * 再加载 launchpad 列表，后续图标 effect 才能补齐本地图标展示。
   */
  const loadLaunchpad = useCallback(async () => {
    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const welcomeResp = await apiFetch<Claims>("/api/v1/welcome", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserUuid(welcomeResp.data?.sub ?? null);

      const response = await apiFetch<LaunchpadGroup[]>("/api/v1/launchpad", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLaunchpad(response.data || []);
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      setError(t("launchpad.fetchFailed"));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    void (async () => {
      await loadLaunchpad();
    })();
  }, [loadLaunchpad]);

  const groupOptions = useMemo(
    () =>
      sortedLaunchpad.map((group) => ({
        uuid: group.uuid,
        name: group.name,
      })),
    [sortedLaunchpad],
  );
  const activeSearchEngine = useMemo(
    () =>
      builtInSearchEngines.find(
        (engine) => engine.id === activeSearchEngineId,
      ) ?? builtInSearchEngines[0],
    [activeSearchEngineId],
  );
  const filteredLaunchpad = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    if (!normalizedSearchTerm) {
      return sortedLaunchpad;
    }

    return sortedLaunchpad
      .map((group) => {
        const isGroupMatch = group.name
          .toLowerCase()
          .includes(normalizedSearchTerm);

        if (isGroupMatch) {
          return group;
        }

        const matchingSites = group.websites.filter((site) => {
          const normalizedDescription = site.description?.toLowerCase() ?? "";
          return (
            site.title.toLowerCase().includes(normalizedSearchTerm) ||
            normalizedDescription.includes(normalizedSearchTerm)
          );
        });

        if (matchingSites.length === 0) {
          return null;
        }

        return {
          ...group,
          websites: matchingSites,
        };
      })
      .filter((group): group is LaunchpadGroup => group !== null);
  }, [searchTerm, sortedLaunchpad]);
  const resolvedActiveGroupUuid = useMemo(() => {
    if (!launchpadSidebarEnabled || filteredLaunchpad.length === 0) {
      return null;
    }

    return filteredLaunchpad.some((group) => group.uuid === activeGroupUuid)
      ? activeGroupUuid
      : filteredLaunchpad[0].uuid;
  }, [activeGroupUuid, filteredLaunchpad, launchpadSidebarEnabled]);

  useEffect(() => {
    iconUrlsRef.current = iconUrls;
  }, [iconUrls]);

  const closeSidebar = useCallback(() => {
    setSidebarHovered(false);
  }, []);

  useEffect(() => {
    if (
      !sidebarHovered ||
      !launchpadSidebarEnabled ||
      filteredLaunchpad.length === 0
    ) {
      return;
    }

    const isInsideSidebarZone = (target: EventTarget | null) =>
      target instanceof Node &&
      (sidebarTriggerRef.current?.contains(target) ||
        sidebarRef.current?.contains(target));

    const handlePointerMove = (event: PointerEvent) => {
      if (!isInsideSidebarZone(event.target)) {
        closeSidebar();
      }
    };
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        closeSidebar();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        closeSidebar();
      }
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", closeSidebar);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", closeSidebar);
    };
  }, [
    closeSidebar,
    filteredLaunchpad.length,
    launchpadSidebarEnabled,
    sidebarHovered,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      SEARCH_ENGINE_STORAGE_KEY,
      activeSearchEngineId,
    );
  }, [activeSearchEngineId]);

  useEffect(() => {
    const token = getUserAccessToken();
    if (!token || !userUuid) {
      return;
    }

    const controller = new AbortController();
    const sitesWithLocalIcons = launchpad
      .flatMap((group) => group.websites)
      .filter(
        (site) =>
          site.local_icon_path &&
          !iconErrors[site.uuid] &&
          !iconUrls[site.uuid],
      );

    const fetchIcons = async () => {
      await Promise.all(
        sitesWithLocalIcons.map(async (site) => {
          try {
            const response = await apiFetchResponse(
              `/api/v1/icons/download/${userUuid}/${site.local_icon_path}`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
              },
            );
            if (!response.ok) {
              throw new Error(`Icon load failed: ${response.status}`);
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            setIconUrls((prev) => {
              if (prev[site.uuid]) {
                URL.revokeObjectURL(objectUrl);
                return prev;
              }
              return { ...prev, [site.uuid]: objectUrl };
            });
          } catch (err) {
            if (controller.signal.aborted) {
              return;
            }
            log.error("拉取站点图标失败", err);
            setIconErrors((prev) => ({ ...prev, [site.uuid]: true }));
          }
        }),
      );
    };

    if (sitesWithLocalIcons.length > 0) {
      void fetchIcons();
    }

    return () => {
      controller.abort();
    };
  }, [launchpad, userUuid, iconErrors, iconUrls]);

  useEffect(() => {
    return () => {
      Object.values(iconUrlsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!searchEngineMenuOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (
        searchEngineMenuRef.current &&
        event.target instanceof Node &&
        !searchEngineMenuRef.current.contains(event.target)
      ) {
        setSearchEngineMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchEngineMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [searchEngineMenuOpen]);

  useEffect(() => {
    if (!launchpadSidebarEnabled || filteredLaunchpad.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visibleEntries.length > 0) {
          setActiveGroupUuid(visibleEntries[0].target.id);
        }
      },
      {
        root: null,
        rootMargin: "-120px 0px -45% 0px",
        threshold: [0.1, 0.35, 0.6],
      },
    );

    filteredLaunchpad.forEach((group) => {
      const element = groupRefs.current[group.uuid];
      if (element) {
        observer.observe(element);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [launchpadSidebarEnabled, filteredLaunchpad]);

  const getSiteUrlForMode = (site: LaunchpadWebsite) =>
    mode === "lan" && site.url_lan ? site.url_lan : site.url;

  const handleSearch = () => {
    const normalizedSearchTerm = searchTerm.trim();
    if (!normalizedSearchTerm) {
      return;
    }

    const encodedSearchTerm = encodeURIComponent(normalizedSearchTerm);
    const searchUrl = activeSearchEngine.url_template.includes("%s")
      ? activeSearchEngine.url_template.replace("%s", encodedSearchTerm)
      : `${activeSearchEngine.url_template}${encodedSearchTerm}`;

    window.open(searchUrl, "_blank", "noopener,noreferrer");
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      handleSearch();
    }
  };

  const handleOpenSite = (site: LaunchpadWebsite) => {
    window.open(getSiteUrlForMode(site), "_blank", "noopener,noreferrer");
  };

  const handleContextMenu = (e: React.MouseEvent, site: LaunchpadWebsite) => {
    e.preventDefault();
    setContextMenu({
      site,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 260),
    });
  };

  const handleClearSearch = () => {
    setSearchTerm("");
  };

  const handleDeleteSite = async (site: LaunchpadWebsite) => {
    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
      return;
    }

    const confirmed = window.confirm(
      t("launchpad.deleteConfirm", { title: site.title }),
    );
    if (!confirmed) {
      return;
    }

    setDeletingSiteUuid(site.uuid);
    try {
      await apiFetch(`/api/v1/launchpad/items/${site.uuid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setContextMenu(null);
      if (editSite?.uuid === site.uuid) {
        setEditSite(null);
      }
      await loadLaunchpad();
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      window.alert(t("launchpad.deleteFailed"));
    } finally {
      setDeletingSiteUuid(null);
    }
  };

  /**
   * 提交当前编辑中的站点。
   *
   * 这条链路只暴露本期规划的基础字段，但请求体会继续带上已有的 default_icon，
   * 避免现有图标资产在本期 UI 收敛后被覆盖掉。
   */
  const handleSaveSite = async () => {
    if (!editSite) {
      return;
    }

    if (!editSite.title.trim()) {
      window.alert(t("launchpad.titleRequired"));
      return;
    }
    if (!editSite.url.trim()) {
      window.alert(t("launchpad.urlRequired"));
      return;
    }
    if (!isValidUrl(editSite.url.trim())) {
      window.alert(t("launchpad.invalidUrl"));
      return;
    }
    if (editSite.url_lan.trim() && !isValidUrl(editSite.url_lan.trim())) {
      window.alert(t("launchpad.invalidLanUrl"));
      return;
    }
    if (!editSite.group_uuid) {
      window.alert(t("launchpad.groupRequired"));
      return;
    }

    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
      return;
    }

    setSavingSite(true);
    try {
      await apiFetch(`/api/v1/launchpad/items/${editSite.uuid}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editSite.title,
          url: editSite.url,
          url_lan: editSite.url_lan,
          group_uuid: editSite.group_uuid,
          default_icon: editSite.default_icon,
          description: editSite.description,
        }),
      });
      setEditSite(null);
      setContextMenu(null);
      await loadLaunchpad();
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      window.alert(t("launchpad.saveFailed"));
    } finally {
      setSavingSite(false);
    }
  };

  return (
    <>
      <div
        className={`launchpad-page ${styles.pageShell}`}
        data-page="launchpad"
        data-ui="launchpad-page"
      >
        {loading && (
          <div className={styles.stateCard} data-ui="launchpad-loading">
            {t("launchpad.loading")}
          </div>
        )}
        {!loading && error && (
          <div
            className={`${styles.stateCard} ${styles.error}`}
            data-ui="launchpad-error"
          >
            {error}
          </div>
        )}
        {!loading && !error ? (
          <div className={styles.pageLayout} data-slot="launchpad-layout">
            <section
              className={styles.searchSection}
              data-ui="launchpad-search"
            >
              <div
                className={styles.searchBar}
                ref={searchEngineMenuRef}
                data-ui="launchpad-search-bar"
              >
                <div className={styles.searchEngineArea}>
                  <button
                    type="button"
                    className={styles.searchEngineTrigger}
                    data-ui="launchpad-search-engine-trigger"
                    aria-haspopup="menu"
                    aria-expanded={searchEngineMenuOpen}
                    onClick={() =>
                      setSearchEngineMenuOpen((prevOpen) => !prevOpen)
                    }
                  >
                    <span
                      className={styles.searchEngineIcon}
                      aria-hidden="true"
                    >
                      <DynamicIcon
                        alt={activeSearchEngine.name}
                        className={`${iconStyles.icon} ${styles.searchEngineGraphic}`}
                        defaultIcon={activeSearchEngine.default_icon}
                        unstyled
                        fallback={
                          <DefaultIcon
                            label={activeSearchEngine.name.charAt(0)}
                            alt={activeSearchEngine.name}
                          />
                        }
                      />
                    </span>
                    <span className={styles.searchEngineName}>
                      {activeSearchEngine.name}
                    </span>
                    <span
                      className={styles.searchEngineArrow}
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 20 20" fill="none">
                        <path
                          d="m5 7.5 5 5 5-5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>
                  {searchEngineMenuOpen ? (
                    <div
                      className={styles.searchEngineMenu}
                      data-ui="launchpad-search-engine-menu"
                      role="menu"
                    >
                      {builtInSearchEngines.map((engine) => (
                        <button
                          key={engine.id}
                          type="button"
                          className={styles.searchEngineOption}
                          data-active={engine.id === activeSearchEngine.id}
                          onClick={() => {
                            setActiveSearchEngineId(engine.id);
                            setSearchEngineMenuOpen(false);
                          }}
                        >
                          <span
                            className={styles.searchEngineOptionIcon}
                            aria-hidden="true"
                          >
                            <DynamicIcon
                              alt={engine.name}
                              className={`${iconStyles.icon} ${styles.searchEngineGraphic}`}
                              defaultIcon={engine.default_icon}
                              unstyled
                              fallback={
                                <DefaultIcon
                                  label={engine.name.charAt(0)}
                                  alt={engine.name}
                                />
                              }
                            />
                          </span>
                          <span>{engine.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <input
                  id="launchpad-search"
                  type="search"
                  className={styles.searchInput}
                  data-ui="launchpad-search-input"
                  placeholder={t("launchpad.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />

                <div className={styles.searchActions}>
                  {searchTerm.trim() ? (
                    <button
                      type="button"
                      className={styles.searchIconButton}
                      data-ui="launchpad-search-clear"
                      aria-label={t("common.cancel")}
                      onClick={handleClearSearch}
                    >
                      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path
                          d="m5 5 10 10M15 5 5 15"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.searchIconButton} ${styles.searchSubmitButton}`}
                    data-ui="launchpad-search-submit"
                    aria-label={t("launchpad.searchLabel")}
                    onClick={handleSearch}
                  >
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path
                        d="m14.5 14.5 3 3M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </section>

            {filteredLaunchpad.length > 0 && launchpadSidebarEnabled ? (
              <>
                <div
                  ref={sidebarTriggerRef}
                  className={styles.groupSidebarTrigger}
                  data-ui="launchpad-sidebar-trigger"
                  onMouseEnter={() => setSidebarHovered(true)}
                >
                  <span className={styles.groupSidebarHint} aria-hidden="true">
                    <span className={styles.groupSidebarHintLine} />
                    <span className={styles.groupSidebarHintArrow}>
                      <svg viewBox="0 0 24 24" fill="none">
                        <path
                          d="m9 6 6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </span>
                </div>
                <aside
                  ref={sidebarRef}
                  className={`launchpad-group-sidebar ${styles.groupSidebar}`}
                  data-ui="launchpad-sidebar"
                  data-visible={sidebarHovered}
                  aria-label={t("launchpad.groupSidebar")}
                  onMouseEnter={() => setSidebarHovered(true)}
                  onMouseLeave={closeSidebar}
                >
                  <div className={styles.groupSidebarRail}>
                    {filteredLaunchpad.map((group) => (
                      <button
                        key={group.uuid}
                        type="button"
                        className={styles.groupSidebarButton}
                        data-ui="launchpad-sidebar-button"
                        data-entity="launchpad-group"
                        data-group-uuid={group.uuid}
                        data-active={resolvedActiveGroupUuid === group.uuid}
                        onClick={() => {
                          const section = groupRefs.current[group.uuid];
                          if (section) {
                            section.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                            setActiveGroupUuid(group.uuid);
                          }
                          closeSidebar();
                        }}
                      >
                        {group.name}
                      </button>
                    ))}
                  </div>
                </aside>
              </>
            ) : null}

            {filteredLaunchpad.length > 0 ? (
              <div
                className={`launchpad-group-list ${styles.groupList}`}
                data-slot="launchpad-group-list"
              >
                {filteredLaunchpad.map((group) => (
                  <section
                    key={group.uuid}
                    id={group.uuid}
                    ref={(element) => {
                      groupRefs.current[group.uuid] = element;
                    }}
                    className={`launchpad-group-card ${styles.groupCard}`}
                    data-ui="launchpad-group-card"
                    data-entity="launchpad-group"
                    data-group-uuid={group.uuid}
                  >
                    <div
                      className={`launchpad-group-header ${styles.groupHeader}`}
                      data-slot="launchpad-group-header"
                    >
                      <p className={styles.groupName}>{group.name}</p>
                      <span className={styles.groupBadge}>
                        {t("launchpad.sitesCount", {
                          count: group.websites.length,
                        })}
                      </span>
                    </div>
                    <div
                      className={`launchpad-site-grid ${styles.siteGrid}`}
                      data-slot="launchpad-site-grid"
                    >
                      {group.websites.map((site) => (
                        <article
                          key={site.uuid}
                          className={`launchpad-site-card ${styles.siteCard}`}
                          data-ui="launchpad-site-card"
                          data-entity="launchpad-site"
                          data-site-uuid={site.uuid}
                          onClick={() => handleOpenSite(site)}
                          onContextMenu={(e) => handleContextMenu(e, site)}
                        >
                          <div className={styles.iconBubble}>
                            <DynamicIcon
                              alt={site.title}
                              className={iconStyles.icon}
                              defaultIcon={site.default_icon}
                              localIconUrl={
                                site.local_icon_path &&
                                iconUrls[site.uuid] &&
                                !iconErrors[site.uuid]
                                  ? iconUrls[site.uuid]
                                  : null
                              }
                              fallback={
                                <DefaultIcon
                                  label={site.title.charAt(0).toUpperCase()}
                                  alt={t("launchpad.defaultIcon")}
                                />
                              }
                            />
                          </div>
                          <div className={styles.siteContent}>
                            <p className={styles.siteTitle}>{site.title}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : launchpad.length === 0 ? (
              <div className={styles.stateCard} data-ui="launchpad-empty">
                {t("launchpad.empty")}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <div
          className={`launchpad-context-menu ${styles.contextMenu}`}
          data-ui="launchpad-context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={styles.contextMenuButton}
            data-ui="launchpad-context-edit"
            onClick={() => {
              setEditSite(toEditForm(contextMenu.site));
              setContextMenu(null);
            }}
          >
            {t("launchpad.edit")}
          </button>
          <button
            type="button"
            className={`${styles.contextMenuButton} ${styles.dangerButton}`}
            data-ui="launchpad-context-delete"
            onClick={() => void handleDeleteSite(contextMenu.site)}
            disabled={deletingSiteUuid === contextMenu.site.uuid}
          >
            {deletingSiteUuid === contextMenu.site.uuid
              ? t("launchpad.deleting")
              : t("launchpad.delete")}
          </button>
        </div>
      ) : null}

      {editSite && (
        <div
          className={`launchpad-site-modal-overlay ${styles.modalOverlay}`}
          data-ui="launchpad-site-modal-overlay"
          onClick={() => {
            if (!savingSite) {
              setEditSite(null);
            }
          }}
        >
          <div
            className={`launchpad-site-modal ${styles.modalCard}`}
            data-ui="launchpad-site-editor"
            data-entity="launchpad-site"
            data-site-uuid={editSite.uuid}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("launchpad.editTitle")}
          >
            <header className={styles.modalHeader}>
              <div className={styles.modalIdentity}>
                <div className={styles.iconBubble}>
                  <DynamicIcon
                    alt={editSite.title}
                    className={iconStyles.icon}
                    defaultIcon={editSite.default_icon}
                    localIconUrl={
                      editSite.local_icon_path &&
                      iconUrls[editSite.uuid] &&
                      !iconErrors[editSite.uuid]
                        ? iconUrls[editSite.uuid]
                        : null
                    }
                    fallback={
                      <DefaultIcon
                        label={editSite.title.charAt(0).toUpperCase() || "?"}
                        alt={t("launchpad.defaultIcon")}
                      />
                    }
                  />
                </div>
                <div className={styles.modalIdentityText}>
                  <p className={styles.modalEyebrow}>{t("launchpad.edit")}</p>
                  <p className={styles.siteTitle}>{editSite.title}</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setEditSite(null)}
                aria-label={t("common.close")}
                disabled={savingSite}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m6 6 12 12M18 6 6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>
            <div className={styles.modalBody}>
              <div className={styles.modalSectionGrid}>
                <label className={styles.formField}>
                  <span className={styles.modalLabel}>
                    {t("launchpad.group")}
                  </span>
                  <SelectField
                    value={editSite.group_uuid}
                    dataUi="launchpad-group-select"
                    options={groupOptions.map((group) => ({
                      value: group.uuid,
                      label: group.name,
                    }))}
                    onChange={(value) =>
                      setEditSite((prev) =>
                        prev ? { ...prev, group_uuid: value } : prev,
                      )
                    }
                  />
                </label>
                <label className={styles.formField}>
                  <span className={styles.modalLabel}>
                    {t("launchpad.siteTitle")}
                  </span>
                  <input
                    className={styles.formControl}
                    value={editSite.title}
                    onChange={(event) =>
                      setEditSite((prev) =>
                        prev ? { ...prev, title: event.target.value } : prev,
                      )
                    }
                  />
                </label>
              </div>
              <label className={styles.formField}>
                <span className={styles.modalLabel}>
                  {t("launchpad.editTarget")}
                </span>
                <input
                  className={styles.formControl}
                  value={editSite.url}
                  placeholder="https://example.com"
                  onChange={(event) =>
                    setEditSite((prev) =>
                      prev ? { ...prev, url: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className={styles.formField}>
                <span className={styles.modalLabel}>
                  {t("launchpad.editLanTarget")}
                </span>
                <input
                  className={styles.formControl}
                  value={editSite.url_lan}
                  placeholder="http://192.168.1.100"
                  onChange={(event) =>
                    setEditSite((prev) =>
                      prev ? { ...prev, url_lan: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <label className={styles.formField}>
                <span className={styles.modalLabel}>
                  {t("launchpad.description")}
                </span>
                <textarea
                  className={`${styles.formControl} ${styles.formTextarea}`}
                  value={editSite.description}
                  onChange={(event) =>
                    setEditSite((prev) =>
                      prev
                        ? { ...prev, description: event.target.value }
                        : prev,
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.ghostButton}
                onClick={() => setEditSite(null)}
                disabled={savingSite}
              >
                {t("common.cancel")}
              </button>
              <button
                className={styles.primaryButton}
                onClick={() => void handleSaveSite()}
                disabled={savingSite}
              >
                {savingSite ? t("launchpad.saving") : t("launchpad.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LaunchpadPage;
