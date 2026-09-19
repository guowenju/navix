import {
  IoAlertCircleOutline,
  IoCheckmarkCircleOutline,
  IoCloseOutline,
  IoInformationCircleOutline,
  IoWarningOutline,
} from "react-icons/io5";
import styles from "./Banner.module.css";

export type BannerVariant = "info" | "success" | "warning" | "error";

/** 应用级横幅通知的数据结构，由全局通知层统一渲染。 */
export type BannerNotice = {
  variant: BannerVariant;
  title: string;
  description?: string;
};

interface BannerProps {
  variant: BannerVariant;
  title: string;
  description?: string;
  actionLabel?: string;
  dismissLabel?: string;
  dataUi?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

const bannerIcons = {
  info: IoInformationCircleOutline,
  success: IoCheckmarkCircleOutline,
  warning: IoWarningOutline,
  error: IoAlertCircleOutline,
};

/** 渲染可复用的上下文横幅，用于呈现状态反馈、操作引导和错误提示。 */
const Banner = ({
  variant,
  title,
  description,
  actionLabel,
  dismissLabel,
  dataUi = "banner",
  onAction,
  onDismiss,
}: BannerProps) => {
  const Icon = bannerIcons[variant];
  const isUrgent = variant === "error";

  return (
    <section
      className={`${styles.banner} ${styles[variant]}`}
      data-ui={dataUi}
      data-variant={variant}
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <div className={styles.content} data-slot="banner-content">
        <p className={styles.title}>{title}</p>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {onAction || onDismiss ? (
        <div className={styles.actions} data-slot="banner-actions">
          {onAction && actionLabel ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          ) : null}
          {onDismiss && dismissLabel ? (
            <button
              type="button"
              className={styles.dismissButton}
              aria-label={dismissLabel}
              title={dismissLabel}
              onClick={onDismiss}
            >
              <IoCloseOutline aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

export default Banner;
