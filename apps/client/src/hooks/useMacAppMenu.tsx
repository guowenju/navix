import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { getMenuItems, MenuItem as AppMenuItem } from "@/constants/menuItems";
import { useModal } from "@/contexts";
import { useAuth } from "@/contexts/Auth.context";
import { useAppTheme } from "@/contexts";
import SettingsModal from "@/features/Settings/SettingsModal";
import UserProfileModal from "@/features/Auth/UserProfileModal";
import { log } from "@/utils/logger";

const isMacOS = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  return platform.includes("mac") || userAgent.includes("mac");
};

const handleMenuAction = (
  item: AppMenuItem,
  navigate: (path: string) => void,
  openModal: (
    render: (close: () => void) => ReactNode,
    options?: { key?: string },
  ) => void,
) => {
  if (item.url === "/help/settings") {
    void openModal((close) => <SettingsModal onClose={close} />, {
      key: "settings",
    });
    return;
  }

  if (item.url) {
    void navigate(item.url);
  }
};

const openUserProfileModal = (
  openModal: (
    render: (close: () => void) => ReactNode,
    options?: { key?: string },
  ) => void,
) => {
  void openModal((close) => <UserProfileModal onClose={close} />, {
    key: "user-profile",
  });
};

const buildSubmenuItems = async (
  items: AppMenuItem[],
  navigate: (path: string) => void,
  openModal: (
    render: (close: () => void) => ReactNode,
    options?: { key?: string },
  ) => void,
) => {
  const menuItems: MenuItem[] = [];

  for (const item of items) {
    const menuItem = await MenuItem.new({
      id: `menu-${item.id}`,
      text: item.label,
      action: function triggerMenuAction() {
        handleMenuAction(item, navigate, openModal);
      },
    });
    menuItems.push(menuItem);
  }

  return menuItems;
};

const createAppMenu = async (
  appName: string,
  settingsLabel: string,
  toggleThemeLabel: string,
  openSettings: () => void,
  toggleTheme: () => void,
) => {
  const items = [
    await PredefinedMenuItem.new({ item: { About: null } }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({
      id: "app-settings",
      text: settingsLabel,
      accelerator: "CmdOrCtrl+,",
      action: openSettings,
    }),
    await MenuItem.new({
      id: "app-toggle-theme",
      text: toggleThemeLabel,
      action: toggleTheme,
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await PredefinedMenuItem.new({ item: "Services" }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await PredefinedMenuItem.new({ item: "Hide" }),
    await PredefinedMenuItem.new({ item: "HideOthers" }),
    await PredefinedMenuItem.new({ item: "ShowAll" }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await PredefinedMenuItem.new({ item: "Quit" }),
  ];

  return Submenu.new({
    id: "app-menu",
    text: appName,
    items,
  });
};

const createUserMenu = async (
  menuLabel: string,
  itemLabel: string,
  openUserEntry: () => void,
) =>
  Submenu.new({
    id: "user-menu",
    text: menuLabel,
    items: [
      await MenuItem.new({
        id: "user-profile",
        text: itemLabel,
        action: openUserEntry,
      }),
    ],
  });

const createEditMenu = async (menuLabel: string) =>
  Submenu.new({
    id: "edit-menu",
    text: menuLabel,
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

const createWindowMenu = async (menuLabel: string) =>
  Submenu.new({
    id: "window-menu",
    text: menuLabel,
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });

export const useMacAppMenu = () => {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { openModal } = useModal();
  const { activeUser } = useAuth();
  const { toggleTheme } = useAppTheme();
  const goTo = useCallback(
    (path: string) => {
      void navigate(path);
    },
    [navigate],
  );

  useEffect(() => {
    if (!isMacOS() || !isTauri()) {
      return;
    }

    let cancelled = false;

    const applyMenu = async () => {
      try {
        const menuItems = getMenuItems(t);
        const helpMenu = menuItems.find((item) => item.id === 1000);
        const otherMenus = menuItems.filter((item) => item.id !== 1000);

        const appMenu = await createAppMenu(
          "Navix",
          t("menu.help.settings"),
          t("menu.app.toggleTheme"),
          function openSettings() {
            handleMenuAction(
              {
                id: 1001,
                label: t("menu.help.settings"),
                url: "/help/settings",
              },
              goTo,
              openModal,
            );
          },
          function triggerThemeToggle() {
            toggleTheme();
          },
        );
        const userMenuLabel = activeUser?.username || t("menu.account.entry");
        const userMenu = await createUserMenu(
          userMenuLabel,
          t("menu.account.profile"),
          function openUserProfile() {
            openUserProfileModal(openModal);
          },
        );
        const editMenu = await createEditMenu(t("menu.edit.title"));
        const windowMenu = await createWindowMenu(t("menu.window.title"));

        const navigationSubmenus = await Promise.all(
          otherMenus.map(async (menu) => {
            const items = menu.children?.length ? menu.children : [{ ...menu }];
            const submenuItems = await buildSubmenuItems(
              items,
              goTo,
              openModal,
            );
            return Submenu.new({
              id: `submenu-${menu.id}`,
              text: menu.label,
              items: submenuItems,
            });
          }),
        );

        const helpSubmenu = helpMenu
          ? await Submenu.new({
              id: "help-menu",
              text: helpMenu.label,
              items: await buildSubmenuItems(
                helpMenu.children ?? [],
                goTo,
                openModal,
              ),
            })
          : null;

        const menu = await Menu.new();
        await menu.append([
          appMenu,
          editMenu,
          userMenu,
          ...navigationSubmenus,
          windowMenu,
        ]);

        if (helpSubmenu) {
          await menu.append(helpSubmenu);
          await helpSubmenu.setAsHelpMenuForNSApp();
        }

        if (cancelled) {
          await menu.close();
          return;
        }

        const previousMenu = await menu.setAsAppMenu();
        await windowMenu.setAsWindowsMenuForNSApp();

        if (previousMenu) {
          await previousMenu.close();
        }
      } catch (error) {
        log.error(`Failed to apply macOS app menu: ${String(error)}`);
      }
    };

    void applyMenu();

    return () => {
      cancelled = true;
    };
  }, [i18n.language, t, goTo, openModal, activeUser?.username, toggleTheme]);
};
