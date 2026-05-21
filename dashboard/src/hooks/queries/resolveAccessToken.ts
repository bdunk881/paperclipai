import { useAuth } from "../../context/AuthContext";

/** Works with both getAccessToken-only test mocks and production AuthContext. */
export function useResolveAccessToken() {
  const auth = useAuth();
  return async (): Promise<string> => {
    if (auth.getAccessToken) {
      const token = await auth.getAccessToken();
      if (token) {
        return token;
      }
    }
    if (auth.requireAccessToken) {
      return auth.requireAccessToken();
    }
    throw new Error("Authentication session expired.");
  };
}
