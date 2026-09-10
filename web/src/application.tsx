import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import "@fontsource/pixelify-sans/400.css";
import "antd/dist/reset.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router";

import "@/lib/plugins/builtin";

import { AppProviders } from "@/components/layout/app-providers";
import { router } from "@/router";

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
