import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ConfirmProvider } from "@/hooks/use-confirm";
import { AuthProvider, useAuthContext } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { GlobalCallOverlay } from "@/components/chat/call";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AuthCallback from "./pages/AuthCallback";

const AuthenticatedCallOverlay = () => {
  const { user } = useAuthContext();
  if (!user) return null;
  return <GlobalCallOverlay />;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
});

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <ConfirmProvider>
          <TooltipProvider>
            <AuthProvider>
              <Toaster />
              <Sonner position="top-center" richColors />
              <AuthenticatedCallOverlay />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/login" element={<Login />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route 
                  path="/dashboard/*" 
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  } 
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </TooltipProvider>
        </ConfirmProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
