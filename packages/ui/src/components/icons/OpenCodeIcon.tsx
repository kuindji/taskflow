import type { SVGProps } from "react";

function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M8.5 3.5L1.5 12l7 8.5M15.5 3.5l7 8.5-7 8.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
    );
}

export { OpenCodeIcon };
