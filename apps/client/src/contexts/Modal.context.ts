import { createContext, useContext, ReactNode } from "react";
import { AlertModalProps } from "@/components/common/AlertModal/AlertModal";
import { ConfirmationModalProps } from "@/components/common/ConfirmationModal/ConfirmationModal";

export interface ModalOptions {
  zIndex?: number;
  key?: string;
}

export interface ModalContextType {
  /** 当前是否存在由全局模态框上下文管理的活动模态框。 */
  hasOpenModal: boolean;
  openModal: (
    renderContent: (close: () => void) => ReactNode,
    options?: ModalOptions,
  ) => void;
  closeModal: (id?: string) => void;
  openAlert: (props: Omit<AlertModalProps, "isOpen" | "onClose">) => void;
  openConfirm: (
    props: Omit<ConfirmationModalProps, "isOpen" | "onClose" | "onCancel"> & {
      onCancel?: () => void;
      modalKey?: string;
    },
  ) => void;
}

export const ModalContext = createContext<ModalContextType | undefined>(
  undefined,
);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal 必须在 ModalProvider 内部使用");
  }
  return context;
};
