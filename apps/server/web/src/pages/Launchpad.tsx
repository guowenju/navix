import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate, useOutletContext } from "react-router-dom";
import { SelectField } from "@navix/shared-ui";
import {
  ApiRequestError,
  apiFetch,
  apiFetchResponse,
  isAuthError,
} from "../api";
import { clearUserAccessToken, getUserAccessToken } from "../auth/tokenStore";
import Banner from "../components/Banner";
import DynamicIcon from "../components/DynamicIcon";
import { useI18n } from "../i18n/useI18n";
import type { AppShellOutletContext } from "../layouts/AppShell";
import { log } from "../utils/logger";
import iconStyles from "../components/DynamicIcon.module.css";
import styles from "./Launchpad.module.css";
import { APP_ERROR_CODES, type Claims } from "@navix/shared-ts";
import {
  IoChevronDownOutline,
  IoChevronForwardOutline,
  IoCloseOutline,
  IoLockClosedOutline,
  IoLockOpenOutline,
} from "react-icons/io5";

type SearchEngineId = "bing" | "google";
const LOCK_PASSWORD_CLEARED_EVENT = "navix:launchpad-lock-password-cleared";

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
  is_locked: boolean;
  password_required: boolean;
}

interface LaunchpadUnlockResponse {
  group: LaunchpadGroup;
  icon_access_token: string;
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
  background_color: string;
};

type WebsiteIconAction = "keep" | "reset";

type SiteIconCacheEntry = {
  path: string;
  objectUrl: string;
};

type LockDialogState = {
  mode: "unlock" | "setup";
  group: LaunchpadGroup;
};

interface BuiltInSearchEngine {
  id: SearchEngineId;
  name: string;
  url_template: string;
  default_icon: string;
}

const SEARCH_ENGINE_STORAGE_KEY = "launchpadSearchEngine";
const DEFAULT_WEBSITE_ICON = "ion:globe-outline";
const WEBSITE_ICON_MAX_BYTES = 5 * 1024 * 1024;
const WEBSITE_ICON_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "ico",
  "svg",
] as const;

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

interface SortableSiteCardProps {
  site: LaunchpadWebsite;
  isSorting: boolean;
  isSaving: boolean;
  interactionLocked: boolean;
  localIconUrl: string | null;
  defaultIconAlt: string;
  moveLabel: string;
  onOpen: (site: LaunchpadWebsite) => void;
  onContextMenu: (event: React.MouseEvent, site: LaunchpadWebsite) => void;
}

/** 渲染支持鼠标、触屏和键盘拖动的站点卡片。 */
const SortableSiteCard = ({
  site,
  isSorting,
  isSaving,
  interactionLocked,
  localIconUrl,
  defaultIconAlt,
  moveLabel,
  onOpen,
  onContextMenu,
}: SortableSiteCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: site.uuid, disabled: !isSorting || isSaving });

  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? "none" : transition,
      }}
      className={`launchpad-site-card ${styles.siteCard}`}
      data-ui="launchpad-site-card"
      data-entity="launchpad-site"
      data-site-uuid={site.uuid}
      data-sorting={isSorting}
      data-dragging={isDragging}
      data-saving={isSaving}
      data-interaction-locked={interactionLocked}
      {...(isSorting ? attributes : {})}
      {...(isSorting ? listeners : {})}
      aria-label={isSorting ? moveLabel : undefined}
      onClick={(event) => {
        if (interactionLocked) {
          event.preventDefault();
          return;
        }
        onOpen(site);
      }}
      onContextMenu={(event) => {
        if (interactionLocked) {
          event.preventDefault();
          return;
        }
        onContextMenu(event, site);
      }}
    >
      <div className={styles.iconBubble}>
        <DynamicIcon
          alt={site.title}
          className={iconStyles.icon}
          defaultIcon={site.default_icon}
          localIconUrl={localIconUrl}
          fallback={
            <DefaultIcon
              label={site.title.charAt(0).toUpperCase()}
              alt={defaultIconAlt}
            />
          }
        />
      </div>
      <div className={styles.siteContent}>
        <p className={styles.siteTitle}>{site.title}</p>
      </div>
    </article>
  );
};

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
    default_icon: site.default_icon ?? DEFAULT_WEBSITE_ICON,
    local_icon_path: site.local_icon_path ?? null,
    description: site.description ?? "",
    background_color: site.background_color ?? "",
  };
}

/**
 * 为指定分组构造新增站点表单，确保站点默认使用统一的地球图标。
 */
function toCreateForm(groupUuid: string): SiteEditFormState {
  return {
    uuid: "",
    group_uuid: groupUuid,
    title: "",
    url: "",
    url_lan: "",
    default_icon: DEFAULT_WEBSITE_ICON,
    local_icon_path: null,
    description: "",
    background_color: "",
  };
}

/**
 * 在提交前执行浏览器侧的图标文件基础校验，服务端仍会进行权威内容校验。
 */
function validateSelectedIcon(file: File): "size" | "format" | null {
  if (file.size > WEBSITE_ICON_MAX_BYTES) return "size";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return WEBSITE_ICON_EXTENSIONS.includes(
    extension as (typeof WEBSITE_ICON_EXTENSIONS)[number],
  )
    ? null
    : "format";
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

function readCollapsedGroups(value: string | null): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, collapsed]) => typeof collapsed === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

type CollapsedGroupsUpdater = (
  value:
    | Record<string, boolean>
    | ((current: Record<string, boolean>) => Record<string, boolean>),
) => void;

/** 按当前用户存储键同步恢复并持久化折叠状态，避免 StrictMode 重复 effect 覆盖数据。 */
function usePersistedCollapsedGroups(
  storageKey: string,
): [Record<string, boolean>, CollapsedGroupsUpdater] {
  const [state, setState] = useState(() => ({
    storageKey,
    groups: readCollapsedGroups(window.localStorage.getItem(storageKey)),
  }));
  const groups = state.storageKey === storageKey ? state.groups : {};
  const setGroups = useCallback<CollapsedGroupsUpdater>(
    (value) => {
      setState((current) => {
        const currentGroups =
          current.storageKey === storageKey
            ? current.groups
            : readCollapsedGroups(window.localStorage.getItem(storageKey));
        return {
          storageKey,
          groups: typeof value === "function" ? value(currentGroups) : value,
        };
      });
    },
    [storageKey],
  );

  useEffect(() => {
    const groups = readCollapsedGroups(window.localStorage.getItem(storageKey));
    queueMicrotask(() => {
      setState((current) =>
        current.storageKey === storageKey ? current : { storageKey, groups },
      );
    });
  }, [storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state.groups));
    } catch {
      // 浏览器禁用本地存储时仍保留当前会话内的状态。
    }
  }, [state, storageKey]);

  return [groups, setGroups];
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
  const [pendingIconFile, setPendingIconFile] = useState<File | null>(null);
  const [pendingIconUrl, setPendingIconUrl] = useState<string | null>(null);
  const [iconAction, setIconAction] = useState<WebsiteIconAction>("keep");
  const [siteFormError, setSiteFormError] = useState<string | null>(null);
  const [activeGroupUuid, setActiveGroupUuid] = useState<string | null>(null);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [userUuid, setUserUuid] = useState<string | null>(null);
  const collapsedGroupsStorageKey = `navix.launchpad.collapsedGroups:${userUuid ?? "anonymous"}`;
  const [iconErrors, setIconErrors] = useState<Record<string, string>>({});
  const [iconUrls, setIconUrls] = useState<Record<string, SiteIconCacheEntry>>(
    {},
  );
  const [savingSite, setSavingSite] = useState(false);
  const [deletingSiteUuid, setDeletingSiteUuid] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = usePersistedCollapsedGroups(
    collapsedGroupsStorageKey,
  );
  const [unlockedGroups, setUnlockedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [unlockedGroupIconTokens, setUnlockedGroupIconTokens] = useState<
    Record<string, string>
  >({});
  const [unlockingGroupUuid, setUnlockingGroupUuid] = useState<string | null>(
    null,
  );
  const [lockDialog, setLockDialog] = useState<LockDialogState | null>(null);
  const [lockDialogPassword, setLockDialogPassword] = useState("");
  const [lockDialogError, setLockDialogError] = useState<string | null>(null);
  const [lockPasswordBannerGroup, setLockPasswordBannerGroup] =
    useState<LaunchpadGroup | null>(null);
  const [sortingGroupUuid, setSortingGroupUuid] = useState<string | null>(null);
  const [savingOrderGroupUuid, setSavingOrderGroupUuid] = useState<
    string | null
  >(null);
  const [sortError, setSortError] = useState<{
    groupUuid: string;
    message: string;
  } | null>(null);
  const [activeSearchEngineId, setActiveSearchEngineId] =
    useState<SearchEngineId>(getStoredSearchEngineId);
  const [searchEngineMenuOpen, setSearchEngineMenuOpen] = useState(false);
  const siteFormOpen = editSite !== null;

  const iconUrlsRef = useRef<Record<string, SiteIconCacheEntry>>({});
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const lockPasswordBannerRef = useRef<HTMLDivElement | null>(null);
  const searchEngineMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const siteTitleInputRef = useRef<HTMLInputElement | null>(null);
  const siteModalRef = useRef<HTMLDivElement | null>(null);
  const siteFormReturnFocusRef = useRef<HTMLElement | null>(null);
  const iconFileInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarTriggerRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sortingSnapshotRef = useRef<{
    groupUuid: string;
    websites: LaunchpadWebsite[];
  } | null>(null);
  const navigate = useNavigate();
  const { launchpadMode: mode } = useOutletContext<AppShellOutletContext>();
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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
  const loadLaunchpad = useCallback(async (): Promise<boolean> => {
    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
      return false;
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
      const nextLaunchpad = response.data || [];
      setUnlockedGroups({});
      setUnlockedGroupIconTokens({});
      const currentIconPaths = new Map(
        nextLaunchpad
          .flatMap((group) => group.websites)
          .filter(
            (site): site is LaunchpadWebsite & { local_icon_path: string } =>
              Boolean(site.local_icon_path),
          )
          .map((site) => [site.uuid, site.local_icon_path]),
      );
      setIconUrls((previous) => {
        let next = previous;
        for (const [siteUuid, entry] of Object.entries(previous)) {
          if (currentIconPaths.get(siteUuid) === entry.path) continue;
          if (next === previous) next = { ...previous };
          URL.revokeObjectURL(entry.objectUrl);
          delete next[siteUuid];
        }
        return next;
      });
      setIconErrors((previous) => {
        let next = previous;
        for (const [siteUuid, failedPath] of Object.entries(previous)) {
          if (currentIconPaths.get(siteUuid) === failedPath) continue;
          if (next === previous) next = { ...previous };
          delete next[siteUuid];
        }
        return next;
      });
      setLaunchpad(nextLaunchpad);
      return true;
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return false;
      }
      log.error("运行期错误", err);
      setError(t("launchpad.fetchFailed"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    void (async () => {
      await loadLaunchpad();
    })();
  }, [loadLaunchpad]);

  useEffect(() => {
    const handleLockPasswordCleared = () => {
      setLockPasswordBannerGroup(null);
      setUnlockedGroupIconTokens({});
      void loadLaunchpad();
    };
    window.addEventListener(
      LOCK_PASSWORD_CLEARED_EVENT,
      handleLockPasswordCleared,
    );
    return () => {
      window.removeEventListener(
        LOCK_PASSWORD_CLEARED_EVENT,
        handleLockPasswordCleared,
      );
    };
  }, [loadLaunchpad]);

  useEffect(() => {
    if (!lockPasswordBannerGroup) return;
    const frameId = window.requestAnimationFrame(() => {
      lockPasswordBannerRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [lockPasswordBannerGroup]);

  const replaceGroup = useCallback((nextGroup: LaunchpadGroup) => {
    setLaunchpad((current) =>
      current.map((group) =>
        group.uuid === nextGroup.uuid ? nextGroup : group,
      ),
    );
  }, []);

  /** 移除已失效的站点图标缓存，并立即释放对应 Object URL。 */
  const discardSiteIconCache = useCallback(
    (siteUuid: string, nextPath: string | null = null) => {
      setIconUrls((current) => {
        const entry = current[siteUuid];
        if (!entry || entry.path === nextPath) return current;
        URL.revokeObjectURL(entry.objectUrl);
        const next = { ...current };
        delete next[siteUuid];
        return next;
      });
      setIconErrors((current) => {
        if (!(siteUuid in current)) return current;
        const next = { ...current };
        delete next[siteUuid];
        return next;
      });
    },
    [],
  );

  /** 将新增或更新后的站点合并到当前页面，避免全量刷新清空会话解锁状态。 */
  const mergeSavedSite = useCallback(
    (site: LaunchpadWebsite) => {
      setLaunchpad((current) =>
        current.map((group) => {
          const websites = group.websites.filter(
            (currentSite) => currentSite.uuid !== site.uuid,
          );
          if (group.uuid !== site.group_uuid) {
            return websites.length === group.websites.length
              ? group
              : { ...group, websites };
          }
          if (group.is_locked && !unlockedGroups[group.uuid]) {
            return { ...group, websites };
          }
          return { ...group, websites: [...websites, site] };
        }),
      );
    },
    [unlockedGroups],
  );

  /** 获取当前用户最新的分组锁密码配置，避免控制中心修改后页面状态过期。 */
  const getLockPasswordStatus = useCallback(async (token: string) => {
    const response = await apiFetch<{
      configured: boolean;
      password_required: boolean;
    }>("/api/v1/launchpad/lock-password/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return {
      configured: Boolean(response.data?.configured),
      passwordRequired: Boolean(response.data?.password_required),
    };
  }, []);

  const unlockGroupWithPassword = useCallback(
    async (group: LaunchpadGroup, password: string) => {
      if (unlockingGroupUuid) return;
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      setUnlockingGroupUuid(group.uuid);
      try {
        const response = await apiFetch<LaunchpadUnlockResponse>(
          `/api/v1/launchpad/groups/${encodeURIComponent(group.uuid)}/unlock`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ password }),
          },
        );
        const unlocked = response.data;
        if (unlocked) {
          replaceGroup(unlocked.group);
          setUnlockedGroups((current) => ({ ...current, [group.uuid]: true }));
          setUnlockedGroupIconTokens((current) => ({
            ...current,
            [group.uuid]: unlocked.icon_access_token,
          }));
          setCollapsedGroups((current) => ({
            ...current,
            [group.uuid]: false,
          }));
        }
      } finally {
        setUnlockingGroupUuid(null);
      }
    },
    [navigate, replaceGroup, setCollapsedGroups, unlockingGroupUuid],
  );

  const handleUnlockGroup = useCallback(
    async (group: LaunchpadGroup) => {
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      try {
        const status = await getLockPasswordStatus(token);
        const currentGroup = {
          ...group,
          password_required: status.passwordRequired,
        };
        if (status.passwordRequired) {
          setLockDialog({ mode: "unlock", group: currentGroup });
          setLockDialogPassword("");
          setLockDialogError(null);
        } else {
          await unlockGroupWithPassword(currentGroup, "");
        }
      } catch {
        setError(t("launchpad.unlockFailed"));
      }
    },
    [getLockPasswordStatus, navigate, t, unlockGroupWithPassword],
  );

  /**
   * 将分组写入持久锁定状态，并立即清除当前页面中的敏感分组数据。
   */
  const lockGroupPersistently = useCallback(
    async (group: LaunchpadGroup, token: string) => {
      await apiFetch(
        `/api/v1/launchpad/groups/${encodeURIComponent(group.uuid)}/lock`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ locked: true }),
        },
      );
      setLockPasswordBannerGroup(null);
      if (sortingSnapshotRef.current?.groupUuid === group.uuid) {
        sortingSnapshotRef.current = null;
      }
      setSortingGroupUuid((current) =>
        current === group.uuid ? null : current,
      );
      setSortError((current) =>
        current?.groupUuid === group.uuid ? null : current,
      );
      replaceGroup({
        ...group,
        description: null,
        websites: [],
        is_locked: true,
      });
      setUnlockedGroups((current) => {
        const next = { ...current };
        delete next[group.uuid];
        return next;
      });
      setUnlockedGroupIconTokens((current) => {
        const next = { ...current };
        delete next[group.uuid];
        return next;
      });
      setCollapsedGroups((current) => ({ ...current, [group.uuid]: true }));
    },
    [replaceGroup, setCollapsedGroups],
  );

  /**
   * 锁定尚未启用持久锁的分组，缺少密码配置时改为展示上下文横幅。
   */
  const handleLockGroup = useCallback(
    async (group: LaunchpadGroup) => {
      if (unlockingGroupUuid) return;
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      setUnlockingGroupUuid(group.uuid);
      try {
        const status = await getLockPasswordStatus(token);
        if (!status.configured) {
          setLockPasswordBannerGroup(group);
          return;
        }
        await lockGroupPersistently(
          {
            ...group,
            password_required: status.passwordRequired,
          },
          token,
        );
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.code === APP_ERROR_CODES.RequestBadRequest
        ) {
          setLockPasswordBannerGroup(group);
        } else {
          setError(t("launchpad.lockFailed"));
        }
      } finally {
        setUnlockingGroupUuid(null);
      }
    },
    [
      getLockPasswordStatus,
      lockGroupPersistently,
      navigate,
      t,
      unlockingGroupUuid,
    ],
  );

  const handleRelockGroup = useCallback(
    async (group: LaunchpadGroup) => {
      if (unlockingGroupUuid) return;
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      setUnlockingGroupUuid(group.uuid);
      try {
        const status = await getLockPasswordStatus(token);
        if (!status.configured) {
          setLockPasswordBannerGroup(group);
          return;
        }
        await lockGroupPersistently(
          { ...group, password_required: status.passwordRequired },
          token,
        );
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          error.code === APP_ERROR_CODES.RequestBadRequest
        ) {
          setLockPasswordBannerGroup(group);
        } else {
          setError(t("launchpad.lockFailed"));
        }
      } finally {
        setUnlockingGroupUuid(null);
      }
    },
    [
      getLockPasswordStatus,
      lockGroupPersistently,
      navigate,
      t,
      unlockingGroupUuid,
    ],
  );

  const disableGroupLock = useCallback(
    async (group: LaunchpadGroup) => {
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      await apiFetch(
        `/api/v1/launchpad/groups/${encodeURIComponent(group.uuid)}/lock`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ locked: false }),
        },
      );
      setUnlockedGroups((current) => {
        const next = { ...current };
        delete next[group.uuid];
        return next;
      });
      setUnlockedGroupIconTokens((current) => {
        const next = { ...current };
        delete next[group.uuid];
        return next;
      });
      replaceGroup({ ...group, is_locked: false });
    },
    [navigate, replaceGroup],
  );

  const handleDisableGroupLock = useCallback(
    async (group: LaunchpadGroup) => {
      if (unlockingGroupUuid) return;
      const token = getUserAccessToken();
      if (!token) {
        void navigate("/login");
        return;
      }
      setUnlockingGroupUuid(group.uuid);
      try {
        await disableGroupLock(group);
      } catch {
        setError(t("launchpad.disableLockFailed"));
      } finally {
        setUnlockingGroupUuid(null);
      }
    },
    [disableGroupLock, navigate, t, unlockingGroupUuid],
  );

  const submitLockDialog = useCallback(async () => {
    if (!lockDialog) return;
    setLockDialogError(null);
    if (lockDialog.mode === "setup" && !lockDialogPassword.trim()) {
      setLockDialogError(t("launchpad.lockPasswordRequired"));
      return;
    }
    try {
      if (lockDialog.mode === "unlock") {
        await unlockGroupWithPassword(lockDialog.group, lockDialogPassword);
      } else {
        const token = getUserAccessToken();
        if (!token) {
          void navigate("/login");
          return;
        }
        await apiFetch("/api/v1/launchpad/lock-password", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ new_password: lockDialogPassword }),
        });
        await lockGroupPersistently(
          {
            ...lockDialog.group,
            password_required: Boolean(lockDialogPassword.trim()),
          },
          token,
        );
      }
      setLockDialog(null);
      setLockDialogPassword("");
    } catch {
      setLockDialogError(
        lockDialog.mode === "setup"
          ? t("launchpad.lockFailed")
          : t("launchpad.unlockFailed"),
      );
    }
  }, [
    lockDialog,
    lockDialogPassword,
    lockGroupPersistently,
    navigate,
    t,
    unlockGroupWithPassword,
  ]);

  const groupOptions = useMemo(
    () =>
      sortedLaunchpad
        .filter(
          (group) => !group.is_locked || Boolean(unlockedGroups[group.uuid]),
        )
        .map((group) => ({
          uuid: group.uuid,
          name: group.name,
        })),
    [sortedLaunchpad, unlockedGroups],
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
          iconErrors[site.uuid] !== site.local_icon_path &&
          iconUrls[site.uuid]?.path !== site.local_icon_path,
      );

    const fetchIcons = async () => {
      await Promise.all(
        sitesWithLocalIcons.map(async (site) => {
          try {
            const iconAccessToken =
              unlockedGroupIconTokens[site.group_uuid] ?? null;
            const iconUrl = iconAccessToken
              ? `/api/v1/launchpad/groups/${encodeURIComponent(site.group_uuid)}/icons/${encodeURIComponent(site.local_icon_path as string)}`
              : `/api/v1/icons/download/${userUuid}/${encodeURIComponent(site.local_icon_path as string)}`;
            const response = await apiFetchResponse(iconUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
                ...(iconAccessToken
                  ? { "X-Launchpad-Unlock-Token": iconAccessToken }
                  : {}),
              },
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`Icon load failed: ${response.status}`);
            }
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setIconUrls((prev) => {
              const current = prev[site.uuid];
              if (current?.path === site.local_icon_path) {
                URL.revokeObjectURL(objectUrl);
                return prev;
              }
              if (current) URL.revokeObjectURL(current.objectUrl);
              return {
                ...prev,
                [site.uuid]: {
                  path: site.local_icon_path as string,
                  objectUrl,
                },
              };
            });
            setIconErrors((prev) => {
              if (!(site.uuid in prev)) return prev;
              const next = { ...prev };
              delete next[site.uuid];
              return next;
            });
          } catch (err) {
            if (controller.signal.aborted) {
              return;
            }
            log.error("拉取站点图标失败", err);
            setIconErrors((prev) => ({
              ...prev,
              [site.uuid]: site.local_icon_path as string,
            }));
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
  }, [launchpad, userUuid, iconErrors, iconUrls, unlockedGroupIconTokens]);

  useEffect(() => {
    return () => {
      Object.values(iconUrlsRef.current).forEach((entry) =>
        URL.revokeObjectURL(entry.objectUrl),
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
    // 全局监听 Escape，用于在搜索输入未聚焦时仍能清空搜索内容。
    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing
      ) {
        return;
      }

      if (contextMenu || searchEngineMenuOpen) return;

      // 弹窗负责处理自己的 Esc，避免修改被遮挡页面的搜索状态。
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const activeIsTypingField =
        !!active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);

      // 如果焦点在其它输入域并且不是 launchpad 的搜索框，则不干扰
      if (activeIsTypingField && active !== searchInputRef.current) return;

      setSearchTerm((currentSearchTerm) =>
        currentSearchTerm.length > 0 ? "" : currentSearchTerm,
      );
    };

    window.addEventListener("keydown", handleGlobalEscape);
    return () => window.removeEventListener("keydown", handleGlobalEscape);
  }, [contextMenu, searchEngineMenuOpen]);

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

  useEffect(() => {
    return () => {
      if (pendingIconUrl) URL.revokeObjectURL(pendingIconUrl);
    };
  }, [pendingIconUrl]);

  useEffect(() => {
    if (!siteFormOpen) return;
    const frame = window.requestAnimationFrame(() => {
      siteTitleInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [siteFormOpen]);

  /** 打开新增/编辑弹窗前统一重置临时图标和错误状态。 */
  const prepareSiteForm = useCallback((site: SiteEditFormState) => {
    setPendingIconFile(null);
    setPendingIconUrl(null);
    setIconAction("keep");
    setSiteFormError(null);
    if (iconFileInputRef.current) iconFileInputRef.current.value = "";
    setEditSite(site);
  }, []);

  /** 关闭站点表单并把焦点还给打开弹窗的控件。 */
  const closeSiteForm = useCallback(() => {
    setEditSite(null);
    setPendingIconFile(null);
    setPendingIconUrl(null);
    setIconAction("keep");
    setSiteFormError(null);
    window.requestAnimationFrame(() => siteFormReturnFocusRef.current?.focus());
  }, []);

  /** 选择本地图标并创建即时预览。 */
  const handleIconSelection = (file: File | null) => {
    if (!file) return;
    const validationError = validateSelectedIcon(file);
    if (validationError) {
      setPendingIconFile(null);
      setPendingIconUrl(null);
      setSiteFormError(
        validationError === "size"
          ? t("launchpad.iconTooLarge")
          : t("launchpad.iconInvalidFormat"),
      );
      if (iconFileInputRef.current) iconFileInputRef.current.value = "";
      return;
    }

    setPendingIconFile(file);
    setPendingIconUrl(URL.createObjectURL(file));
    setIconAction("keep");
    setSiteFormError(null);
  };

  /** 清除已选或已有本地图标，保存后恢复默认地球图标。 */
  const handleResetSiteIcon = () => {
    setPendingIconFile(null);
    setPendingIconUrl(null);
    setIconAction("reset");
    setSiteFormError(null);
    if (iconFileInputRef.current) iconFileInputRef.current.value = "";
    setEditSite((current) =>
      current
        ? {
            ...current,
            default_icon: DEFAULT_WEBSITE_ICON,
            local_icon_path: null,
          }
        : current,
    );
  };

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

  /** 恢复进入排序模式前的站点顺序。 */
  const restoreSortingSnapshot = () => {
    const snapshot = sortingSnapshotRef.current;
    if (!snapshot) return;

    setLaunchpad((current) =>
      current.map((group) =>
        group.uuid === snapshot.groupUuid
          ? { ...group, websites: snapshot.websites }
          : group,
      ),
    );
    sortingSnapshotRef.current = null;
    setSortingGroupUuid(null);
  };

  /** 更新搜索词，并在开始筛选时放弃尚未确认的排序。 */
  const handleSearchTermChange = (value: string) => {
    setSearchTerm(value);
    if (value.trim()) {
      restoreSortingSnapshot();
      setSortError(null);
    }
  };

  /** 进入排序模式，或在点击完成后一次性保存站点顺序。 */
  const handleToggleSorting = async (groupUuid: string) => {
    if (savingOrderGroupUuid || searchTerm.trim()) return;

    if (sortingGroupUuid !== groupUuid) {
      if (sortingGroupUuid) return;
      const group = launchpad.find((item) => item.uuid === groupUuid);
      if (!group) return;
      sortingSnapshotRef.current = {
        groupUuid,
        websites: group.websites.map((site) => ({ ...site })),
      };
      setSortingGroupUuid(groupUuid);
      setSortError(null);
      setContextMenu(null);
      return;
    }

    const group = launchpad.find((item) => item.uuid === groupUuid);
    const snapshot = sortingSnapshotRef.current;
    if (!group || !snapshot || snapshot.groupUuid !== groupUuid) return;

    const itemUuids = group.websites.map((site) => site.uuid);
    const originalItemUuids = snapshot.websites.map((site) => site.uuid);
    const orderChanged = itemUuids.some(
      (itemUuid, index) => itemUuid !== originalItemUuids[index],
    );

    if (!orderChanged) {
      sortingSnapshotRef.current = null;
      setSortingGroupUuid(null);
      setSortError(null);
      return;
    }

    const token = getUserAccessToken();
    if (!token) {
      clearUserAccessToken();
      void navigate("/login");
      return;
    }

    setSavingOrderGroupUuid(groupUuid);
    setSortError(null);

    try {
      await apiFetch(
        `/api/v1/launchpad/groups/${encodeURIComponent(groupUuid)}/items/order`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ item_uuids: itemUuids }),
        },
      );
      sortingSnapshotRef.current = null;
      setSortingGroupUuid(null);
    } catch (error) {
      if (isAuthError(error)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("Failed to update website order", error);
      restoreSortingSnapshot();
      setSortError({
        groupUuid,
        message: t("launchpad.sortFailed"),
      });
    } finally {
      setSavingOrderGroupUuid(null);
    }
  };

  /** 仅更新本地站点顺序，点击完成排序后再统一持久化。 */
  const handleSiteDragEnd = (groupUuid: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || savingOrderGroupUuid) return;

    const group = launchpad.find((item) => item.uuid === groupUuid);
    if (!group) return;
    const oldIndex = group.websites.findIndex(
      (site) => site.uuid === String(active.id),
    );
    const newIndex = group.websites.findIndex(
      (site) => site.uuid === String(over.id),
    );
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedSites = arrayMove(group.websites, oldIndex, newIndex).map(
      (site, index) => ({ ...site, sort_order: index + 1 }),
    );
    setLaunchpad((current) =>
      current.map((item) =>
        item.uuid === groupUuid ? { ...item, websites: reorderedSites } : item,
      ),
    );
    setSortError(null);
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
        closeSiteForm();
      }
      discardSiteIconCache(site.uuid);
      setLaunchpad((current) =>
        current.map((group) => ({
          ...group,
          websites: group.websites.filter(
            (currentSite) => currentSite.uuid !== site.uuid,
          ),
        })),
      );
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
   * 提交当前新增或编辑中的站点，并把可选图标与表单放在同一次 multipart 请求中。
   */
  const handleSaveSite = async () => {
    if (!editSite) {
      return;
    }

    if (!editSite.title.trim()) {
      setSiteFormError(t("launchpad.titleRequired"));
      return;
    }
    if (!editSite.url.trim()) {
      setSiteFormError(t("launchpad.urlRequired"));
      return;
    }
    if (!isValidUrl(editSite.url.trim())) {
      setSiteFormError(t("launchpad.invalidUrl"));
      return;
    }
    if (editSite.url_lan.trim() && !isValidUrl(editSite.url_lan.trim())) {
      setSiteFormError(t("launchpad.invalidLanUrl"));
      return;
    }
    if (!editSite.group_uuid) {
      setSiteFormError(t("launchpad.groupRequired"));
      return;
    }

    const token = getUserAccessToken();
    if (!token) {
      void navigate("/login");
      return;
    }

    setSavingSite(true);
    setSiteFormError(null);
    try {
      const isCreating = !editSite.uuid;
      const payload = {
        title: editSite.title.trim(),
        url: editSite.url.trim(),
        url_lan: editSite.url_lan.trim() || null,
        group_uuid: editSite.group_uuid,
        description: editSite.description.trim() || null,
        background_color: editSite.background_color || null,
        ...(isCreating
          ? {}
          : {
              default_icon: editSite.default_icon,
              icon_action: iconAction,
            }),
      };
      const body = new FormData();
      body.append("payload", JSON.stringify(payload));
      if (pendingIconFile) body.append("icon", pendingIconFile);

      const response = await apiFetch<LaunchpadWebsite>(
        isCreating
          ? "/api/v1/launchpad/items"
          : `/api/v1/launchpad/items/${editSite.uuid}`,
        {
          method: isCreating ? "POST" : "PUT",
          headers: { Authorization: `Bearer ${token}` },
          body,
        },
      );
      if (!response.data) {
        throw new Error("Website response did not include the saved item");
      }
      discardSiteIconCache(response.data.uuid, response.data.local_icon_path);
      mergeSavedSite(response.data);
      closeSiteForm();
      setContextMenu(null);
    } catch (err) {
      if (isAuthError(err)) {
        clearUserAccessToken();
        void navigate("/login");
        return;
      }
      log.error("运行期错误", err);
      setSiteFormError(
        editSite.uuid ? t("launchpad.saveFailed") : t("launchpad.createFailed"),
      );
    } finally {
      setSavingSite(false);
    }
  };

  /** 捕获弹窗内 Escape，并把 Tab 焦点约束在当前对话框中。 */
  const handleSiteFormKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !savingSite) {
      event.preventDefault();
      closeSiteForm();
      return;
    }
    if (event.key !== "Tab" || !siteModalRef.current) return;

    const focusable = Array.from(
      siteModalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
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
                  ref={searchInputRef}
                  type="search"
                  className={styles.searchInput}
                  data-ui="launchpad-search-input"
                  placeholder={t("launchpad.searchPlaceholder")}
                  value={searchTerm}
                  onChange={(event) =>
                    handleSearchTermChange(event.target.value)
                  }
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
                {filteredLaunchpad.map((group) => {
                  const isSorting = sortingGroupUuid === group.uuid;
                  const isSavingOrder = savingOrderGroupUuid === group.uuid;
                  const isLocked =
                    group.is_locked && !unlockedGroups[group.uuid];
                  const isCollapsed =
                    isLocked || Boolean(collapsedGroups[group.uuid]);
                  const sortingDisabled =
                    Boolean(searchTerm.trim()) ||
                    group.websites.length < 2 ||
                    Boolean(
                      sortingGroupUuid && sortingGroupUuid !== group.uuid,
                    ) ||
                    Boolean(savingOrderGroupUuid);
                  const sortLabel = isSavingOrder
                    ? t("launchpad.sortSaving")
                    : isSorting
                      ? t("launchpad.sortDone")
                      : t("launchpad.sortSites");

                  return (
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
                      data-sorting={isSorting}
                    >
                      <div
                        className={`launchpad-group-header ${styles.groupHeader}`}
                        data-slot="launchpad-group-header"
                      >
                        <div className={styles.groupTitleRow}>
                          <p className={styles.groupName}>{group.name}</p>
                          <button
                            type="button"
                            className={styles.groupActionButton}
                            data-ui="launchpad-lock-group"
                            data-group-uuid={group.uuid}
                            aria-label={
                              isLocked
                                ? t("launchpad.unlockGroup")
                                : t("launchpad.lockGroup")
                            }
                            data-tooltip={
                              isLocked
                                ? t("launchpad.unlockGroup")
                                : t("launchpad.lockGroup")
                            }
                            onClick={() => {
                              if (isLocked) {
                                void handleUnlockGroup(group);
                              } else if (group.is_locked) {
                                void handleRelockGroup(group);
                              } else {
                                void handleLockGroup(group);
                              }
                            }}
                            disabled={unlockingGroupUuid === group.uuid}
                          >
                            {isLocked ? (
                              <IoLockClosedOutline aria-hidden="true" />
                            ) : (
                              <IoLockOpenOutline aria-hidden="true" />
                            )}
                          </button>
                          {!isLocked ? (
                            <>
                              {group.is_locked && unlockedGroups[group.uuid] ? (
                                <button
                                  type="button"
                                  className={styles.groupActionButton}
                                  data-ui="launchpad-disable-group-lock"
                                  data-group-uuid={group.uuid}
                                  aria-label={t("launchpad.disableLock")}
                                  data-tooltip={t("launchpad.disableLock")}
                                  onClick={() =>
                                    void handleDisableGroupLock(group)
                                  }
                                  disabled={unlockingGroupUuid === group.uuid}
                                >
                                  <IoCloseOutline aria-hidden="true" />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={styles.groupActionButton}
                                data-ui="launchpad-toggle-group"
                                data-group-uuid={group.uuid}
                                aria-label={
                                  isLocked
                                    ? t("launchpad.unlockGroup")
                                    : isCollapsed
                                      ? t("launchpad.expandGroup")
                                      : t("launchpad.collapseGroup")
                                }
                                aria-expanded={!isCollapsed}
                                aria-controls={`launchpad-group-grid-${group.uuid}`}
                                data-tooltip={
                                  isLocked
                                    ? t("launchpad.unlockGroup")
                                    : isCollapsed
                                      ? t("launchpad.expandGroup")
                                      : t("launchpad.collapseGroup")
                                }
                                onClick={() => {
                                  if (isSorting) setSortingGroupUuid(null);
                                  setCollapsedGroups((current) => ({
                                    ...current,
                                    [group.uuid]: !current[group.uuid],
                                  }));
                                }}
                                disabled={isLocked}
                              >
                                {isCollapsed ? (
                                  <IoChevronForwardOutline aria-hidden="true" />
                                ) : (
                                  <IoChevronDownOutline aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                className={styles.groupActionButton}
                                data-ui="launchpad-sort-sites"
                                data-group-uuid={group.uuid}
                                data-active={isSorting}
                                aria-label={sortLabel}
                                aria-pressed={isSorting}
                                data-tooltip={
                                  sortingDisabled && !isSorting
                                    ? undefined
                                    : sortLabel
                                }
                                disabled={
                                  isSavingOrder ||
                                  (sortingDisabled && !isSorting)
                                }
                                onClick={() =>
                                  void handleToggleSorting(group.uuid)
                                }
                              >
                                {isSorting ? (
                                  <svg
                                    viewBox="0 0 512 512"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M465 127 241 384l-92-92m-9 93-93-93m316-165L236 273"
                                      stroke="currentColor"
                                      strokeWidth="44"
                                      strokeLinecap="square"
                                      strokeMiterlimit="10"
                                    />
                                  </svg>
                                ) : (
                                  <svg
                                    viewBox="0 0 512 512"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M464 208 352 96 240 208m112-94.87V416M48 304l112 112 112-112m-112 94V96"
                                      stroke="currentColor"
                                      strokeWidth="32"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </button>
                              <button
                                type="button"
                                className={styles.groupActionButton}
                                data-ui="launchpad-add-site"
                                data-group-uuid={group.uuid}
                                aria-label={t("launchpad.addToGroup", {
                                  group: group.name,
                                })}
                                data-tooltip={
                                  sortingGroupUuid || savingOrderGroupUuid
                                    ? undefined
                                    : t("launchpad.addSite")
                                }
                                disabled={Boolean(
                                  sortingGroupUuid || savingOrderGroupUuid,
                                )}
                                onClick={(event) => {
                                  siteFormReturnFocusRef.current =
                                    event.currentTarget;
                                  prepareSiteForm(toCreateForm(group.uuid));
                                }}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M12 5v14M5 12h14"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </button>
                            </>
                          ) : null}
                        </div>
                        {!isLocked ? (
                          <span className={styles.groupBadge}>
                            {t("launchpad.sitesCount", {
                              count: group.websites.length,
                            })}
                          </span>
                        ) : null}
                      </div>
                      {lockPasswordBannerGroup?.uuid === group.uuid ? (
                        <div
                          ref={lockPasswordBannerRef}
                          className={styles.groupNotice}
                          data-slot="launchpad-group-notice"
                        >
                          <Banner
                            variant="warning"
                            title={t("launchpad.lockPasswordMissingTitle")}
                            description={t("launchpad.lockPasswordMissingHint")}
                            actionLabel={t("launchpad.setLockPassword")}
                            dismissLabel={t("common.close")}
                            dataUi="launchpad-lock-password-banner"
                            onAction={() => {
                              setLockDialog({ mode: "setup", group });
                              setLockDialogPassword("");
                              setLockDialogError(null);
                              setLockPasswordBannerGroup(null);
                            }}
                            onDismiss={() => setLockPasswordBannerGroup(null)}
                          />
                        </div>
                      ) : null}
                      {!isLocked && sortError?.groupUuid === group.uuid ? (
                        <p
                          className={styles.sortError}
                          data-ui="launchpad-sort-error"
                          data-group-uuid={group.uuid}
                          role="alert"
                        >
                          {sortError.message}
                        </p>
                      ) : null}
                      {!isCollapsed && (
                        <DndContext
                          sensors={sortSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event) =>
                            handleSiteDragEnd(group.uuid, event)
                          }
                        >
                          <SortableContext
                            items={group.websites.map((site) => site.uuid)}
                            strategy={rectSortingStrategy}
                            disabled={!isSorting || isSavingOrder}
                          >
                            <div
                              className={`launchpad-site-grid ${styles.siteGrid}`}
                              data-slot="launchpad-site-grid"
                              id={`launchpad-group-grid-${group.uuid}`}
                              data-sorting={isSorting}
                              data-saving={isSavingOrder}
                            >
                              {group.websites.map((site) => (
                                <SortableSiteCard
                                  key={site.uuid}
                                  site={site}
                                  isSorting={isSorting}
                                  isSaving={isSavingOrder}
                                  interactionLocked={Boolean(
                                    sortingGroupUuid || savingOrderGroupUuid,
                                  )}
                                  localIconUrl={
                                    site.local_icon_path &&
                                    iconUrls[site.uuid]?.path ===
                                      site.local_icon_path &&
                                    iconErrors[site.uuid] !==
                                      site.local_icon_path
                                      ? iconUrls[site.uuid].objectUrl
                                      : null
                                  }
                                  defaultIconAlt={t("launchpad.defaultIcon")}
                                  moveLabel={t("launchpad.moveSite", {
                                    title: site.title,
                                  })}
                                  onOpen={handleOpenSite}
                                  onContextMenu={handleContextMenu}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      )}
                    </section>
                  );
                })}
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
            onClick={(event) => {
              siteFormReturnFocusRef.current = event.currentTarget;
              prepareSiteForm(toEditForm(contextMenu.site));
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

      {lockDialog ? (
        <div
          className={styles.lockModalOverlay}
          data-ui="launchpad-lock-modal"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLockDialog(null);
          }}
        >
          <form
            className={styles.lockModal}
            onSubmit={(event) => {
              event.preventDefault();
              void submitLockDialog();
            }}
          >
            <div className={styles.lockModalHeader}>
              <div>
                <p className={styles.modalEyebrow}>
                  {t("launchpad.groupLock")}
                </p>
                <h2 className={styles.lockModalTitle}>
                  {lockDialog.group.name}
                </h2>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={() => setLockDialog(null)}
                aria-label={t("common.close")}
              >
                ×
              </button>
            </div>
            <p className={styles.lockModalHint}>
              {lockDialog.mode === "setup"
                ? t("launchpad.newLockPassword")
                : t("launchpad.unlockPassword")}
            </p>
            <input
              autoFocus
              className={styles.formControl}
              type="password"
              required
              value={lockDialogPassword}
              onChange={(event) => setLockDialogPassword(event.target.value)}
              data-ui="launchpad-lock-password-input"
            />
            {lockDialogError ? (
              <p className={styles.formError} role="alert">
                {lockDialogError}
              </p>
            ) : null}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setLockDialog(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={unlockingGroupUuid !== null}
              >
                {t("common.confirm")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editSite && (
        <div
          className={`launchpad-site-modal-overlay ${styles.modalOverlay}`}
          data-ui="launchpad-site-modal-overlay"
          onClick={() => {
            if (!savingSite) {
              closeSiteForm();
            }
          }}
        >
          <div
            ref={siteModalRef}
            className={`launchpad-site-modal ${styles.modalCard}`}
            data-ui="launchpad-site-editor"
            data-entity="launchpad-site"
            data-mode={editSite.uuid ? "edit" : "create"}
            data-site-uuid={editSite.uuid || undefined}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleSiteFormKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label={
              editSite.uuid
                ? t("launchpad.editTitle")
                : t("launchpad.createTitle")
            }
          >
            <header className={styles.modalHeader}>
              <div className={styles.modalIdentity}>
                <div className={styles.iconBubble}>
                  <DynamicIcon
                    alt={editSite.title || t("launchpad.newSite")}
                    className={iconStyles.icon}
                    defaultIcon={editSite.default_icon}
                    localIconUrl={
                      pendingIconUrl ??
                      (editSite.uuid &&
                      iconAction === "keep" &&
                      editSite.local_icon_path &&
                      iconUrls[editSite.uuid]?.path ===
                        editSite.local_icon_path &&
                      iconErrors[editSite.uuid] !== editSite.local_icon_path
                        ? iconUrls[editSite.uuid].objectUrl
                        : null)
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
                  <p className={styles.modalEyebrow}>
                    {editSite.uuid
                      ? t("launchpad.edit")
                      : t("launchpad.addSite")}
                  </p>
                  <p className={styles.siteTitle}>
                    {editSite.title || t("launchpad.newSite")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={styles.modalCloseButton}
                onClick={closeSiteForm}
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
            <form
              data-ui="launchpad-site-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveSite();
              }}
            >
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
                      ref={siteTitleInputRef}
                      className={styles.formControl}
                      data-ui="launchpad-site-title-input"
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
                    data-ui="launchpad-site-url-input"
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
                    data-ui="launchpad-site-lan-url-input"
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
                    data-ui="launchpad-site-description-input"
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

                <div
                  className={styles.iconUploadField}
                  data-ui="launchpad-site-icon-upload"
                >
                  <div className={styles.iconUploadCopy}>
                    <span className={styles.modalLabel}>
                      {t("launchpad.siteIcon")}
                    </span>
                    <p className={styles.iconUploadHint}>
                      {t("launchpad.iconUploadHint")}
                    </p>
                    {pendingIconFile ? (
                      <p
                        className={styles.iconFileName}
                        data-ui="launchpad-site-icon-file-name"
                      >
                        {pendingIconFile.name}
                      </p>
                    ) : null}
                  </div>
                  <div className={styles.iconUploadActions}>
                    <input
                      ref={iconFileInputRef}
                      className={styles.visuallyHiddenInput}
                      data-ui="launchpad-site-icon-input"
                      id="launchpad-site-icon-input"
                      type="file"
                      tabIndex={-1}
                      accept=".png,.jpg,.jpeg,.webp,.gif,.ico,.svg,image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/svg+xml"
                      onChange={(event) =>
                        handleIconSelection(event.target.files?.[0] ?? null)
                      }
                      disabled={savingSite}
                    />
                    <button
                      type="button"
                      className={styles.iconActionButton}
                      data-ui="launchpad-site-icon-select"
                      onClick={() => iconFileInputRef.current?.click()}
                      disabled={savingSite}
                      aria-label={t("launchpad.uploadIcon")}
                      title={t("launchpad.uploadIcon")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15.5v2.25A2.25 2.25 0 0 0 7.25 20h9.5A2.25 2.25 0 0 0 19 17.75V15.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.iconActionButton}
                      data-ui="launchpad-site-icon-reset"
                      onClick={handleResetSiteIcon}
                      disabled={savingSite}
                      aria-label={t("launchpad.useDefaultIcon")}
                      title={t("launchpad.useDefaultIcon")}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle
                          cx="12"
                          cy="12"
                          r="8.5"
                          stroke="currentColor"
                          strokeWidth="1.7"
                        />
                        <path
                          d="M3.8 12h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5S14.1 18.2 12 20.5C9.9 18.2 8.8 15.4 8.8 12S9.9 5.8 12 3.5Z"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {siteFormError ? (
                  <p
                    className={styles.formError}
                    data-ui="launchpad-site-form-error"
                    role="alert"
                  >
                    {siteFormError}
                  </p>
                ) : null}
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={closeSiteForm}
                  disabled={savingSite}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  data-ui="launchpad-site-submit"
                  disabled={savingSite}
                >
                  {savingSite
                    ? t("launchpad.saving")
                    : editSite.uuid
                      ? t("launchpad.save")
                      : t("launchpad.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default LaunchpadPage;
