import type { SVGProps } from "react";

function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 240 300" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
        </svg>
    );
}

export { OpenCodeIcon };
