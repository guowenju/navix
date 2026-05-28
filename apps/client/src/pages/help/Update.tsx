import { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { Theme } from "@/styles/themes";
import {
  check,
  Update,
  DownloadEvent,
  DownloadOptions,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { log } from "@/utils/logger";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IoCloudDownloadOutline } from "react-icons/io5";
import { useModal } from "@/contexts";
import { useTranslation } from "react-i18next";
import { GITHUB_LATEST_RELEASE_URL } from "@/constants/links";

const UpdateContainer = styled.div<{ theme: Theme }>`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
  background-color: transparent;
  color: ${(props) => props.theme.colors.textPrimary};
`;

const Content = styled.div<{ theme: Theme }>`
  text-align: center;
  max-width: 80%;
  color: ${(props) => props.theme.colors.textPrimary};

  h1 {
    font-size: 2rem;
    color: ${(props) => props.theme.colors.primary};
    margin-bottom: 1rem;
  }

  p {
    font-size: 1.1rem;
    color: ${(props) => props.theme.colors.textSecondary};
    margin-bottom: 2rem;
  }
`;

const CheckButton = styled.button<{ theme: Theme; disabled: boolean }>`
  background-color: ${(props) => props.theme.colors.primary};
  color: white;
  padding: 12px 24px;
  border-radius: 50px;
  font-size: 1.1rem;
  font-weight: bold;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  opacity: ${(props) => (props.disabled ? 0.6 : 1)};
  transition: all 0.3s ease;

  &:hover:not(:disabled) {
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 5px 15px rgba(0, 188, 212, 0.4);
  }
`;

const InlineLink = styled.span<{ theme: Theme }>`
  color: ${(props) => props.theme.colors.primary};
  cursor: pointer;
  text-decoration: underline;

  &:hover {
    color: ${(props) => props.theme.colors.textPrimary};
  }
`;

export default function CheckUpdatePage() {
  const { t } = useTranslation();
  const { openAlert, openConfirm, closeModal } = useModal();
  const releaseUrl = GITHUB_LATEST_RELEASE_URL;
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [unlisten, setUnlisten] = useState<(() => void) | null>(null);

  const cleanupDownload = useCallback(() => {
    if (unlisten) {
      unlisten();
      setUnlisten(null);
    }
    setIsDownloading(false);
  }, [unlisten]);

  const cancelDownload = useCallback(() => {
    cleanupDownload();
    openAlert({
      title: t("help.checkUpdatePage.downloadCancelled"),
      message: t("help.checkUpdatePage.downloadCancelledMessage"),
      confirmText: t("button.confirm"),
    });
  }, [cleanupDownload, openAlert, t]);

  const installAndRelaunch = useCallback(
    async (updateToInstall: Update) => {
      closeModal();
      try {
        log.info(t("help.checkUpdatePage.installingLog"));
        await updateToInstall.install();
        await relaunch();
      } catch (error) {
        log.error(`Installation failed: ${String(error)}`);
        openAlert({
          title: t("help.checkUpdatePage.installFailed"),
          message: `${String(error)}`,
          confirmText: t("button.confirm"),
        });
      }
    },
    [closeModal, openAlert, t],
  );

  const startDownload = useCallback(
    async (updateToDownload: Update) => {
      setIsDownloading(true);
      let downloadedLength = 0;
      let totalLength = 0;

      const onProgress = (message: string) => {
        openConfirm({
          title: t("help.checkUpdatePage.downloadingTitle"),
          message: message,
          onConfirm: () => {},
          onCancel: cancelDownload,
          hideConfirm: true,
          cancelText: t("help.checkUpdatePage.cancelDownload"),
          modalKey: "download-progress",
        });
      };

      onProgress(t("help.checkUpdatePage.downloadingPrepare"));

      try {
        const options: DownloadOptions = {
          timeout: 60000,
        };
        const unlistenFn = await updateToDownload.download(
          (event: DownloadEvent) => {
            switch (event.event) {
              case "Started":
                totalLength = event.data.contentLength ?? 0;
                log.info(
                  t("help.checkUpdatePage.downloadStartLog", {
                    size: (totalLength / 1024 / 1024).toFixed(2),
                  }),
                );
                onProgress(
                  t("help.checkUpdatePage.downloadingProgress", {
                    progress: 0,
                  }),
                );
                break;
              case "Progress":
                downloadedLength += event.data.chunkLength;
                if (totalLength > 0) {
                  const progress = Math.round(
                    (downloadedLength / totalLength) * 100,
                  );
                  onProgress(
                    t("help.checkUpdatePage.downloadingProgress", { progress }),
                  );
                }
                break;
              case "Finished":
                log.info("Download finished");
                cleanupDownload();
                openConfirm({
                  title: t("help.checkUpdatePage.downloadFinishedTitle"),
                  message: t("help.checkUpdatePage.downloadFinishedMessage"),
                  onConfirm: () => {
                    void installAndRelaunch(updateToDownload);
                  },
                  cancelText: t("help.checkUpdatePage.confirmLater"),
                });
                break;
            }
          },
          options,
        );
        setUnlisten(() => unlistenFn);
      } catch (error) {
        log.error(`Download failed: ${String(error)}`);
        cleanupDownload();
        openAlert({
          title: t("help.checkUpdatePage.downloadFailed"),
          message: t("help.checkUpdatePage.downloadFailedMessage"),
          confirmText: t("button.confirm"),
        });
      }
    },
    [
      cancelDownload,
      openConfirm,
      cleanupDownload,
      installAndRelaunch,
      openAlert,
      t,
    ],
  );

  const checkUpdate = useCallback(async () => {
    if (isChecking || isDownloading) return;

    setIsChecking(true);
    openAlert({
      title: t("help.checkUpdatePage.title"),
      message: t("help.checkUpdatePage.checking"),
      confirmText: t("button.confirm"),
    });

    try {
      const result = await check({
        timeout: 5000,
      });
      closeModal();
      if (result) {
        openConfirm({
          title: (translate) =>
            translate("help.checkUpdatePage.newVersionFound", {
              version: result.version,
            }),
          message: (translate) => (
            <>
              {translate("help.checkUpdatePage.updateDetailsPrefix")}
              <InlineLink
                onClick={() => {
                  void openUrl(releaseUrl);
                }}
              >
                {translate("help.checkUpdatePage.updateDetailsLinkText")}
              </InlineLink>
              {translate("help.checkUpdatePage.updateDetailsSuffix")}
            </>
          ),
          confirmText: (translate) =>
            translate("help.checkUpdatePage.updateNow"),
          onConfirm: () => {
            void startDownload(result);
          },
        });
      } else {
        openAlert({
          title: t("help.checkUpdatePage.title"),
          message: t("help.checkUpdatePage.latestVersion"),
          confirmText: t("button.confirm"),
        });
        log.info("no update found");
      }
    } catch (error) {
      log.error(`Update check failed: ${String(error)}`);
      closeModal();
      openAlert({
        title: t("help.checkUpdatePage.checkFailed"),
        message: t("help.checkUpdatePage.checkFailedMessage"),
        confirmText: t("button.confirm"),
      });
    } finally {
      setIsChecking(false);
    }
  }, [
    isChecking,
    isDownloading,
    openAlert,
    closeModal,
    openConfirm,
    startDownload,
    releaseUrl,
    t,
  ]);

  useEffect(() => {
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [unlisten]);

  const buttonText = () => {
    if (isChecking) {
      return t("help.checkUpdatePage.buttonChecking");
    }
    if (isDownloading) {
      return t("help.checkUpdatePage.buttonDownloading");
    }
    return t("help.checkUpdatePage.buttonIdle");
  };

  return (
    <UpdateContainer>
      <Content>
        <h1>{t("help.checkUpdatePage.title")}</h1>
        <p>{t("help.checkUpdatePage.description")}</p>
        <CheckButton
          className="check-update-now"
          onClick={() => {
            void checkUpdate();
          }}
          disabled={isChecking || isDownloading}
        >
          <IoCloudDownloadOutline />
          {buttonText()}
        </CheckButton>
      </Content>
    </UpdateContainer>
  );
}
