import { useAuth } from "@workspace/replit-auth-web";

export function useCanWrite() {
  const { user } = useAuth();
  return user?.role === "editor";
}
