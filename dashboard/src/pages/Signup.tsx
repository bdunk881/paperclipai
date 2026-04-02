import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// With Entra External ID, sign-up and sign-in use the same combined user flow.
// Redirect users who land on /signup to /login so MSAL handles registration.
export default function Signup() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/login", { replace: true });
  }, [navigate]);
  return null;
}
