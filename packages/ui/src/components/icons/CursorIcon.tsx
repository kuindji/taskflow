import type { SVGProps } from "react";

function CursorIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path d="M3.41 2.414 21.6 8.291a.6.6 0 0 1 .057 1.118l-8.07 3.756-3.755 8.07a.6.6 0 0 1-1.118-.058L2.836 3.008a.4.4 0 0 1 .574-.594Z" />
        </svg>
    );
}

export { CursorIcon };
