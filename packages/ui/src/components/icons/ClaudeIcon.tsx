import type { SVGProps } from "react";

function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <path d="M16.09 3.33c-.36-1.17-2-1.17-2.36 0L11.5 10.5a.75.75 0 0 1-.5.5l-7.17 2.23c-1.17.36-1.17 2 0 2.36l7.17 2.23c.24.07.43.26.5.5l2.23 7.17c.36 1.17 2 1.17 2.36 0l2.23-7.17a.75.75 0 0 1 .5-.5l7.17-2.23c1.17-.36 1.17-2 0-2.36l-7.17-2.23a.75.75 0 0 1-.5-.5z" transform="translate(-1.5 -1.5) scale(0.96)" />
        </svg>
    );
}

export { ClaudeIcon };
