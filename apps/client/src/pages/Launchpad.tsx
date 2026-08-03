import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import {
  WebsiteGroup,
  WebsiteItem,
  SearchEngine,
} from "@/features/Launchpad/types";
import EditWebsiteItemModal from "@/features/Launchpad/components/EditWebsiteItemModal";
import * as launchpadDb from "@/services/launchpadDb";
import Loading from "@/components/common/Loading";
import WebsiteGroupSection from "@/features/Launchpad/components/WebsiteGroupSection";
import ContextMenu from "@/features/Launchpad/components/ContextMenu";
import { useEnvironment } from "@/contexts/Environment.context";
import { useAuth } from "@/contexts/Auth.context";
import { log } from "@/utils/logger";
import {
  LaunchpadIndexContainer,
  LaunchpadPageHeader,
  HeaderSection,
  Title,
  SearchContainer,
  SearchInput,
  SearchIconsContainer,
  ClearIcon,
  SearchButtonIcon,
  LaunchpadPageActionsContainer,
  SearchEngineIcon,
} from "@/styles/launchpad/index.styles";
import { useTranslation } from "react-i18next";
import ConfigModal from "@/features/Launchpad/components/ConfigModal";
import { useModal } from "@/contexts";
import DynamicIcon from "@/components/common/DynamicIcon";
import { StyledButton } from "@/components/styled/StyledButton";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { IconRefreshProvider } from "@/contexts";
import SearchEngineManagementModal from "@/features/Launchpad/components/SearchEngineManagementModal";
import useLocalStorage from "@/hooks/useLocalStorage";
import { openLink } from "@/utils/browser";
import { LaunchpadSettingsProvider, useLaunchpadSettings } from "@/contexts";

// --- 内置搜索引擎 ---
const builtInSearchEngines: SearchEngine[] = [
  {
    id: "bing",
    uuid: "bing-builtin",
    name: "Bing",
    url_template: "https://cn.bing.com/search?q=%s",
    default_icon: "logos:bing",
    is_deletable: 0,
  },
  {
    id: "google",
    uuid: "google-builtin",
    name: "Google",
    url_template: "https://www.google.com/search?q=%s",
    default_icon: "devicon:google",
    is_deletable: 0,
  },
];

const LaunchpadPageContent: React.FC = () => {
  const { t } = useTranslation();
  const { environment, toggleEnvironment } = useEnvironment();
  // 从 useAuth 中获取 dataVersion，认领完成后刷新界面
  const { activeUser, dataVersion } = useAuth();
  const { sideMargin } = useLaunchpadSettings();
  const [groups, setGroups] = useState<WebsiteGroup[]>([]);
  const [items, setItems] = useState<WebsiteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNavConfigModalOpen, setIsNavConfigModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WebsiteItem | null>(null);
  const [targetGroupUuid, setTargetGroupUuid] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: WebsiteItem;
  } | null>(null);

  const [allSearchEngines, setAllSearchEngines] = useState<SearchEngine[]>([]);
  const [activeEngineUuid, setActiveEngineUuid] = useLocalStorage<string>(
    "activeSearchEngineUuid",
    "bing-builtin",
  );
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeSearchEngine = useMemo(() => {
    return (
      allSearchEngines.find((engine) => engine.uuid === activeEngineUuid) ||
      builtInSearchEngines[0]
    );
  }, [allSearchEngines, activeEngineUuid]);

  const { hasOpenModal, openAlert, openConfirm } = useModal();

  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollPosRef = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const showAlert = useCallback(
    (title: string, message: string) => {
      openAlert({ title, message });
    },
    [openAlert],
  );

  const loadSearchEngines = useCallback(async () => {
    if (!activeUser?.uuid) return;
    const customEngines = await launchpadDb.getSearchEngines(activeUser.uuid);
    const dbDefaultEngine = await launchpadDb.getDefaultSearchEngine(
      activeUser.uuid,
    );
    const combined = [...builtInSearchEngines, ...customEngines];
    setAllSearchEngines(combined);

    if (dbDefaultEngine) {
      setActiveEngineUuid(dbDefaultEngine.uuid);
    } else {
      const exists = combined.some((e) => e.uuid === activeEngineUuid);
      if (!exists) {
        setActiveEngineUuid("bing-builtin");
      }
    }
  }, [activeUser, setActiveEngineUuid, activeEngineUuid]);

  const loadData = useCallback(async () => {
    if (!activeUser?.uuid) return;
    setIsLoading(true);
    await Promise.all([
      (async () => {
        const { groups: fetchedGroups, items: fetchedItems } =
          await launchpadDb.getLaunchpadData(activeUser.uuid);
        setGroups(fetchedGroups);
        setItems(fetchedItems);
      })(),
      loadSearchEngines(),
    ]);
    setIsLoading(false);
  }, [activeUser, loadSearchEngines]);

  useEffect(() => {
    scrollContainerRef.current = document.querySelector(".app-main");
    void Promise.resolve().then(() => {
      void loadData();
    });
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [loadData, dataVersion]);

  useLayoutEffect(() => {
    // 先恢复滚动再渲染下一帧，可避免刷新后“回到顶部再跳回”造成的抖动感。
    if (scrollContainerRef.current && scrollPosRef.current !== null) {
      scrollContainerRef.current.scrollTop = scrollPosRef.current;
      scrollPosRef.current = null;
    }
  }, [groups, items]);

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

      // 上下文菜单位于搜索结果上层，Esc 应优先关闭菜单。
      if (contextMenu) {
        event.preventDefault();
        setContextMenu(null);
        return;
      }

      if (
        hasOpenModal ||
        isNavConfigModalOpen ||
        isItemModalOpen ||
        isEngineModalOpen
      )
        return;

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
  }, [
    contextMenu,
    hasOpenModal,
    isNavConfigModalOpen,
    isItemModalOpen,
    isEngineModalOpen,
  ]);

  const handleNavConfigModalClose = (refresh?: boolean) => {
    setIsNavConfigModalOpen(false);
    if (refresh) {
      void loadData();
    }
  };

  const handleSearch = async () => {
    if (searchTerm.trim()) {
      const template = activeSearchEngine.url_template;
      const encodedSearchTerm = encodeURIComponent(searchTerm);
      const searchUrl = template.includes("%s")
        ? template.replace("%s", encodedSearchTerm)
        : template + encodedSearchTerm;
      await openLink(searchUrl);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      void handleSearch();
    }
  };

  const handleCardClick = async (item: WebsiteItem) => {
    const url = environment === "lan" && item.url_lan ? item.url_lan : item.url;
    if (url) {
      try {
        await openLink(url);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        log.error(`Failed to open URL: ${String(error)}`);
        showAlert(
          t("launchpad.openLinkFailedTitle"),
          t("launchpad.openLinkFailedMessage", {
            url,
            error: errorMessage,
          }),
        );
      }
    } else {
      showAlert(
        t("launchpad.invalidLinkTitle"),
        t("launchpad.invalidLinkMessage", { title: item.title }),
      );
    }
  };

  const handleSaveItem = useCallback(
    async (itemData: Partial<WebsiteItem>) => {
      if (scrollContainerRef.current) {
        scrollPosRef.current = scrollContainerRef.current.scrollTop;
      }
      const dataToSave = { ...itemData };

      // 如果是新项，或者是修改了分组的项，都需要重新计算 sort_order
      // 找出原 item（如果是编辑的话）
      const originalItem = itemData.uuid
        ? items.find((i) => i.uuid === itemData.uuid)
        : null;
      const isGroupChanged =
        originalItem && originalItem.group_uuid !== dataToSave.group_uuid;

      if (!dataToSave.uuid || isGroupChanged) {
        if (!activeUser?.uuid) {
          showAlert(
            t("launchpad.saveItemMissingUserTitle"),
            t("launchpad.saveItemMissingUserMessage"),
          );
          return;
        }
        dataToSave.user_uuid = activeUser.uuid;

        // 计算目标分组中的最大 sort_order
        const itemsInTargetGroup = items.filter(
          (i) =>
            i.group_uuid === dataToSave.group_uuid &&
            i.uuid !== dataToSave.uuid,
        );
        const maxSortOrder = itemsInTargetGroup.reduce(
          (max, i) => Math.max(max, i.sort_order || 0),
          0,
        );
        dataToSave.sort_order = maxSortOrder + 1;
      }

      await launchpadDb.saveItem(dataToSave);
      await loadData();
    },
    [loadData, items, activeUser, showAlert, t],
  );

  const handleContextMenu = (e: React.MouseEvent, item: WebsiteItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  };

  const handleContextDelete = () => {
    if (contextMenu) {
      const itemToDelete = contextMenu.item;
      openConfirm({
        title: t("launchpad.deleteWebsiteTitle"),
        message: t("launchpad.deleteWebsiteMessage", {
          title: itemToDelete.title,
        }),
        onConfirm: () => {
          void (async () => {
            if (scrollContainerRef.current) {
              scrollPosRef.current = scrollContainerRef.current.scrollTop;
            }
            await launchpadDb.deleteItem(itemToDelete.uuid);
            await loadData();
          })();
        },
      });
    }
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((currentItems) => {
        const oldIndex = currentItems.findIndex(
          (item) => item.uuid === active.id,
        );
        const newIndex = currentItems.findIndex(
          (item) => item.uuid === over.id,
        );

        // 确保拖拽在同一个分组内
        if (
          currentItems[oldIndex].group_uuid !==
          currentItems[newIndex].group_uuid
        ) {
          return currentItems;
        }

        const newOrderedItems = arrayMove(currentItems, oldIndex, newIndex).map(
          (item, index) => ({
            ...item,
            sort_order: index + 1,
          }),
        );

        void launchpadDb.updateItemsOrder(newOrderedItems);
        return newOrderedItems;
      });
    }
  }, []);

  const handleActiveEngineChange = async (engine: SearchEngine) => {
    setActiveEngineUuid(engine.uuid);
    if (activeUser) {
      if (engine.is_deletable === 1) {
        await launchpadDb.setActiveSearchEngine(engine.uuid, activeUser.uuid);
      } else {
        await launchpadDb.clearDefaultSearchEngine(activeUser.uuid);
      }
    }
  };

  /**
   * 1. 遍历所有分组。
   * 2. 检查每个分组名称是否匹配搜索词。
   * 3. 如果分组名称匹配，则该分组及其所有网站项都显示。
   * 4. 如果分组名称不匹配，再检查该分组下网站项标题是否匹配；若有匹配，则仅显示匹配项。
   * 5. 如果分组名和网站项标题都不匹配，则不显示该分组。
   */
  const filteredAndGroupedData = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase().trim();

    if (!lowerSearchTerm) {
      // 如果没有搜索词，则返回所有分组及其对应的网站
      return groups.map((group) => ({
        ...group,
        items: items.filter((item) => item.group_uuid === group.uuid),
      }));
    }

    return groups
      .map((group) => {
        // 获取当前分组下的所有网站项
        const itemsInGroup = items.filter(
          (item) => item.group_uuid === group.uuid,
        );

        // 检查分组名称是否匹配
        const isGroupMatch = group.name.toLowerCase().includes(lowerSearchTerm);

        // 筛选出标题匹配的网站项
        const matchingItems = itemsInGroup.filter((item) =>
          item.title.toLowerCase().includes(lowerSearchTerm),
        );
        // 如果分组名称匹配，则返回该分组和它的所有网站项
        if (isGroupMatch) {
          return { ...group, items: itemsInGroup };
        }
        // 如果分组名称不匹配，但有网站项匹配，则返回该分组和匹配的网站项
        if (matchingItems.length > 0) {
          return { ...group, items: matchingItems };
        }
        // 如果都不匹配，则不返回该分组
        return null;
      })
      .filter(
        (group): group is WebsiteGroup & { items: WebsiteItem[] } =>
          group !== null,
      );
  }, [groups, items, searchTerm]);

  const handleToggleEnvironment: React.MouseEventHandler<HTMLElement> = (e) => {
    e.preventDefault();
    toggleEnvironment();
  };

  const handleOpenConfig: React.MouseEventHandler<HTMLElement> = (e) => {
    e.preventDefault();
    setIsNavConfigModalOpen(true);
  };

  const handleOpenEngineManagement: React.MouseEventHandler<HTMLElement> = (
    e,
  ) => {
    e.preventDefault();
    setIsEngineModalOpen(true);
  };

  const handleClearSearch: React.MouseEventHandler<SVGElement> = (e) => {
    e.preventDefault();
    setSearchTerm("");
  };

  const handleExecuteSearch: React.MouseEventHandler<SVGElement> = (e) => {
    e.preventDefault();
    void handleSearch();
  };

  if (isLoading) return <Loading />;

  return (
    <>
      <LaunchpadIndexContainer
        className="Launchpad-index-container"
        style={
          {
            "--Launchpad-side-margin-percent": sideMargin,
          } as React.CSSProperties
        }
      >
        <LaunchpadPageActionsContainer className="Launchpad-page-actions-container">
          <StyledButton variant="ghost" onClick={handleToggleEnvironment}>
            <DynamicIcon
              defaultIcon={
                environment === "lan" ? "IoHomeOutline" : "IoPlanetOutline"
              }
            />
            {environment === "lan" ? t("launchpad.lan") : t("launchpad.wan")}
          </StyledButton>
          <StyledButton variant="ghost" onClick={handleOpenConfig}>
            <DynamicIcon defaultIcon={"IoSettingsOutline"} />
            {t("launchpad.config")}
          </StyledButton>
        </LaunchpadPageActionsContainer>

        <LaunchpadPageHeader className="Launchpad-page-header">
          <HeaderSection>
            <Title>{t("launchpad.title")}</Title>
            <SearchContainer>
              <SearchEngineIcon onClick={handleOpenEngineManagement}>
                <DynamicIcon
                  defaultIcon={activeSearchEngine.default_icon}
                  localIconPath={activeSearchEngine.local_icon_path}
                />
              </SearchEngineIcon>
              <SearchInput
                id="Launchpad-search-input"
                ref={searchInputRef}
                placeholder={t("launchpad.searchText")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <SearchIconsContainer>
                {searchTerm && <ClearIcon onClick={handleClearSearch} />}
                <SearchButtonIcon onClick={handleExecuteSearch} />
              </SearchIconsContainer>
            </SearchContainer>
          </HeaderSection>
        </LaunchpadPageHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {filteredAndGroupedData.map((group) => (
            <WebsiteGroupSection
              key={group.uuid}
              group={group}
              items={group.items}
              onAddItem={(groupUuid) => {
                setEditingItem(null);
                setTargetGroupUuid(groupUuid);
                setIsItemModalOpen(true);
              }}
              onCardClick={(item) => {
                void handleCardClick(item);
              }}
              onContextMenu={handleContextMenu}
            />
          ))}
        </DndContext>
      </LaunchpadIndexContainer>

      <ConfigModal
        isOpen={isNavConfigModalOpen}
        onClose={handleNavConfigModalClose}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEdit={() => {
            setEditingItem(contextMenu.item);
            setIsItemModalOpen(true);
          }}
          onDelete={handleContextDelete}
        />
      )}

      <EditWebsiteItemModal
        isOpen={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        item={editingItem}
        onSave={(item) => {
          void handleSaveItem(item);
        }}
        groups={groups}
        targetGroupUuid={targetGroupUuid}
      />
      <SearchEngineManagementModal
        isOpen={isEngineModalOpen}
        onClose={() => setIsEngineModalOpen(false)}
        engines={allSearchEngines}
        activeEngine={activeSearchEngine}
        onEngineChange={(engine) => {
          void handleActiveEngineChange(engine);
        }}
        onEnginesUpdate={() => {
          void loadSearchEngines();
        }}
      />
    </>
  );
};

const LaunchpadPage: React.FC = () => {
  return (
    <IconRefreshProvider>
      <LaunchpadSettingsProvider>
        <LaunchpadPageContent />
      </LaunchpadSettingsProvider>
    </IconRefreshProvider>
  );
};

export default LaunchpadPage;
