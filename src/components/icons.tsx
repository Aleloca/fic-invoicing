import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Icon>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v16M4 12h16" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12.5l5 5L20 6.5" />
    </Icon>
  );
}

export function Alert(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 2 21h20L12 3Z" strokeLinejoin="miter" />
      <path d="M12 10v5M12 17.5v.5" />
    </Icon>
  );
}

export function Info(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Icon>
  );
}

export function External(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </Icon>
  );
}

export function Download(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v12M6 10l6 6 6-6M4 21h16" />
    </Icon>
  );
}

export function Copy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 8h12v12H8z" />
      <path d="M16 8V4H4v12h4" />
    </Icon>
  );
}
