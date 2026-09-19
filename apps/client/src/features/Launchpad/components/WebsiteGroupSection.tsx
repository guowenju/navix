import React, { useState } from "react";
import { WebsiteGroup, WebsiteItem } from "@/features/Launchpad/types";
import { AnimatePresence } from "framer-motion";
import DynamicIcon from "@/components/common/DynamicIcon";
import {
  LaunchpadGroupSectionStyles,
  SectionHeader,
  SectionTitle,
  ActionIcon,
  HeaderActions,
  LaunchpadGrid,
  LaunchpadCard,
  LaunchpadCardContent,
  LaunchpadIcon,
  LaunchpadName,
} from "@/styles/launchpad/index.styles";
import {
  IoAddCircleOutline,
  IoSwapVertical,
  IoCheckmarkDoneSharp,
  IoChevronDown,
} from "react-icons/io5";
import Tooltip from "@/components/common/Tooltip/Tooltip";
import { useTranslation } from "react-i18next";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTheme } from "styled-components";

/** */
const SortableLaunchpadCard: React.FC<{
  item: WebsiteItem;
  isSorting: boolean;
  onCardClick: (item: WebsiteItem) => void;
  onContextMenu: (e: React.MouseEvent, item: WebsiteItem) => void;
}> = ({ item, isSorting, onCardClick, onContextMenu }) => {
  const theme = useTheme();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.uuid, disabled: !isSorting });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSorting) {
      e.preventDefault();
      return;
    }
    onCardClick(item);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isSorting) {
      e.preventDefault();
      return;
    }
    onContextMenu(e, item);
  };

  return (
    <LaunchpadCard
      ref={setNodeRef}
      style={style}
      className="Launchpad-card-wrapper"
      background_color={item.background_color}
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      isDragging={isDragging}
      isSorting={isSorting}
      {...(isSorting ? listeners : {})}
      {...attributes}
    >
      <LaunchpadCardContent className="Launchpad-card-content">
        <LaunchpadIcon className="Launchpad-icon">
          <DynamicIcon
            defaultIcon={item.default_icon}
            localIconPath={item.local_icon_path}
            imgStyle={{ borderRadius: theme.radii.base }}
          />
        </LaunchpadIcon>
        <LaunchpadName className="Launchpad-name">{item.title}</LaunchpadName>
      </LaunchpadCardContent>
    </LaunchpadCard>
  );
};

interface WebsiteGroupSectionProps {
  group: WebsiteGroup;
  items: WebsiteItem[]; //
  onAddItem: (groupUuid: string) => void;
  onCardClick: (item: WebsiteItem) => void;
  onContextMenu: (e: React.MouseEvent, item: WebsiteItem) => void;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}

const WebsiteGroupSection: React.FC<WebsiteGroupSectionProps> = ({
  group,
  items,
  onAddItem,
  onCardClick,
  onContextMenu,
  isCollapsed,
  onToggleCollapsed,
}) => {
  const { t } = useTranslation();
  const [isSorting, setIsSorting] = useState(false);

  return (
    <LaunchpadGroupSectionStyles className="Launchpad-group-section">
      <SectionHeader
        className={`Launchpad-group-section-header ${
          isSorting ? "is-sorting" : ""
        }`}
      >
        <SectionTitle>{group.name}</SectionTitle>
        <HeaderActions>
          <Tooltip
            text={
              isCollapsed
                ? t("launchpad.expandGroup")
                : t("launchpad.collapseGroup")
            }
          >
            <ActionIcon
              onClick={() => {
                setIsSorting(false);
                onToggleCollapsed();
              }}
              className="toggle-group-action-icon"
              aria-label={
                isCollapsed
                  ? t("launchpad.expandGroup")
                  : t("launchpad.collapseGroup")
              }
              aria-expanded={!isCollapsed}
            >
              <IoChevronDown
                style={{
                  transform: isCollapsed ? "rotate(-90deg)" : undefined,
                }}
              />
            </ActionIcon>
          </Tooltip>
          <Tooltip
            text={isSorting ? t("launchpad.sortDone") : t("launchpad.sort")}
          >
            <ActionIcon
              onClick={() => setIsSorting(!isSorting)}
              className="sort-items-action-icon"
            >
              {isSorting ? <IoCheckmarkDoneSharp /> : <IoSwapVertical />}
            </ActionIcon>
          </Tooltip>
          <Tooltip text={t("launchpad.addItem")}>
            <ActionIcon
              onClick={() => onAddItem(group.uuid)}
              className="add-item-action-icon"
            >
              <IoAddCircleOutline />
            </ActionIcon>
          </Tooltip>
        </HeaderActions>
      </SectionHeader>
      {!isCollapsed && (
        <SortableContext
          items={items.map((i) => i.uuid)}
          strategy={rectSortingStrategy}
          disabled={!isSorting}
        >
          <LaunchpadGrid className="Launchpad-grid">
            <AnimatePresence>
              {items.map((item) => (
                <SortableLaunchpadCard
                  key={item.uuid}
                  item={item}
                  isSorting={isSorting}
                  onCardClick={onCardClick}
                  onContextMenu={onContextMenu}
                />
              ))}
            </AnimatePresence>
          </LaunchpadGrid>
        </SortableContext>
      )}
    </LaunchpadGroupSectionStyles>
  );
};

export default React.memo(WebsiteGroupSection);
