import { useState, useCallback, ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import AlertModal from "@/components/common/AlertModal/AlertModal";
import ConfirmationModal from "@/components/common/ConfirmationModal/ConfirmationModal";
import { ModalContext, ModalOptions, ModalContextType } from "./Modal.context";

type AlertProps = Parameters<ModalContextType["openAlert"]>[0];
type ConfirmProps = Parameters<ModalContextType["openConfirm"]>[0];

interface ModalState {
  id: string;
  content: ReactNode;
  zIndex?: number;
  key?: string;
}

export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [modals, setModals] = useState<ModalState[]>([]);
  const location = useLocation();

  const closeModal = useCallback((id?: string) => {
    setModals((prevModals) => {
      if (id) {
        return prevModals.filter((modal) => modal.id !== id);
      }
      return prevModals.slice(0, -1);
    });
  }, []);

  const openModal = useCallback(
    (
      renderContent: (close: () => void) => ReactNode,
      options?: ModalOptions,
    ) => {
      const { key, zIndex } = options || {};

      setModals((prevModals) => {
        if (key) {
          const existingModal = prevModals.find((m) => m.key === key);
          if (existingModal) {
            const close = () => closeModal(existingModal.id);
            const content = renderContent(close);
            return prevModals.map((modal) =>
              modal.key === key
                ? { ...modal, content, zIndex: zIndex ?? modal.zIndex }
                : modal,
            );
          }
        }

        const modalId = `modal-${Date.now()}-${Math.random()}`;
        const close = () => closeModal(modalId);
        const content = renderContent(close);

        const newModal: ModalState = {
          id: modalId,
          content,
          zIndex,
          key,
        };

        return [...prevModals, newModal];
      });
    },
    [closeModal],
  );

  const openAlert = useCallback(
    (props: AlertProps) => {
      openModal((close) => (
        <AlertModal {...props} isOpen={true} onClose={close} />
      ));
    },
    [openModal],
  );

  const openConfirm = useCallback(
    (props: ConfirmProps) => {
      const { modalKey, ...rest } = props;
      openModal(
        (close) => {
          const handleConfirm = () => {
            rest.onConfirm();
            close();
          };
          const handleCancel = () => {
            rest.onCancel?.();
            close();
          };
          return (
            <ConfirmationModal
              {...rest}
              isOpen={true}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          );
        },
        modalKey ? { key: modalKey } : undefined,
      );
    },
    [openModal],
  );

  useEffect(() => {
    void Promise.resolve().then(() => {
      setModals([]);
    });
  }, [location.pathname]);

  return (
    <ModalContext.Provider
      value={{
        hasOpenModal: modals.length > 0,
        openModal,
        closeModal,
        openAlert,
        openConfirm,
      }}
    >
      {children}
      {modals.map((modal) => (
        <div key={modal.id}>{modal.content}</div>
      ))}
    </ModalContext.Provider>
  );
};
