import { forwardRef, type AnchorHTMLAttributes } from "react";
import { navigate } from "./navigation";

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, onClick, ...rest }, ref) {
  return (
    <a
      ref={ref}
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
        navigate(href);
      }}
    />
  );
});

export default Link;
