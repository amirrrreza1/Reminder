"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "../lib/cn";

export type ToastTone = "error" | "success";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const toast = useCallback((message: string, tone: ToastTone = "error") => {
    const id = nextId++;
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => dismiss(id), 6_000);
  }, [dismiss]);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toaster" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn("ui-toast", `ui-toast--${item.tone}`)}
            role={item.tone === "error" ? "alert" : "status"}
          >
            <p>{item.message}</p>
            <button
              type="button"
              className="ui-toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => dismiss(item.id)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
