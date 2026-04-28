import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  MouseEvent,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { Bell, Home, Settings, UserCircle2 } from "lucide-react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export type ShellPage = {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

const windowDragNoDragSelector =
  '[data-tauri-no-drag="true"], [data-no-drag="true"], button, a, input, textarea, select, [role="button"], [contenteditable="true"]';

function handleWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(windowDragNoDragSelector)) {
    return;
  }

  void getCurrentWindow().startDragging().catch(() => {
    // CSS drag regions remain the baseline when the native fallback is unavailable.
  });
}

export function AppShell({
  appName,
  appIcon,
  pages,
  currentPageId,
  children,
  headerAccessory,
  onPageChange,
}: {
  appName: string;
  appIcon: ReactNode;
  pages: ShellPage[];
  currentPageId: string;
  children: ReactNode;
  headerAccessory?: ReactNode;
  onPageChange?: (pageId: string) => void;
}) {
  const currentPage = pages.find((page) => page.id === currentPageId) ?? pages[0];

  return (
    <main className="app-shell">
      <div className="app-shell__brand" data-tauri-drag-region onMouseDownCapture={handleWindowDragMouseDown}>
        <div className="app-shell__icon" aria-hidden="true">
          {appIcon}
        </div>
        <div className="app-shell__brand-text">{appName}</div>
      </div>

      <header className="app-shell__header" data-tauri-drag-region onMouseDownCapture={handleWindowDragMouseDown}>
        <div className="app-shell__title-row">
          <h1>{currentPage?.label ?? appName}</h1>
        </div>
        <div className="app-shell__header-accessory">{headerAccessory}</div>
        <div className="app-shell__actions" data-tauri-no-drag="true">
          <Button variant="ghost" size="icon" aria-label="Notifications" disabled>
            <Bell aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Profile" disabled>
            <UserCircle2 aria-hidden="true" />
          </Button>
        </div>
      </header>

      <aside className="app-shell__nav" aria-label="Main navigation">
        <nav className="nav-list">
          {pages.map((page, index) => {
            const active = page.id === currentPageId;
            return (
              <button
                key={page.id}
                type="button"
                className={cn("nav-item", active && "nav-item--active")}
                aria-current={active ? "page" : undefined}
                disabled={page.disabled}
                onClick={() => onPageChange?.(page.id)}
              >
                {page.icon ?? (index === 0 ? <Home aria-hidden="true" /> : <Settings aria-hidden="true" />)}
                <span>{page.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="app-shell__content">{children}</section>
    </main>
  );
}

type ButtonVariant = "default" | "secondary" | "outline" | "ghost";
type ButtonSize = "default" | "sm" | "icon";

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={cn("button", `button--${variant}`, `button--${size}`, className)} {...props} />;
}

export function Dialog({
  open,
  onClose,
  titleId,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  className?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => contentRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={contentRef}
        className={cn("dialog-content", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

export function DialogClose({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <Button variant="ghost" size="icon" className={cn("dialog-close", className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card__header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("card__title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("card__description", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card__content", className)} {...props} />;
}

export function Badge({
  className,
  variant = "secondary",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "secondary" | "outline" | "warning" | "danger" }) {
  return <span className={cn("badge", `badge--${variant}`, className)} {...props} />;
}

export function Alert({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: "default" | "error" }) {
  return <div className={cn("alert", variant === "error" && "alert--error", className)} {...props} />;
}

export function Cluster({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cluster", className)} {...props} />;
}

export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("stack", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("control", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("control", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("control textarea", className)} {...props} />;
}

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("field", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-card__header">
        <div className="stat-card__meta">
          <CardDescription>{title}</CardDescription>
          {icon ? <div className="stat-card__icon">{icon}</div> : null}
        </div>
        <CardTitle className="stat-card__value">{value}</CardTitle>
      </div>
      <div>
        <p className="stat-card__description">{description}</p>
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
