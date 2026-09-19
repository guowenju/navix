import styled, { css } from "styled-components";
import { motion } from "framer-motion";
import {
  IoCloseCircleOutline,
  IoSearchOutline,
  IoLogoEdge,
  IoLogoGoogle,
} from "react-icons/io5";
import { hexToRgba } from "@/utils/colors";

export const Io5Icons = {
  IoCloseCircleOutline,
  IoSearchOutline,
  IoLogoEdge,
  IoLogoGoogle,
};

export const LaunchpadPageHeader = styled.div`
  width: 100%;
  max-width: 960px; /* 定义内容区域的最大宽度 */
  display: flex;
  justify-content: center; /* 两端对齐 */
  align-items: flex-start; /* 顶部对齐 */
  margin-bottom: 1rem;
`;

export const HeaderSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center; /* 左对齐改为居中 */
`;

export const Title = styled.h1`
  font-size: 2.5rem;
  color: ${(props) => props.theme.colors.primary};
  margin: 0;
`;

export const SearchContainer = styled.div`
  position: relative;
  width: 100%;
  min-width: 450px; /* 确保搜索框有足够宽度 */
  margin-top: 1.5rem;
  display: flex; /* 改为 flex 布局 */
  align-items: center; /* 垂直居中 */
`;

/** 页面右上角操作按钮的容器 */
export const LaunchpadPageActionsContainer = styled.div`
  position: fixed;
  top: 3.5rem;
  right: 2rem;
  z-index: ${(props) => props.theme.zIndices.LaunchpadMenu};
  display: flex;
  align-items: center;
  gap: 0.8rem; /* 按钮之间的间距 */
`;

export const LaunchpadIndexContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem;
  background-color: ${(props) => props.theme.colors.background};
  min-height: calc(100vh - 30px);
  box-sizing: border-box;
  color: ${(props) => props.theme.colors.textPrimary};
  position: relative;
`;

export const SearchInput = styled.input`
  width: 100%;
  padding: 12px 80px 12px 50px; /* 增加左侧内边距 */
  border: 2px solid ${(props) => props.theme.colors.primary};
  border-radius: 50px;
  color: ${(props) => props.theme.colors.textPrimary};
  font-size: 1rem;
`;

export const SearchEngineIcon = styled.div`
  position: absolute;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;

  color: ${(props) => props.theme.colors.primary};
  filter: brightness(1.2);
  transition: transform 0.2s ease-in-out;

  &:hover {
    transform: translateY(-50%) scale(1.1); /* 轻微放大效果 */
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: 4px;
  }
`;

export const SearchIconsContainer = styled.div`
  position: absolute;
  right: 15px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const IconBase = `
  font-size: 1.5rem;
  cursor: pointer;
  transition: color 0.2s;
`;

export const ClearIcon = styled(Io5Icons.IoCloseCircleOutline)`
  ${IconBase}
  color: ${(props) => props.theme.colors.textSecondary};
  &:hover {
    color: ${(props) => props.theme.colors.error};
  }
`;

export const SearchButtonIcon = styled(Io5Icons.IoSearchOutline)`
  ${IconBase}
  color: ${(props) => props.theme.colors.primary};
  &:hover {
    filter: brightness(1.2);
  }
`;

export const LaunchpadGroupSectionStyles = styled(motion.div)`
  width: 100%;
  max-width: calc(100% - (var(--Launchpad-side-margin-percent, 5) * 2%));
  margin: 0 auto 1rem auto;
`;

export const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 1.5rem;
  justify-content: flex-start;
  gap: 10px;

  /* 悬停时显示按钮 */
  &:hover .add-item-action-icon,
  &:hover .sort-items-action-icon,
  &:hover .toggle-group-action-icon {
    opacity: 1;
    transform: translateX(0);
  }

  /* 当处于排序状态时，也总是显示按钮 */
  &.is-sorting .add-item-action-icon,
  &.is-sorting .sort-items-action-icon,
  &.is-sorting .toggle-group-action-icon {
    opacity: 1;
    transform: translateX(0);
  }
`;

export const SectionTitle = styled.h2`
  font-size: 1.6rem;
  color: ${(props) => props.theme.colors.textPrimary};
  position: relative;
  text-align: left;
  padding-left: 10px;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 80%;
    background-color: ${(props) => props.theme.colors.primary};
    border-radius: 2px;
  }
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const ActionIcon = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: ${(props) => props.theme.colors.textSecondary};
  font-size: 1.2rem;
  opacity: 0; /* 默认隐藏 */
  transform: translateX(-10px);
  transition: all 0.2s ease-in-out;
  &:hover {
    color: ${(props) => props.theme.colors.primary};
    background: ${(props) => props.theme.colors.primaryFocus};
    border-radius: ${(props) => props.theme.radii.base};
  }
  &:focus-visible {
    opacity: 1;
    transform: translateX(0);
    outline: 2px solid ${(props) => props.theme.colors.primary};
    outline-offset: 2px;
  }
  svg {
    width: 18px;
    height: 18px;
  }
`;

export const LaunchpadGrid = styled(motion.div)<{ isDraggingOver?: boolean }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 1.5rem;
  background-color: ${(props) =>
    props.isDraggingOver ? props.theme.colors.primaryFocus : "transparent"};
  border-radius: ${(props) => props.theme.radii.base};
  transition: background-color 0.3s ease;
  padding: ${(props) => (props.isDraggingOver ? "1rem" : "0")};
  min-height: ${(props) => (props.isDraggingOver ? "120px" : "auto")};
`;

export const ItemActions = styled.div`
  position: absolute;
  top: 5px;
  right: 5px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background-color: rgba(0, 0, 0, 0.5);
  border-radius: 5px;
  padding: 5px;
  opacity: 0; /* 默认隐藏 */
  transition: opacity 0.2s ease-in-out;
`;

/** 站点卡片的内容容器 */
export const LaunchpadCardContent = styled.div`
  width: 100%;
  height: 100%;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.2s ease;
  transform-style: preserve-3d;
`;

/** 站点卡片 */
export const LaunchpadCard = styled(motion.div)<{
  background_color?: string;
  isDragging?: boolean;
  isSorting?: boolean;
}>`
  // 负责视觉背景和边框
  background: ${(props) =>
    hexToRgba(props.background_color || props.theme.colors.surface, 0.3)};
  border: ${(props) => props.theme.borderWidths.standard} solid
    ${(props) => props.theme.colors.border};
  border-radius: ${(props) => props.theme.radii.base};

  // 尺寸和定位
  display: flex; // 使用 flex 来容纳内部的 content
  position: relative;

  // 尺寸限制
  width: clamp(118px, 115px, 118px);
  height: clamp(112px, 115px, 115px);

  // 交互样式
  cursor: ${(props) => (props.isSorting ? "grab" : "pointer")};
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  // 拖拽状态
  opacity: ${(props) => (props.isDragging ? 0.8 : 1)};
  z-index: ${(props) => (props.isDragging ? 100 : "auto")};

  ${(props) =>
    props.isDragging &&
    css`
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
      border-color: ${props.theme.colors.primary};
      cursor: grabbing;
    `}

  // hover 状态应用在包裹层上
  &:hover {
    border-color: ${(props) => props.theme.colors.primary};

    // 但 transform 只应用在内部的 LaunchpadCardContent 上
    ${LaunchpadCardContent} {
      transform: ${(props) =>
        props.isSorting ? "translateY(0)" : "translateY(-1px)"};
    }

    // ItemActions 的显示逻辑也由包裹层 hover 控制
    ${(props) =>
      !props.isSorting &&
      css`
        ${ItemActions} {
          opacity: 1;
        }
      `}
  }
`;

export const LaunchpadIcon = styled.div`
  font-size: 2.5rem;
  color: ${(props) => props.theme.colors.primary};
  margin-bottom: 1rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;

  & > * {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

export const LaunchpadName = styled.p`
  font-size: 0.9rem;
  font-weight: bold;
  text-align: center;
  word-break: break-all;

  width: 6em;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: clip;
`;
