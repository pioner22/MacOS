import { memo } from "react";

export const FrameworkBadge = memo(function FrameworkBadge(props: { label: string }) {
  return (
    <span className="fw-badge" aria-label={props.label} title={props.label}>
      <span className="fw-dot" aria-hidden="true" />
      {props.label}
    </span>
  );
});

