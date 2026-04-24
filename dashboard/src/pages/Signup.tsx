import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Signup() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/login?mode=signup", { replace: true });
  }, [navigate]);
  return null;
}
