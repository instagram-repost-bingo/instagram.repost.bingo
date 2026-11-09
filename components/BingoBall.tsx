type BallSize = "sm" | "md" | "lg";
type BallTone = "accent" | "ink" | "paper";

interface BingoBallProps {
  label: string;
  caption?: string;
  size?: BallSize;
  tone?: BallTone;
  className?: string;
}

/** Decorative bingo ball: a coloured shell with a white face and a number. */
export function BingoBall({ label, caption, size = "md", tone = "accent", className }: BingoBallProps) {
  const classes = ["ball", `ball--${size}`, `ball--${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true">
      <span className="ball__face">
        <span className="ball__label">{label}</span>
        {caption ? <span className="ball__caption">{caption}</span> : null}
      </span>
    </span>
  );
}
