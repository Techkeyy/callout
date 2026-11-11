import type { ReactNode } from "react";

/** One short line that says what to do next. `tone` only changes the accent bar. */
export default function NextStep({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "go" }) {
  return (
    <p className={`nextstep ${tone === "go" ? "is-go" : ""}`} role="status">
      <span className="nextstep-k">Next step</span>
      <span>{children}</span>
    </p>
  );
}
