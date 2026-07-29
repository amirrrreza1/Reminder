import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  asChild?: boolean;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-button ui-button--primary",
  secondary: "ui-button ui-button--secondary",
  destructive: "ui-button ui-button--destructive",
  ghost: "ui-button ui-button--ghost",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", asChild = false, type = "button", ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(variantClass[variant], className)}
      {...props}
    />
  );
});
