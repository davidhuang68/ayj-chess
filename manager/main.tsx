import { createRoot } from "react-dom/client";
import AuthGate from "../app/auth-gate";
import PublicView from "../app/public-view";
import "../app/globals.css";
createRoot(document.getElementById("root")!).render(location.pathname==='/manage'||location.pathname.startsWith('/manage/')?<AuthGate />:<PublicView />);
