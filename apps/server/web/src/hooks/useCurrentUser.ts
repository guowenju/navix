import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, isAuthError } from "../api";
import { clearUserAccessToken, getUserAccessToken } from "../auth/tokenStore";
import { log } from "../utils/logger";
import type { Claims } from "@navix/shared-ts";

export type CurrentUser = Claims;

interface UseCurrentUserOptions {
  redirectTo?: string;
}

export const useCurrentUser = ({ redirectTo }: UseCurrentUserOptions = {}) => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      const token = getUserAccessToken();
      if (!token) {
        if (redirectTo) {
          void navigate(redirectTo);
        }
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const resp = await apiFetch<CurrentUser>("/api/v1/welcome", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(resp.data ?? null);
      } catch (err) {
        if (isAuthError(err)) {
          clearUserAccessToken();
          if (redirectTo) {
            void navigate(redirectTo);
          }
          return;
        }
        log.error("运行期错误", err);
        setError("无法获取用户信息");
      } finally {
        setLoading(false);
      }
    };
    void fetchUser();
  }, [navigate, redirectTo]);

  return { user, loading, error };
};
