import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getFileIconName, getFolderIconName } from "@/lib/file-icons";

interface FileIconProps {
    name: string;
    isDirectory: boolean;
    isOpen?: boolean;
    className?: string;
}

function FileIcon({ name, isDirectory, isOpen, className }: FileIconProps) {
    const iconPath = useMemo(() => {
        if (isDirectory) {
            const folderKey = getFolderIconName(name);
            if (folderKey) {
                return isOpen
                    ? `/icons/catppuccin/folder_${folderKey}_open.svg`
                    : `/icons/catppuccin/folder_${folderKey}.svg`;
            }
            return isOpen
                ? "/icons/catppuccin/_folder_open.svg"
                : "/icons/catppuccin/_folder.svg";
        }
        const iconName = getFileIconName(name);
        return `/icons/catppuccin/${iconName}.svg`;
    }, [name, isDirectory, isOpen]);

    return (
        <img
            src={iconPath}
            alt=""
            width={16}
            height={16}
            className={cn("h-4 w-4 shrink-0 opacity-50", className)}
        />
    );
}

export { FileIcon };
