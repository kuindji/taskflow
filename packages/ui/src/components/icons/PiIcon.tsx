import type { SVGProps } from "react";

function PiIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            xmlns="http://www.w3.org/2000/svg"
            {...props}>
            <path d="M4 7h16" />
            <path d="M9 7v11a1 1 0 0 1-1 1H7" />
            <path d="M16 7v9a2 2 0 0 0 2 2h1" />
        </svg>
    );
}

export { PiIcon };
