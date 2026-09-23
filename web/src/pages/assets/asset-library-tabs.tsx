import { Building2, Library } from "lucide-react";

import { cn } from "@/lib/utils";

export type AssetLibraryScope = "official" | "personal";

export function AssetLibraryTabs({ value, onChange }: { value: AssetLibraryScope; onChange: (value: AssetLibraryScope) => void }) {
    return (
        <nav className="asset-library-scope-tabs" aria-label="素材库来源">
            <button type="button" aria-pressed={value === "official"} className={cn(value === "official" && "is-active")} onClick={() => onChange("official")}>
                <Building2 aria-hidden="true" />
                官方资产
            </button>
            <button type="button" aria-pressed={value === "personal"} className={cn(value === "personal" && "is-active")} onClick={() => onChange("personal")}>
                <Library aria-hidden="true" />
                我的资产
            </button>
        </nav>
    );
}
